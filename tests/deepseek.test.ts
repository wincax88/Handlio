import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import request from "supertest";

process.env.DATA_DIR = mkdtempSync(
  path.join(tmpdir(), "handlio-deepseek-test-"),
);
process.env.NODE_ENV = "test";
process.env.MAIL_PROVIDER = "local";
const { aiConfiguration, requestAiSuggestions, deepseekNotice } =
  await import("../server/ai");
const { createApp } = await import("../server/app");
const { processJobs } = await import("../server/jobs");
const { db, one } = await import("../server/db");
const app = createApp();
const key = "fictional-test-secret-not-a-real-api-key";
let png: Buffer;
beforeAll(async () => {
  png = await sharp({
    create: { width: 64, height: 32, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => db.close());
function configure() {
  vi.stubEnv("AI_PROVIDER", "deepseek");
  vi.stubEnv("DEEPSEEK_API_KEY", key);
  vi.stubEnv("AI_PRIVACY_NOTICE", "");
}
function input(ids = ["step-one"]) {
  return {
    maxCostUsd: 0.05 * ids.length,
    costCurrency: "USD" as const,
    instruction: "Only visible facts",
    promptVersion: "suggestions-v2",
    language: "zh-CN",
    terms: ["产品"],
    sources: ids.map((id) => ({
      sourceStepId: id,
      title: "新增产品",
      body: "界面上下文",
      assetHash: "asset-hash",
      imageBase64: png.toString("base64"),
    })),
  };
}
function suggestion(id = "step-one") {
  return {
    sourceStepId: id,
    title: "新增产品",
    body: "点击 Add product。",
    expected: "请核对保存后的结果。",
    missing: ["截图未显示保存后的状态。"],
  };
}
function completion(overrides: object = {}) {
  return {
    model: "deepseek-flash",
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify({ suggestions: [suggestion()] }) },
      },
    ],
    usage: { prompt_tokens: 2000, completion_tokens: 200 },
    ...overrides,
  };
}
function mockResponse(data: unknown, status = 200) {
  const provider = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(data), { status }));
  vi.stubGlobal("fetch", provider);
  return provider;
}

test("selects DeepSeek with a server key and safe disclosure, with explicit selection and legacy compatibility", () => {
  configure();
  expect(aiConfiguration()).toEqual({
    provider: "deepseek",
    notice: deepseekNotice,
    enabled: true,
  });
  vi.stubEnv("AI_PROVIDER", "");
  expect(aiConfiguration().enabled).toBe(true);
  vi.stubEnv("AI_ADAPTER_URL", "https://legacy.example.test");
  expect(aiConfiguration()).toMatchObject({
    provider: "adapter",
    enabled: false,
  });
  vi.stubEnv("AI_PRIVACY_NOTICE", "Reviewed adapter disclosure");
  expect(aiConfiguration().enabled).toBe(true);
  vi.stubEnv("AI_PROVIDER", "deepseek");
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  expect(aiConfiguration().enabled).toBe(false);
  vi.stubEnv("AI_PROVIDER", "unsupported");
  expect(aiConfiguration().enabled).toBe(false);
});

test("sends real image parts to the fixed HTTPS endpoint, respects language and keeps secrets out of returned data", async () => {
  configure();
  const provider = mockResponse(completion());
  const dispatch = vi.fn();
  const result = await requestAiSuggestions(input(), dispatch);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(provider).toHaveBeenCalledTimes(1);
  const [url, options] = provider.mock.calls[0];
  expect(url).toBe("https://api.deepseek.com/chat/completions");
  expect(options.headers.Authorization).toBe(`Bearer ${key}`);
  expect(options.redirect).toBe("error");
  expect(options.signal).toBeInstanceOf(AbortSignal);
  const body = JSON.parse(options.body);
  expect(body).toMatchObject({
    model: "deepseek-flash",
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    stream: false,
  });
  expect(body.tools).toBeUndefined();
  expect(body.messages[0].content).toContain("UNTRUSTED DATA");
  expect(body.messages[1].content[0].text).toContain('"language":"zh-CN"');
  expect(body.messages[1].content[2]).toMatchObject({
    type: "image_url",
    image_url: { detail: "high" },
  });
  expect(body.messages[1].content[2].image_url.url).toMatch(
    /^data:image\/png;base64,/,
  );
  expect(options.body).not.toContain(key);
  expect(options.body).not.toContain("asset-hash");
  expect(result).toMatchObject({
    model: "deepseek-flash",
    cost: null,
    suggestions: [suggestion()],
    usage: { promptTokens: 2000, completionTokens: 200 },
    costUpperBoundUsd: 0.00084,
  });
  expect(JSON.stringify(result)).not.toContain(key);
});

test("disabled or missing credentials never dispatch a request", async () => {
  configure();
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  const provider = mockResponse(completion());
  await expect(requestAiSuggestions(input())).rejects.toMatchObject({
    code: "PROVIDER_UNAVAILABLE",
  });
  expect(provider).not.toHaveBeenCalled();
});

test("rejects an insufficient cost cap or invalid image before marking a request dispatched", async () => {
  configure();
  const provider = mockResponse(completion());
  const dispatch = vi.fn();
  await expect(
    requestAiSuggestions({ ...input(), maxCostUsd: 0.000001 }, dispatch),
  ).rejects.toMatchObject({ code: "AI_BUDGET_EXCEEDED" });
  const invalid = input();
  invalid.sources[0].imageBase64 =
    Buffer.from("not an image").toString("base64");
  await expect(requestAiSuggestions(invalid, dispatch)).rejects.toMatchObject({
    code: "INVALID_SOURCE",
  });
  expect(provider).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

test.each([401, 402, 403, 429, 500])(
  "redacts provider error bodies for HTTP %s",
  async (status) => {
    configure();
    mockResponse(
      { error: { message: `secret: ${key}; private image text` } },
      status,
    );
    const error = await requestAiSuggestions(input()).catch((e) => e);
    expect(error.code).toBe(
      status === 401 || status === 403
        ? "AI_PROVIDER_AUTH"
        : status === 402
          ? "AI_PROVIDER_BALANCE"
          : "PROVIDER_UNAVAILABLE",
    );
    expect(error.message).not.toContain(key);
    expect(error.message).not.toContain("private image text");
  },
);

test("network and timeout failures use a safe retryable error", async () => {
  configure();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(key)));
  await expect(requestAiSuggestions(input())).rejects.toMatchObject({
    code: "PROVIDER_UNAVAILABLE",
  });
});

test("cancellation at dispatch prevents sending prepared screenshots", async () => {
  configure();
  const provider = mockResponse(completion());
  await expect(
    requestAiSuggestions(input(), () => {
      throw new Error("Task canceled");
    }),
  ).rejects.toThrow("Task canceled");
  expect(provider).not.toHaveBeenCalled();
});

test("oversized dimensions are reduced before reaching the vision API", async () => {
  configure();
  const source = input();
  source.sources[0].imageBase64 = (
    await sharp({
      create: { width: 6000, height: 100, channels: 3, background: "white" },
    })
      .png()
      .toBuffer()
  ).toString("base64");
  const provider = mockResponse(completion());
  await requestAiSuggestions(source);
  const encoded = JSON.parse(
    provider.mock.calls[0][1].body,
  ).messages[1].content[2].image_url.url.split(",")[1];
  const meta = await sharp(Buffer.from(encoded, "base64")).metadata();
  expect(meta.width).toBe(4096);
  expect(meta.height).toBeLessThan(100);
});

test.each([
  { choices: [{ finish_reason: "length", message: { content: "{}" } }] },
  { choices: [{ finish_reason: "stop", message: { content: "not JSON" } }] },
  { choices: [{ finish_reason: "stop", message: { content: "" } }] },
  {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            suggestions: [suggestion("other-tenant-step")],
          }),
        },
      },
    ],
  },
  {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            suggestions: [suggestion(), suggestion()],
          }),
        },
      },
    ],
  },
  {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            suggestions: [{ ...suggestion(), body: "x".repeat(2001) }],
          }),
        },
      },
    ],
  },
  {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({ suggestions: [suggestion()] }),
          tool_calls: [{ function: "anything" }],
        },
      },
    ],
  },
])(
  "rejects truncated, malformed, invented or tool output %#",
  async (changes) => {
    configure();
    mockResponse(completion(changes));
    await expect(requestAiSuggestions(input())).rejects.toMatchObject({
      code: "AI_SCHEMA_INVALID",
    });
  },
);

test("supports multiple distinct steps and retains unknown cost when token usage is absent", async () => {
  configure();
  const raw = completion({
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            suggestions: [suggestion("two"), suggestion("one")],
          }),
        },
      },
    ],
    usage: undefined,
  });
  mockResponse(raw);
  const result = await requestAiSuggestions(input(["one", "two"]));
  expect(result.cost).toBeNull();
  expect(result.usage).toBeUndefined();
  expect(result.costUpperBoundUsd).toBeUndefined();
  expect(result.suggestions.map((s: any) => s.sourceStepId)).toEqual([
    "two",
    "one",
  ]);
});

test("authenticated queue enforces consent and tenant access, freezes language, and never overwrites the draft", async () => {
  configure();
  const agent = request.agent(app);
  const challenge = await agent
    .post("/api/auth/challenges")
    .send({ email: "deepseek-owner@example.test", purpose: "owner" });
  await agent.post("/api/auth/verify").send({
    challengeId: challenge.body.challengeId,
    code: challenge.body.devCode,
    purpose: "owner",
  });
  const session = (await agent.get("/api/session")).body;
  expect(session).toMatchObject({
    aiEnabled: true,
    aiProvider: "deepseek",
    aiNotice: deepseekNotice,
  });
  expect(JSON.stringify(session)).not.toContain(key);
  const info = (await agent.get("/api/service-information")).body;
  expect(info).toMatchObject({ aiConfigured: true, aiProvider: "deepseek" });
  expect(JSON.stringify(info)).not.toContain(key);
  const call = (
    method: "post" | "patch" | "get",
    route: string,
    data?: object,
  ) =>
    agent[method](route)
      .set("X-CSRF-Token", session.user.csrf)
      .set("Idempotency-Key", randomUUID())
      .send(data);
  const created = await call("post", "/api/projects", {
    name: "DeepSeek test",
    clientName: "Fictional client",
    title: "测试手册",
    template: "blank",
    language: "zh-CN",
  });
  const pid = created.body.id;
  const p = (await call("get", `/api/projects/${pid}`)).body;
  const uploaded = await agent
    .post(`/api/projects/${pid}/assets`)
    .set("X-CSRF-Token", session.user.csrf)
    .set("Idempotency-Key", randomUUID())
    .set("X-Sanitized", "true")
    .set("Content-Type", "image/png")
    .send(png);
  expect(uploaded.status).toBe(200);
  const draft = p.draft;
  draft.guides[0].steps = [
    {
      id: "step-one",
      title: "Original title",
      body: "Original instruction",
      expected: "",
      warning: "",
      source: "Private internal note must not be sent",
      alt: "",
      assetId: uploaded.body.id,
      textOnly: false,
      reviewed: false,
      aiPending: false,
    },
  ];
  // Upload changes the draft revision independently, so reload its current revision.
  const before = (await call("get", `/api/projects/${pid}`)).body;
  expect(
    (
      await call("patch", `/api/projects/${pid}/draft`, {
        draft,
        baseRevision: before.revision,
      })
    ).status,
  ).toBe(200);
  const unchanged = one("SELECT draft FROM projects WHERE id=?", pid)!.draft;
  expect(
    (
      await call("post", `/api/projects/${pid}/ai-jobs`, {
        stepIds: ["step-one"],
        consent: false,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("post", `/api/projects/${pid}/ai-jobs`, {
        stepIds: ["someone-elses-step"],
        consent: true,
      })
    ).status,
  ).toBe(400);
  const provider = mockResponse(completion());
  const queued = await call("post", `/api/projects/${pid}/ai-jobs`, {
    stepIds: ["step-one"],
    consent: true,
  });
  expect(queued.status).toBe(202);
  await processJobs();
  const job = one("SELECT * FROM jobs WHERE id=?", queued.body.jobId)!;
  expect(job.state).toBe("succeeded");
  expect(JSON.parse(job.output)).toMatchObject({
    cost: null,
    promptVersion: "suggestions-v2",
    suggestions: [suggestion()],
  });
  expect(
    JSON.parse(provider.mock.calls[0][1].body).messages[1].content[0].text,
  ).toContain('"language":"zh-CN"');
  expect(provider.mock.calls[0][1].body).not.toContain("Private internal note");
  expect(one("SELECT draft FROM projects WHERE id=?", pid)!.draft).toBe(
    unchanged,
  );
  expect(
    one(
      "SELECT cost_micros,status FROM ai_costs WHERE job_id=?",
      `${job.id}:1`,
    ),
  ).toMatchObject({ cost_micros: null, status: "unknown" });
  expect(
    one("SELECT committed,reserved FROM usage WHERE task_id=?", job.id),
  ).toMatchObject({ committed: 1, reserved: 0 });
  // Pre-dispatch validation failure releases money and step reservations.
  vi.stubEnv("AI_MAX_STEP_COST_USD", "0.000001");
  const refused = await call("post", `/api/projects/${pid}/ai-jobs`, {
    stepIds: ["step-one"],
    consent: true,
  });
  expect(refused.status).toBe(202);
  await processJobs();
  expect(
    one("SELECT state,error FROM jobs WHERE id=?", refused.body.jobId),
  ).toMatchObject({ state: "failed", error: "AI_BUDGET_EXCEEDED" });
  expect(
    one(
      "SELECT cost_micros,status,reserved_micros FROM ai_costs WHERE job_id=?",
      `${refused.body.jobId}:1`,
    ),
  ).toMatchObject({
    cost_micros: null,
    status: "released",
    reserved_micros: 0,
  });
  expect(
    one(
      "SELECT committed,reserved FROM usage WHERE task_id=?",
      refused.body.jobId,
    ),
  ).toMatchObject({ committed: 0, reserved: 0 });
  expect(provider).toHaveBeenCalledTimes(1);
  const stranger = request.agent(app);
  const otherChallenge = await stranger
    .post("/api/auth/challenges")
    .send({ email: "deepseek-other@example.test", purpose: "owner" });
  await stranger
    .post("/api/auth/verify")
    .send({
      challengeId: otherChallenge.body.challengeId,
      code: otherChallenge.body.devCode,
      purpose: "owner",
    });
  const otherSession = (await stranger.get("/api/session")).body;
  expect(
    (
      await stranger
        .post(`/api/projects/${pid}/ai-jobs`)
        .set("X-CSRF-Token", otherSession.user.csrf)
        .set("Idempotency-Key", randomUUID())
        .send({ stepIds: ["step-one"], consent: true })
    ).status,
  ).toBe(404);
});

import { afterAll, beforeAll, expect, test, vi } from "vitest";
import request from "supertest";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DatabaseSync } from "node:sqlite";
import { terminologyHints } from "../shared/terminology";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "handlio-nonpayment-"));
process.env.NODE_ENV = "test";
process.env.MAIL_PROVIDER = "local";
const { createApp } = await import("../server/app");
const { db, dataDir, one, many, run, tx } = await import("../server/db");
const { processJobs, maintenance } = await import("../server/jobs");
const { processNotifications } = await import("../server/providers");
const { createEncryptedBackup, restoreEncryptedBackup } =
  await import("../server/backup-store");
const {
  reserveAiCost,
  dispatchAiCost,
  settleAiCost,
  failAiCost,
  aiCostSummary,
} = await import("../server/ai-budget");
const { checkLink, safeLinkUrl } = await import("../server/link-checks");
const { isolatedExport } = await import("../server/export-process");
const { PDFDocument } = await import("pdf-lib");
const app = createApp();
async function login(
  email: string,
  purpose = "owner",
  publicId = "",
  invite = "",
) {
  const agent = request.agent(app);
  const c = await agent
    .post("/api/auth/challenges")
    .send({ email, purpose, publicId, invite });
  expect(c.status).toBe(200);
  await agent
    .post("/api/auth/verify")
    .send({ challengeId: c.body.challengeId, code: c.body.devCode, purpose });
  const session = (await agent.get("/api/session")).body;
  return {
    agent,
    session,
    call: (
      method: "get" | "post" | "patch" | "delete",
      url: string,
      body?: any,
      key = randomUUID(),
    ) =>
      agent[method](url)
        .set("X-CSRF-Token", session.user.csrf)
        .set("Idempotency-Key", key)
        .send(body),
  };
}
let owner: Awaited<ReturnType<typeof login>>,
  other: Awaited<ReturnType<typeof login>>,
  client: Awaited<ReturnType<typeof login>>,
  p: any,
  assetId: string,
  annotatedId: string,
  release: any;
beforeAll(async () => {
  owner = await login("nonpayment-owner@example.test");
  other = await login("nonpayment-other@example.test");
  const created = await owner.call("post", "/api/projects", {
    name: "Nonpayment test",
    clientName: "Fictional client",
    title: "Handbook",
    template: "blank",
  });
  p = (await owner.call("get", `/api/projects/${created.body.id}`)).body;
  const png = await sharp({
    create: { width: 800, height: 400, channels: 3, background: "#ffffff" },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 100,
            height: 50,
            channels: 3,
            background: "#17212b",
          },
        })
          .png()
          .toBuffer(),
        left: 300,
        top: 80,
      },
    ])
    .png()
    .toBuffer();
  const uploaded = await owner.agent
    .post(`/api/projects/${p.id}/assets`)
    .set("X-CSRF-Token", owner.session.user.csrf)
    .set("Idempotency-Key", randomUUID())
    .set("X-Sanitized", "true")
    .set("Content-Type", "image/png")
    .send(png);
  expect(uploaded.status).toBe(200);
  assetId = uploaded.body.id;
  const draft = p.draft;
  Object.assign(draft, {
    intro: "Fictional handbook",
    supportEmail: "support@example.test",
    maintenance: "Contact the owner for structural changes.",
  });
  Object.assign(draft.guides[0], {
    goal: "Preview",
    prerequisites: "Editor access",
    audience: "Editors",
    completion: "The preview is correct",
    steps: [
      {
        id: "step-one",
        title: "Preview",
        body: "Open Preview.",
        expected: "Preview appears.",
        warning: "",
        source: "",
        alt: "Reviewed fictional screenshot",
        assetId,
        reviewed: true,
        textOnly: false,
        aiPending: false,
      },
    ],
  });
  draft.checklist.forEach((c: any) => (c.done = true));
  await owner.call("patch", `/api/projects/${p.id}/draft`, {
    baseRevision: p.revision,
    draft,
  });
  const checkout = await owner.call("post", "/api/billing/checkouts", {
    projectId: p.id,
    product: "project",
  });
  await owner.call("post", "/api/billing/local-confirm", {
    orderId: checkout.body.orderId,
  });
  p = (await owner.call("get", `/api/projects/${p.id}`)).body;
});
afterAll(() => {
  vi.unstubAllGlobals();
  db.close();
});
test("annotation recipes remain editable, preserve redaction pixels and isolate tenants", async () => {
  const shapes = [
      { type: "arrow", x: 20, y: 20, w: 100, h: 20, label: "" },
      {
        type: "label",
        x: 30,
        y: 140,
        w: 0,
        h: 0,
        label: "<script>fictional</script>",
      },
    ],
    key = randomUUID();
  const created = await owner.call(
    "post",
    `/api/projects/${p.id}/assets/${assetId}/annotations`,
    { shapes },
    key,
  );
  expect(created.status).toBe(201);
  annotatedId = created.body.id;
  expect(
    (
      await owner.call(
        "post",
        `/api/projects/${p.id}/assets/${assetId}/annotations`,
        { shapes },
        key,
      )
    ).body.id,
  ).toBe(annotatedId);
  expect(
    (
      await other.call(
        "get",
        `/api/projects/${p.id}/assets/${annotatedId}/edit`,
      )
    ).status,
  ).toBe(404);
  const recipe = (
    await owner.call("get", `/api/projects/${p.id}/assets/${annotatedId}/edit`)
  ).body;
  expect(recipe).toMatchObject({ baseId: assetId, shapes });
  const pixels = await sharp(
    readFileSync(path.join(dataDir, `${annotatedId}.png`)),
  )
    .extract({ left: 330, top: 90, width: 1, height: 1 })
    .raw()
    .toBuffer();
  expect([...pixels].slice(0, 3)).toEqual([23, 33, 43]);
  const saved = (await owner.call("get", `/api/projects/${p.id}`)).body;
  saved.draft.guides[0].steps[0].assetId = annotatedId;
  await owner.call("patch", `/api/projects/${p.id}/draft`, {
    baseRevision: saved.revision,
    draft: saved.draft,
  });
  const checked = (
    await owner.call("post", `/api/projects/${p.id}/validate`, {})
  ).body;
  const publish = await owner.call("post", `/api/projects/${p.id}/releases`, {
    draftRevision: checked.revision,
    validationId: checked.id,
    summary: "Layered image release",
    warningReason: "",
  });
  expect(publish.status).toBe(202);
  await processJobs();
  release = (await owner.call("get", `/api/projects/${p.id}`)).body
    .currentRelease;
  await owner.call("patch", `/api/projects/${p.id}`, { sharing: true });
  const invite = await owner.call("post", `/api/projects/${p.id}/invites`, {
    email: "nonpayment-client@example.test",
    role: "Reviewer",
    download: true,
  });
  const url = new URL(invite.body.localInviteUrl);
  client = await login(
    "nonpayment-client@example.test",
    "client",
    p.publicId,
    url.searchParams.get("invite")!,
  );
  expect(
    (await client.call("get", `/api/assets/${assetId}?release=${release.id}`))
      .status,
  ).toBe(404);
  expect(
    (
      await client.call(
        "get",
        `/api/assets/${annotatedId}?release=${release.id}`,
      )
    ).status,
  ).toBe(200);
  await owner.call(
    "post",
    `/api/projects/${p.id}/assets/${assetId}/annotations`,
    { shapes: [] },
  );
  expect(
    (await owner.call("get", `/api/projects/${p.id}`)).body.currentRelease.hash,
  ).toBe(release.hash);
  run(
    "UPDATE assets SET created_at=? WHERE project_id=?",
    Date.now() - 2 * 86400000,
    p.id,
  );
  await maintenance();
  expect(existsSync(path.join(dataDir, `${assetId}.png`))).toBe(true);
});
test("AI cost reservation is atomic, charges are tracked conservatively and repeated failures trip the breaker", async () => {
  const project = one("SELECT * FROM projects WHERE id=?", p.id)!;
  const job = randomUUID();
  expect(tx(() => reserveAiCost(project, job, 1))).toBe(0.05);
  tx(() => reserveAiCost(project, job, 1));
  expect(many("SELECT * FROM ai_costs WHERE project_id=?", p.id)).toHaveLength(
    1,
  );
  dispatchAiCost(`${job}:1`);
  settleAiCost(project, `${job}:1`, null);
  expect(aiCostSummary(p.id).reservedOrUncertainUsd).toBe(0.05);
  await owner.call("patch", `/api/projects/${p.id}/ai-budget`, {
    budgetUsd: 0.1,
    reason: "Set a small test budget",
    acknowledgement: true,
  });
  expect(() => tx(() => reserveAiCost(project, randomUUID(), 2))).toThrow(
    /budget/i,
  );
  await owner.call("patch", `/api/projects/${p.id}/ai-budget`, {
    budgetUsd: 5,
    reason: "Restore normal test budget",
    acknowledgement: true,
  });
  for (let i = 0; i < 2; i++) {
    const next = randomUUID();
    tx(() => reserveAiCost(project, next, 1));
    dispatchAiCost(`${next}:1`);
    failAiCost(project, `${next}:1`);
  }
  expect(aiCostSummary(p.id).paused).toBe(true);
  expect(
    (
      await other.call("patch", `/api/projects/${p.id}/ai-budget`, {
        budgetUsd: 10,
        reason: "Invalid cross tenant action",
        resume: true,
        acknowledgement: true,
      })
    ).status,
  ).toBe(404);
  await owner.call("patch", `/api/projects/${p.id}/ai-budget`, {
    budgetUsd: 5,
    reason: "Reviewed uncertain test charges",
    resume: true,
    acknowledgement: true,
  });
  expect(aiCostSummary(p.id).paused).toBe(false);
});
test("active export timeout kills rendering, releases quota and can retry the same task", async () => {
  const job = (
    await owner.call("post", `/api/releases/${release.id}/exports`, {
      format: "html",
      paper: "A4",
    })
  ).body.jobId;
  process.env.EXPORT_TEST_TIMEOUT_MS = "10";
  try {
    await processJobs();
  } finally {
    delete process.env.EXPORT_TEST_TIMEOUT_MS;
  }
  expect(one("SELECT state,error FROM jobs WHERE id=?", job)).toMatchObject({
    state: "failed",
    error: "JOB_TIMEOUT",
  });
  expect(
    one("SELECT reserved,committed FROM usage WHERE task_id=?", job),
  ).toMatchObject({ reserved: 0, committed: 0 });
  expect(existsSync(path.join(dataDir, `${job}.zip`))).toBe(false);
  await owner.call("post", `/api/jobs/${job}/retry`, {
    reason: "Retry after the artificial timeout",
  });
  await processJobs();
  expect(one("SELECT state FROM jobs WHERE id=?", job)?.state).toBe(
    "succeeded",
  );
});
test("link checking denies private addresses and unsafe schemes and terminology hints preserve the preferred term", async () => {
  expect(() => safeLinkUrl("http://example.com")).toThrow();
  expect(() => safeLinkUrl("https://user:secret@example.com")).toThrow();
  expect(() => safeLinkUrl("https://example.com:8443")).toThrow();
  expect(await checkLink("https://127.0.0.1/private")).toBe("review");
  expect(await checkLink("https://2130706433/private")).toBe("review");
  expect(
    terminologyHints("Use Review page, then preview.", {
      terms: ["Preview"],
      glossary: [{ term: "Preview", aliases: ["Review page"] }],
    }),
  ).toEqual(
    expect.arrayContaining([
      { preferred: "Preview", found: "Review page" },
      { preferred: "Preview", found: "preview" },
    ]),
  );
  const service = (await request(app).get("/api/service-information")).body;
  expect(service.operator).toBe("Handlio Team");
  expect(service.operatorRegion).toBe("Mainland China");
  expect(service.hostingRegion).toBe("Pending confirmation");
  expect(JSON.stringify(service)).not.toContain("BACKUP_KEY");
});
test("encrypted backup restores images and snapshots, rejects tampering and never replaces live data", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "handlio-backup-test-")),
    key = randomBytes(32).toString("base64");
  const backup = await createEncryptedBackup(path.join(root, "archives"), key);
  const encrypted = readFileSync(backup.file);
  expect(encrypted.subarray(0, 8).toString()).toBe("HNDLBK1\n");
  expect(encrypted.toString()).not.toContain("Layered image release");
  const target = path.join(root, "restored"),
    restored = await restoreEncryptedBackup(backup.file, target, key);
  expect(restored.integrity).toBe("ok");
  const restoredDb = new DatabaseSync(path.join(target, "handlio.sqlite"), {
    readOnly: true,
  });
  try {
    expect(
      restoredDb.prepare("SELECT hash FROM releases WHERE id=?").get(release.id)
        ?.hash,
    ).toBe(release.hash);
    expect(
      restoredDb.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n,
    ).toBe(0);
    expect(
      restoredDb.prepare("SELECT sharing FROM projects WHERE id=?").get(p.id)
        ?.sharing,
    ).toBe(0);
    expect(
      restoredDb.prepare("SELECT status FROM assets WHERE id=?").get(assetId)
        ?.status,
    ).toBe("ready");
  } finally {
    restoredDb.close();
  }
  expect(readFileSync(path.join(target, `${assetId}.png`))).toEqual(
    readFileSync(path.join(dataDir, `${assetId}.png`)),
  );
  await expect(
    restoreEncryptedBackup(backup.file, target, key),
  ).rejects.toThrow(/already exists/);
  await expect(
    restoreEncryptedBackup(backup.file, dataDir, key),
  ).rejects.toThrow(/live/);
  encrypted[30] ^= 1;
  const corrupted = path.join(root, "corrupted.hbk");
  writeFileSync(corrupted, encrypted);
  const unsafeTarget = path.join(root, "rejected");
  await expect(
    restoreEncryptedBackup(corrupted, unsafeTarget, key),
  ).rejects.toThrow();
  expect(existsSync(unsafeTarget)).toBe(false);
});
test("a 200-step Unicode handbook exports with a long screenshot within the isolated renderer", async () => {
  const snapshot = structuredClone(release.snapshot),
    template = snapshot.guides[0],
    originalStep = template.steps[0];
  snapshot.title = "长内容与 200 步操作手册";
  const longPng = await sharp({
    create: { width: 800, height: 3800, channels: 3, background: "#e8f4ef" },
  })
    .png()
    .toBuffer();
  const longAsset = await owner.agent
    .post(`/api/projects/${p.id}/assets`)
    .set("X-CSRF-Token", owner.session.user.csrf)
    .set("Idempotency-Key", randomUUID())
    .set("X-Sanitized", "true")
    .set("Content-Type", "image/png")
    .send(longPng);
  expect(longAsset.status).toBe(200);
  snapshot.guides = Array.from({ length: 10 }, (_, guideIndex) => ({
    ...template,
    id: `large-guide-${guideIndex}`,
    title: `操作指南 ${guideIndex + 1}`,
    steps: Array.from({ length: 20 }, (_, index) => ({
      ...originalStep,
      id: `large-step-${guideIndex}-${index}`,
      title: `Step ${index + 1} · 检查并预览`,
      body: "先检查内容，再预览网页；确认文字与图片正确后再继续。 ".repeat(5),
    })),
  }));
  snapshot.guides[0].steps[0].assetId = longAsset.body.id;
  const row = {
      ...one("SELECT * FROM releases WHERE id=?", release.id)!,
      snapshot: JSON.stringify(snapshot),
      version: 99,
    },
    job = randomUUID();
  const output = await isolatedExport(row, job, "pdf", "A4");
  const pdf = await PDFDocument.load(
    readFileSync(path.join(dataDir, output.file)),
  );
  expect(pdf.getPageCount()).toBeGreaterThan(50);
  expect(output.tocEntries).toBeGreaterThanOrEqual(10);
}, 90000);

test("AI calls receive a hard cost cap, settle successful charges and release undispatched cancellation", async () => {
  process.env.AI_ADAPTER_URL = "https://ai-adapter.example.test";
  process.env.AI_PRIVACY_NOTICE = "Only fictional processed test images.";
  const provider = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        model: "fictional-model",
        cost: 0.01,
        suggestions: [
          {
            sourceStepId: "step-one",
            title: "Preview",
            body: "Open Preview.",
            expected: "Preview appears.",
            missing: [],
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", provider);
  try {
    await owner.call("patch", `/api/projects/${p.id}/ai-budget`, {
      budgetUsd: 5,
      reason: "Reviewed previous test charges",
      acknowledgement: true,
      resume: true,
    });
    const job = await owner.call("post", `/api/projects/${p.id}/ai-jobs`, {
      stepIds: ["step-one"],
      consent: true,
    });
    expect(job.status).toBe(202);
    await processJobs();
    expect(
      one("SELECT state FROM jobs WHERE id=?", job.body.jobId)?.state,
    ).toBe("succeeded");
    expect(JSON.parse(provider.mock.calls[0][1].body)).toMatchObject({
      maxCostUsd: 0.05,
      costCurrency: "USD",
    });
    expect(
      one(
        "SELECT cost_micros FROM ai_costs WHERE job_id=?",
        `${job.body.jobId}:1`,
      )?.cost_micros,
    ).toBe(10000);
    const cancel = await owner.call("post", `/api/projects/${p.id}/ai-jobs`, {
      stepIds: ["step-one"],
      consent: true,
    });
    await owner.call("post", `/api/jobs/${cancel.body.jobId}/cancel`, {});
    expect(
      one(
        "SELECT status,reserved_micros FROM ai_costs WHERE job_id=?",
        `${cancel.body.jobId}:1`,
      ),
    ).toMatchObject({ status: "released", reserved_micros: 0 });
  } finally {
    delete process.env.AI_ADAPTER_URL;
    delete process.env.AI_PRIVACY_NOTICE;
    vi.unstubAllGlobals();
  }
});

test("small screenshot text and restricted external links become revision-bound review warnings", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="white"/>${Array.from({ length: 80 }, (_, i) => `<rect x="${10 + (i % 20) * 12}" y="${20 + Math.floor(i / 20) * 20}" width="3" height="5" fill="black"/>`).join("")}</svg>`,
    png = await sharp(Buffer.from(svg)).png().toBuffer();
  const upload = await owner.agent
    .post(`/api/projects/${p.id}/assets`)
    .set("X-CSRF-Token", owner.session.user.csrf)
    .set("Idempotency-Key", randomUUID())
    .set("X-Sanitized", "true")
    .set("Content-Type", "image/png")
    .send(png);
  expect(
    JSON.parse(
      one("SELECT result FROM asset_quality WHERE asset_id=?", upload.body.id)!
        .result,
    ).smallText,
  ).toBe(true);
  const saved = (await owner.call("get", `/api/projects/${p.id}`)).body,
    previous = structuredClone(saved.draft);
  saved.draft.guides[0].steps[0].assetId = upload.body.id;
  saved.draft.supportUrl = "https://127.0.0.1/private";
  await owner.call("patch", `/api/projects/${p.id}/draft`, {
    baseRevision: saved.revision,
    draft: saved.draft,
  });
  const links = await owner.call(
    "post",
    `/api/projects/${p.id}/check-links`,
    {},
  );
  expect(links.body.results[0].status).toBe("review");
  const checked = (
    await owner.call("post", `/api/projects/${p.id}/validate`, {})
  ).body;
  expect(checked.warnings.map((w: any) => w.code)).toEqual(
    expect.arrayContaining(["LINK_REVIEW", "SMALL_SCREENSHOT_TEXT"]),
  );
  await owner.call("patch", `/api/projects/${p.id}/draft`, {
    baseRevision: checked.revision,
    draft: previous,
  });
});

test("selected image copies are independent and safety withdrawal quarantines annotation ancestry and notifies clients", async () => {
  const copied = await owner.call("post", `/api/projects/${p.id}/copy`, {
    name: "Independent copy",
    clientName: "Other fictional client",
    reviewed: true,
    assetIds: [annotatedId],
  });
  expect(copied.status).toBe(200);
  const copy = (await owner.call("get", `/api/projects/${copied.body.id}`))
    .body;
  const copyId = copy.draft.guides[0].steps[0].assetId;
  expect(copyId).not.toBe(annotatedId);
  expect(readFileSync(path.join(dataDir, `${copyId}.png`))).toEqual(
    readFileSync(path.join(dataDir, `${annotatedId}.png`)),
  );
  expect(copy.sharing).toBe(false);
  expect(
    (
      await owner.call("post", `/api/releases/${release.id}/withdraw`, {
        reason: "Fictional safety incident for isolation verification",
        security: true,
      })
    ).status,
  ).toBe(200);
  expect(one("SELECT status FROM assets WHERE id=?", assetId)?.status).toBe(
    "revoked",
  );
  expect(one("SELECT status FROM assets WHERE id=?", annotatedId)?.status).toBe(
    "revoked",
  );
  expect(one("SELECT status FROM assets WHERE id=?", copyId)?.status).toBe(
    "ready",
  );
  await processNotifications();
  const incident = (await owner.call("get", `/api/projects/${p.id}/incidents`))
    .body[0];
  expect(incident.notified.some((n: any) => n.state === "local")).toBe(true);
  await owner.call("patch", `/api/projects/${p.id}/incidents/${incident.id}`, {
    status: "closed",
    resolution: "Reviewed images and notified the affected fictional client.",
    checklist: true,
  });
  expect((await owner.call("get", `/api/projects/${p.id}`)).body.sharing).toBe(
    false,
  );
});

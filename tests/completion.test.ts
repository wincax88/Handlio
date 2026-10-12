import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { contentChanges, mergeContent } from "../shared/compare";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "handlio-completion-"));
process.env.NODE_ENV = "test";
process.env.MAIL_PROVIDER = "local";
const { createApp } = await import("../server/app");
const { db, run, one, many, hash } = await import("../server/db");
const { processJobs } = await import("../server/jobs");
const { notify, processNotifications } = await import("../server/providers");
const app = createApp();
async function login(email: string) {
  const agent = request.agent(app);
  const challenge = await agent
    .post("/api/auth/challenges")
    .send({ email, purpose: "owner" });
  expect(challenge.status).toBe(200);
  await agent.post("/api/auth/verify").send({
    challengeId: challenge.body.challengeId,
    code: challenge.body.devCode,
    purpose: "owner",
  });
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
  outsider: Awaited<ReturnType<typeof login>>,
  project: any,
  release: any,
  orderId: string;
beforeAll(async () => {
  owner = await login("completion-owner@example.test");
  outsider = await login("completion-other@example.test");
  const created = await owner.call("post", "/api/projects", {
    name: "Completion test",
    clientName: "Fictional client",
    title: "Handbook",
    template: "blank",
  });
  expect(created.status).toBe(201);
  project = (await owner.call("get", `/api/projects/${created.body.id}`)).body;
  const draft = project.draft;
  Object.assign(draft, {
    intro: "A fictional client handbook",
    supportEmail: "help@example.test",
    maintenance: "Contact the creator for structural changes.",
  });
  Object.assign(draft.guides[0], {
    goal: "Review an update",
    prerequisites: "Content editor access",
    audience: "Editors",
    completion: "Preview is correct",
    steps: [
      {
        id: "step-preview",
        title: "Preview the page",
        body: "Open Preview before publishing.",
        expected: "Changes appear in the preview.",
        warning: "",
        source: "private",
        alt: "",
        assetId: null,
        reviewed: true,
        textOnly: true,
        aiPending: false,
      },
    ],
  });
  draft.checklist.forEach((item: any) => (item.done = true));
  expect(
    (
      await owner.call("patch", `/api/projects/${project.id}/draft`, {
        baseRevision: project.revision,
        draft,
      })
    ).status,
  ).toBe(200);
  const checkout = await owner.call("post", "/api/billing/checkouts", {
    projectId: project.id,
    product: "project",
  });
  orderId = checkout.body.orderId;
  await owner.call("post", "/api/billing/local-confirm", { orderId });
  const validation = (
    await owner.call("post", `/api/projects/${project.id}/validate`, {})
  ).body;
  const publication = await owner.call(
    "post",
    `/api/projects/${project.id}/releases`,
    {
      draftRevision: validation.revision,
      validationId: validation.id,
      summary: "Initial test version",
      warningReason: "",
    },
  );
  expect(publication.status).toBe(202);
  await processJobs();
  release = (await owner.call("get", `/api/projects/${project.id}`)).body
    .currentRelease;
  await owner.call("patch", `/api/projects/${project.id}`, { sharing: true });
});
afterAll(() => {
  vi.unstubAllGlobals();
  db.close();
});
describe("Prototype completion permissions and workflows", () => {
  test("notification preferences suppress optional messages without dropping transaction messages", async () => {
    const settings = (await owner.call("get", "/api/settings")).body;
    await owner.call("patch", "/api/settings", {
      ...settings,
      questionNotifications: true,
      receiptNotifications: true,
    });
    notify(
      project.id,
      "question:queued-before-preference",
      owner.session.user.email,
      "Question",
      "Fictional notification",
    );
    await owner.call("patch", "/api/settings", {
      ...settings,
      questionNotifications: false,
      receiptNotifications: false,
    });
    notify(
      project.id,
      "receipt:disabled",
      owner.session.user.email,
      "Receipt",
      "Fictional notification",
    );
    notify(
      project.id,
      "billing:mandatory",
      owner.session.user.email,
      "Payment",
      "Fictional transaction notice",
    );
    expect(
      one("SELECT id FROM notifications WHERE event_key='receipt:disabled'"),
    ).toBeUndefined();
    await processNotifications();
    expect(
      one(
        "SELECT state FROM notifications WHERE event_key='question:queued-before-preference'",
      )?.state,
    ).toBe("canceled");
    expect(
      one("SELECT state FROM notifications WHERE event_key='billing:mandatory'")
        ?.state,
    ).toBe("local");
  });
  test("persists workspace preferences and revokes only owned device sessions", async () => {
    expect(owner.session.user.settings.onboardingComplete).toBe(false);
    const settings = {
      ...owner.session.user.settings,
      displayName: "Alex",
      name: "Pine Studio",
      onboardingComplete: true,
      questionNotifications: false,
      marketingEmails: false,
    };
    expect((await owner.call("patch", "/api/settings", settings)).status).toBe(
      200,
    );
    expect(
      (await owner.call("get", "/api/session")).body.user.settings,
    ).toMatchObject(settings);
    const token = randomUUID();
    run(
      "INSERT INTO sessions VALUES (?,?,?,?,?)",
      hash(token),
      owner.session.user.id,
      "secondary-csrf",
      Date.now(),
      Date.now() + 3600000,
    );
    await request(app)
      .get("/api/session")
      .set("Cookie", `handlio_session=${token}`)
      .set("User-Agent", "Test Safari device");
    const devices = (await owner.call("get", "/api/account/sessions")).body;
    expect(devices).toHaveLength(2);
    expect(JSON.stringify(devices)).not.toContain("digest");
    const secondary = devices.find((device: any) => !device.current);
    expect(
      (
        await outsider.call(
          "delete",
          `/api/account/sessions/${secondary.id}`,
          {},
        )
      ).status,
    ).toBe(404);
    expect(
      (await owner.call("delete", `/api/account/sessions/${secondary.id}`, {}))
        .status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get("/api/session")
          .set("Cookie", `handlio_session=${token}`)
      ).body.user,
    ).toBeNull();
  });
  test("limits support to active explicit scope and enforces revocation and expiry", async () => {
    const grant = await owner.call("post", "/api/support-grants", {
      scope: "sample",
      hours: 1,
      sample: "A sanitized fictional example",
    });
    expect(grant.status).toBe(201);
    expect(
      (await outsider.call("get", `/api/ops/grants/${grant.body.id}`)).status,
    ).toBe(404);
    process.env.OPS_EMAILS = outsider.session.user.email;
    try {
      const sample = await outsider.call(
        "get",
        `/api/ops/grants/${grant.body.id}`,
      );
      expect(sample.body.sample).toBe("A sanitized fictional example");
      expect(
        JSON.stringify((await outsider.call("get", "/api/ops")).body),
      ).not.toContain("sanitized fictional example");
      expect(
        (
          await outsider.call(
            "delete",
            `/api/support-grants/${grant.body.id}`,
            {},
          )
        ).status,
      ).toBe(404);
      await owner.call("delete", `/api/support-grants/${grant.body.id}`, {});
      expect(
        (await outsider.call("get", `/api/ops/grants/${grant.body.id}`)).status,
      ).toBe(404);
      const second = await owner.call("post", "/api/support-grants", {
        scope: "metadata",
        hours: 1,
      });
      run(
        "UPDATE support_grants SET expires_at=? WHERE id=?",
        Date.now() - 1,
        second.body.id,
      );
      expect(
        (await outsider.call("get", `/api/ops/grants/${second.body.id}`))
          .status,
      ).toBe(404);
    } finally {
      delete process.env.OPS_EMAILS;
    }
  });
  test("batch invitations are validated atomically, deduplicated and idempotent", async () => {
    const key = randomUUID(),
      body = {
        emails: [
          "client-one@example.test",
          "CLIENT-ONE@example.test",
          "client-two@example.test",
        ],
        role: "Confirmer",
        download: true,
      };
    const first = await owner.call(
      "post",
      `/api/projects/${project.id}/invites`,
      body,
      key,
    );
    expect(first.status).toBe(200);
    expect(first.body.invitations).toHaveLength(2);
    const again = await owner.call(
      "post",
      `/api/projects/${project.id}/invites`,
      body,
      key,
    );
    expect(again.body).toEqual(first.body);
    expect(
      (
        await owner.call("post", `/api/projects/${project.id}/invites`, {
          ...body,
          emails: ["valid@example.test", "invalid"],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner.call("post", `/api/projects/${project.id}/invites`, {
          ...body,
          emails: Array.from(
            { length: 11 },
            (_, i) => `limit-${i}@example.test`,
          ),
        })
      ).status,
    ).toBe(400);
    expect(
      many("SELECT * FROM members WHERE project_id=?", project.id),
    ).toHaveLength(2);
    const list = (
      await owner.call("get", `/api/projects/${project.id}/handoff`)
    ).body;
    expect(
      list.members.every(
        (member: any) => member.min_version === release.version,
      ),
    ).toBe(true);
  });
  test("export retry preserves the task and reserves once, without crossing tenants", async () => {
    const original = await owner.call(
      "post",
      `/api/releases/${release.id}/exports`,
      { format: "html", paper: "A4" },
    );
    const jobId = original.body.jobId;
    run(
      "UPDATE jobs SET state='failed',error='JOB_FAILED',attempts=2 WHERE id=?",
      jobId,
    );
    run("UPDATE usage SET reserved=0 WHERE task_id=?", jobId);
    expect(
      (
        await outsider.call("post", `/api/jobs/${jobId}/retry`, {
          reason: "Retry this export",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await owner.call("post", `/api/jobs/${jobId}/retry`, {
          reason: "Retry this export",
        })
      ).body.jobId,
    ).toBe(jobId);
    await owner.call("post", `/api/jobs/${jobId}/retry`, {
      reason: "Retry this export",
    });
    expect(
      one("SELECT reserved FROM usage WHERE task_id=?", jobId)?.reserved,
    ).toBe(1);
    await processJobs();
    const activity = (
      await owner.call("get", `/api/projects/${project.id}/jobs`)
    ).body.find((job: any) => job.id === jobId);
    expect(activity).toMatchObject({
      state: "succeeded",
      releaseId: release.id,
      format: "html",
      paper: "A4",
    });
    expect(activity.availableUntil).toBeGreaterThan(Date.now());
    expect(
      one("SELECT committed FROM usage WHERE task_id=?", jobId)?.committed,
    ).toBe(1);
  });
  test("order checks use authoritative facts, reject mismatches and enforce cooldown", async () => {
    expect(
      (await outsider.call("get", `/api/billing/orders/${orderId}`)).status,
    ).toBe(404);
    process.env.BILLING_ADAPTER_URL = "https://billing-adapter.example.test";
    const pending = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "pending", orderId }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", pending);
    try {
      const response = await owner.call(
        "post",
        `/api/billing/orders/${orderId}/check`,
        {},
      );
      expect(response.status).toBe(200);
      expect(pending.mock.calls[0][0]).toContain(`/orders/${orderId}`);
      expect(
        (await owner.call("post", `/api/billing/orders/${orderId}/check`, {}))
          .status,
      ).toBe(429);
      run("DELETE FROM order_checks WHERE order_id=?", orderId);
      pending.mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "wrong",
            status: "paid",
            orderId: randomUUID(),
            amount: 1900,
            currency: "USD",
            environment: "sandbox",
            paidAt: new Date().toISOString(),
          }),
          { status: 200 },
        ),
      );
      expect(
        (await owner.call("post", `/api/billing/orders/${orderId}/check`, {}))
          .status,
      ).toBe(400);
      expect(one("SELECT status FROM orders WHERE id=?", orderId)?.status).toBe(
        "paid",
      );
    } finally {
      delete process.env.BILLING_ADAPTER_URL;
      vi.unstubAllGlobals();
    }
  });
});
describe("Content comparison and three-way merge", () => {
  test("merges independent fields and additions while requiring an explicit choice for conflicting edits", () => {
    const base = {
      intro: "Original",
      guides: [
        {
          id: "g1",
          title: "First",
          steps: [{ id: "s1", body: "Before", expected: "Old result" }],
        },
      ],
    };
    const local = structuredClone(base);
    local.guides[0].steps[0].body = "My instruction";
    const server = structuredClone(base);
    server.intro = "New overview";
    server.guides[0].steps[0].expected = "New result";
    expect(mergeContent(base, local, server)).toMatchObject({
      conflicts: [],
      value: {
        intro: "New overview",
        guides: [
          { steps: [{ body: "My instruction", expected: "New result" }] },
        ],
      },
    });
    server.guides[0].steps[0].body = "Server instruction";
    const conflict = mergeContent(base, local, server);
    expect(conflict.conflicts).toHaveLength(1);
    const merged = mergeContent(base, local, server, {
      [conflict.conflicts[0].path]: "Merged instruction",
    });
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.value.guides[0].steps[0].body).toBe("Merged instruction");
    expect(
      contentChanges(base, server).some((change) =>
        change.path.includes("expected"),
      ),
    ).toBe(true);
  });
});

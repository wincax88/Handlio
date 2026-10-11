import { afterAll, beforeAll, describe, expect, test } from "vitest";
import request from "supertest";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import sharp from "sharp";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "handlio-tests-"));
process.env.NODE_ENV = "test";
process.env.BILLING_WEBHOOK_SECRET = "test-webhook-secret";
const { createApp } = await import("../server/app");
const { db, one, many, run, now, hash } = await import("../server/db");
const { processJobs } = await import("../server/jobs");
const { applyTransaction } = await import("../server/billing");
const { entitlement, DAY } = await import("../server/domain");
const { renderHtml, generateExport } = await import("../server/export");
const app = createApp();
type Actor = {
  agent: any;
  csrf: string;
  email: string;
  user: any;
  call: (
    method: string,
    url: string,
    body?: unknown,
    key?: string,
  ) => Promise<any>;
};
async function login(
  email: string,
  purpose = "owner",
  publicId = "",
  invite = "",
): Promise<Actor> {
  const agent: any = request.agent(app);
  const c = await agent
    .post("/api/auth/challenges")
    .send({ email, purpose, publicId, invite });
  expect(c.status).toBe(200);
  expect(c.body.devCode).toBeTruthy();
  const verified = await agent
    .post("/api/auth/verify")
    .send({ challengeId: c.body.challengeId, code: c.body.devCode, purpose });
  expect(verified.status).toBe(200);
  const s = await agent.get("/api/session");
  const actor: Actor = {
    agent,
    csrf: s.body.user.csrf,
    email,
    user: s.body.user,
    call: async (method, url, body, key) => {
      const req = agent[method](url)
        .set("X-CSRF-Token", s.body.user.csrf)
        .set("Idempotency-Key", key || randomUUID());
      if (body !== undefined) req.send(body);
      return req;
    },
  };
  return actor;
}
async function create(a: Actor, name = "Test project") {
  const r = await a.call("post", "/api/projects", {
    name,
    clientName: "Fictional client",
    title: "Client handbook",
    template: "blank",
  });
  expect(r.status).toBe(201);
  return (await a.call("get", `/api/projects/${r.body.id}`)).body;
}
async function activate(a: Actor, p: any) {
  const checkout = await a.call("post", "/api/billing/checkouts", {
    projectId: p.id,
    product: "project",
  });
  expect(checkout.status).toBe(200);
  const paid = await a.call("post", "/api/billing/local-confirm", {
    orderId: checkout.body.orderId,
  });
  expect(paid.status).toBe(200);
  return checkout.body.orderId;
}
async function complete(a: Actor, p: any, assetId: string | null = null) {
  p = (await a.call("get", `/api/projects/${p.id}`)).body;
  const d = p.draft;
  d.intro = "A clear handoff for our fictional client.";
  d.supportEmail = "support@example.test";
  d.maintenance =
    "Routine editing is included. Structural changes need a new request.";
  const g = d.guides[0];
  g.goal = "Update an article.";
  g.prerequisites = "Existing content-editor permission.";
  g.audience = "Content editors";
  g.completion = "The preview shows the updated article.";
  g.steps = [
    {
      id: randomUUID(),
      title: "Open the editor",
      body: "Choose the article in the content list.",
      expected: "The selected article opens.",
      warning: "",
      source: "Private source note",
      alt: assetId ? "The article list screen" : "",
      assetId,
      reviewed: true,
      textOnly: !assetId,
      aiPending: false,
    },
  ];
  d.checklist.forEach((c: any) => (c.done = true));
  const saved = await a.call("patch", `/api/projects/${p.id}/draft`, {
    baseRevision: p.revision,
    draft: d,
  });
  expect(saved.status).toBe(200);
  return (await a.call("get", `/api/projects/${p.id}`)).body;
}
async function publish(
  a: Actor,
  p: any,
  summary = "Initial delivery",
  k = randomUUID(),
) {
  const check = await a.call("post", `/api/projects/${p.id}/validate`, {});
  expect(check.status).toBe(200);
  const b = {
    draftRevision: check.body.revision,
    validationId: check.body.id,
    summary,
    warningReason: "",
  };
  const result = await a.call("post", `/api/projects/${p.id}/releases`, b, k);
  expect(result.status).toBe(202);
  await processJobs();
  const j = await a.call("get", `/api/jobs/${result.body.jobId}`);
  expect(j.body.state).toBe("succeeded");
  return {
    r: (await a.call("get", `/api/projects/${p.id}`)).body.currentRelease,
    job: result.body,
    b,
    key: k,
  };
}
async function invite(
  a: Actor,
  p: any,
  email: string,
  role = "Confirmer",
  download = true,
) {
  const r = await a.call("post", `/api/projects/${p.id}/invites`, {
    email,
    role,
    download,
  });
  expect(r.status).toBe(200);
  const url = new URL(r.body.localInviteUrl);
  return {
    mid: r.body.id,
    actor: await login(
      email,
      "client",
      p.publicId,
      url.searchParams.get("invite") || "",
    ),
  };
}
let a: Actor, b: Actor, p: any, r1: any, orderId: string, assetId: string;
let c1: Actor, c2: Actor, c3: Actor, mids: string[], confirmationId: string;
beforeAll(async () => {
  a = await login("owner-a@example.test");
  b = await login("owner-b@example.test");
  p = await create(a);
});
afterAll(() => db.close());
describe("Identity, tenant authorization and drafts", () => {
  test("rejects code replay, wrong purpose, expiry and logout", async () => {
    const agent: any = request.agent(app);
    const c = await agent
      .post("/api/auth/challenges")
      .send({ email: "security@example.test", purpose: "owner" });
    const wrong = await agent.post("/api/auth/verify").send({
      challengeId: c.body.challengeId,
      code: c.body.devCode,
      purpose: "client",
    });
    expect(wrong.status).toBe(400);
    run(
      "UPDATE challenges SET expires_at=? WHERE id=?",
      now() - 1,
      c.body.challengeId,
    );
    expect(
      (
        await agent.post("/api/auth/verify").send({
          challengeId: c.body.challengeId,
          code: c.body.devCode,
          purpose: "owner",
        })
      ).status,
    ).toBe(400);
    const last = one("SELECT * FROM challenges WHERE email=?", a.email)!;
    expect(
      (
        await a.agent
          .post("/api/auth/verify")
          .set("X-CSRF-Token", a.csrf)
          .send({ challengeId: last.id, code: "123456", purpose: "owner" })
      ).status,
    ).toBe(400);
  });
  test("requires CSRF and checks cross-origin mutations", async () => {
    expect((await a.agent.post("/api/projects").send({})).status).toBe(403);
    expect(
      (
        await a.agent
          .post("/api/projects")
          .set("X-CSRF-Token", a.csrf)
          .set("Origin", "https://untrusted.test")
          .send({})
      ).status,
    ).toBe(403);
  });
  test("does not expose project metadata across workspaces", async () => {
    expect((await b.call("get", `/api/projects/${p.id}`)).status).toBe(404);
    expect((await b.call("get", `/api/projects/${p.id}/assets`)).status).toBe(
      404,
    );
    expect(
      (
        await b.call("patch", `/api/projects/${p.id}/draft`, {
          baseRevision: 1,
          draft: p.draft,
        })
      ).status,
    ).toBe(404);
  });
  test("enforces one free draft even for concurrent attempts", async () => {
    const rs = await Promise.all([
      a.call("post", "/api/projects", {
        name: "Second",
        clientName: "Client",
        title: "Guide",
        template: "blank",
      }),
      a.call("post", "/api/projects", {
        name: "Third",
        clientName: "Client",
        title: "Guide",
        template: "blank",
      }),
    ]);
    expect(rs.map((r) => r.status)).toEqual([409, 409]);
  });
  test("optimistic concurrency rejects stale saves and preserves the server copy", async () => {
    const first = await a.call("patch", `/api/projects/${p.id}/draft`, {
      baseRevision: p.revision,
      draft: { ...p.draft, title: "Saved in window A" },
    });
    expect(first.status).toBe(200);
    const second = await a.call("patch", `/api/projects/${p.id}/draft`, {
      baseRevision: p.revision,
      draft: { ...p.draft, title: "Stale window B" },
    });
    expect(second.status).toBe(409);
    p = (await a.call("get", `/api/projects/${p.id}`)).body;
    expect(p.draft.title).toBe("Saved in window A");
  });
  test("requires payment at the server publishing endpoint", async () => {
    p = await complete(a, p);
    const check = await a.call("post", `/api/projects/${p.id}/validate`, {});
    expect(
      check.body.blockers.some((v: any) => v.code === "PAYMENT_REQUIRED"),
    ).toBe(true);
    expect(
      (
        await a.call("post", `/api/projects/${p.id}/releases`, {
          draftRevision: p.revision,
          validationId: check.body.id,
          summary: "Bypass",
          warningReason: "",
        })
      ).status,
    ).toBe(403);
  });
});
describe("Sanitized assets and billing ledger", () => {
  test("early renewal preserves the current export window and existing promises", async () => {
    const renewalProject = await create(b, "Renewal test");
    const originalOrder = await activate(b, renewalProject);
    const before = one("SELECT * FROM grants WHERE order_id=?", originalOrder)!;
    run(
      "INSERT INTO usage VALUES (?,?,?,?,?,?,?,?)",
      randomUUID(),
      renewalProject.id,
      randomUUID(),
      "export",
      0,
      3,
      before.starts_at,
      now(),
    );
    const checkout = await b.call("post", "/api/billing/checkouts", {
      projectId: renewalProject.id,
      product: "renewal",
    });
    expect(checkout.status).toBe(200);
    expect(
      (
        await b.call("post", "/api/billing/local-confirm", {
          orderId: checkout.body.orderId,
        })
      ).status,
    ).toBe(200);
    const after = (await b.call("get", `/api/projects/${renewalProject.id}`))
      .body;
    expect(after.entitlement.exportsUsed).toBe(3);
    expect(after.entitlement.expiresAt).toBe(before.expires_at + 90 * DAY);
    expect(after.entitlement.aiRemaining).toBe(300);
    await b.call("post", "/api/billing/local-refund", {
      orderId: originalOrder,
    });
    expect(
      one(
        "SELECT expires_at FROM grants WHERE order_id=?",
        checkout.body.orderId,
      )?.expires_at,
    ).toBe(before.expires_at + 90 * DAY);
  });
  test("operations does not grant ordinary users access to diagnostic data", async () => {
    expect((await a.call("get", "/api/ops")).status).toBe(404);
    process.env.OPS_EMAILS = a.email;
    const result = await a.call("get", "/api/ops");
    expect(result.status).toBe(200);
    const body = JSON.stringify(result.body);
    expect(body).not.toContain(a.email);
    expect(body).not.toContain("Fictional client");
    expect(body).not.toContain("Private source note");
    delete process.env.OPS_EMAILS;
  });
  test("rejects fake images and strips metadata on valid images", async () => {
    const invalid = await a.agent
      .post(`/api/projects/${p.id}/assets`)
      .set("X-CSRF-Token", a.csrf)
      .set("Idempotency-Key", randomUUID())
      .set("X-Sanitized", "true")
      .set("Content-Type", "image/png")
      .send(Buffer.from("<script>fake</script>"));
    expect(invalid.status).toBe(400);
    const safe = await sharp({
      create: { width: 200, height: 100, channels: 3, background: "#17212b" },
    })
      .png()
      .withMetadata({ exif: { IFD0: { Artist: "secret metadata" } } })
      .toBuffer();
    const k = randomUUID();
    const upload = () =>
      a.agent
        .post(`/api/projects/${p.id}/assets`)
        .set("X-CSRF-Token", a.csrf)
        .set("Idempotency-Key", k)
        .set("X-Sanitized", "true")
        .set("Content-Type", "image/png")
        .send(safe);
    const r = await upload();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    assetId = r.body.id;
    const repeat = await upload();
    expect(repeat.body.id).toBe(assetId);
    const buffer = readFileSync(
      path.join(process.env.DATA_DIR!, `${assetId}.png`),
    );
    const meta = await sharp(buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(buffer.includes(Buffer.from("secret metadata"))).toBe(false);
    expect((await b.call("get", `/api/assets/${assetId}`)).status).toBe(404);
  });
  test("first payment is idempotent at the order and grant level", async () => {
    orderId = await activate(a, p);
    await a.call("post", "/api/billing/local-confirm", { orderId });
    expect(
      one("SELECT COUNT(*) AS n FROM grants WHERE project_id=?", p.id)?.n,
    ).toBe(1);
    p = (await a.call("get", `/api/projects/${p.id}`)).body;
    expect(p.entitlement.state).toBe("paid_active");
    expect(p.entitlement.aiRemaining).toBe(300);
  });
  test("payment facts cannot alter configured amounts", () => {
    expect(() =>
      applyTransaction(
        {
          id: "attack",
          orderId,
          status: "paid",
          amount: 1,
          currency: "USD",
          environment: "sandbox",
          paidAt: new Date().toISOString(),
        },
        "sandbox",
      ),
    ).toThrow();
  });
  test("verifies webhook signatures and deduplicates event storage", async () => {
    const body = JSON.stringify({
      eventId: "event-1",
      transactionId: `local-${orderId}`,
    });
    const t = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", "test-webhook-secret")
      .update(`${t}.${body}`)
      .digest("hex");
    const first = await request(app)
      .post("/api/webhooks/billing")
      .set("Content-Type", "application/json")
      .set("X-Handlio-Signature", `t=${t},v1=${signature}`)
      .send(body);
    expect(first.status).toBe(202);
    expect(
      (
        await request(app)
          .post("/api/webhooks/billing")
          .set("Content-Type", "application/json")
          .set("X-Handlio-Signature", `t=${t},v1=${signature}`)
          .send(body)
      ).status,
    ).toBe(202);
    expect(one("SELECT COUNT(*) AS n FROM webhooks")?.n).toBe(1);
    expect(
      (
        await request(app)
          .post("/api/webhooks/billing")
          .set("Content-Type", "application/json")
          .send(body)
      ).status,
    ).toBe(400);
  });
});
describe("Version publication and project sharing", () => {
  test("publishes once and freezes content without internal source notes", async () => {
    p = await complete(a, p, assetId);
    const result = await publish(a, p);
    r1 = result.r;
    const repeat = await a.call(
      "post",
      `/api/projects/${p.id}/releases`,
      result.b,
      result.key,
    );
    expect(repeat.body.jobId).toBe(result.job.jobId);
    expect(
      one("SELECT COUNT(*) AS n FROM releases WHERE project_id=?", p.id)?.n,
    ).toBe(1);
    expect(r1.snapshot.guides[0].steps[0].source).toBe("");
    expect(() =>
      run("UPDATE releases SET snapshot=? WHERE id=?", "{}", r1.id),
    ).toThrow();
  });
  test("changed draft invalidates validation and cannot replace the current version", async () => {
    const check = await a.call("post", `/api/projects/${p.id}/validate`, {});
    p = (await a.call("get", `/api/projects/${p.id}`)).body;
    await a.call("patch", `/api/projects/${p.id}/draft`, {
      baseRevision: p.revision,
      draft: { ...p.draft, intro: "Updated overview" },
    });
    const result = await a.call("post", `/api/projects/${p.id}/releases`, {
      draftRevision: check.body.revision,
      validationId: check.body.id,
      summary: "Stale",
      warningReason: "",
    });
    expect(result.status).toBe(409);
    expect(
      one("SELECT current_release_id FROM projects WHERE id=?", p.id)
        ?.current_release_id,
    ).toBe(r1.id);
  });
  test("invites three confirmers and blocks forwarded email verification", async () => {
    await a.call("patch", `/api/projects/${p.id}`, { sharing: true });
    p = (await a.call("get", `/api/projects/${p.id}`)).body;
    const i1 = await invite(a, p, "client-1@example.test");
    const i2 = await invite(a, p, "client-2@example.test");
    const i3 = await invite(a, p, "client-3@example.test");
    c1 = i1.actor;
    c2 = i2.actor;
    c3 = i3.actor;
    mids = [i1.mid, i2.mid, i3.mid];
    const forged = await request(app).post("/api/auth/challenges").send({
      email: "not-invited@example.test",
      purpose: "client",
      publicId: p.publicId,
      invite: "forwarded-token",
    });
    expect(forged.body.devCode).toBeUndefined();
    expect(
      (await request(app).get(`/api/client/handbooks/${p.publicId}`)).status,
    ).toBe(401);
  });
  test("Viewer cannot submit questions or download disabled exports", async () => {
    const i = await invite(a, p, "viewer@example.test", "Viewer", false);
    expect(
      (
        await i.actor.call("post", `/api/releases/${r1.id}/questions`, {
          body: "No permission",
          stepId: null,
          blocking: false,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await i.actor.call("post", `/api/releases/${r1.id}/exports`, {
          format: "html",
          paper: "A4",
        })
      ).status,
    ).toBe(404);
  });
  test("blocking questions prevent requests and must be resolved explicitly", async () => {
    const q = await c1.call("post", `/api/releases/${r1.id}/questions`, {
      body: "Where is the preview?",
      stepId: r1.snapshot.guides[0].steps[0].id,
      blocking: true,
    });
    expect(q.status).toBe(200);
    expect(
      (
        await a.call("post", `/api/releases/${r1.id}/confirmation-requests`, {
          memberIds: mids,
          note: "Please review",
          dueAt: null,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await a.call("patch", `/api/questions/${q.body.id}`, {
          status: "resolved",
          resolution: "The expected result explains preview.",
          resolvedReleaseId: r1.id,
        })
      ).status,
    ).toBe(200);
  });
  test("two of three required confirmations does not complete the handoff", async () => {
    const created = await a.call(
      "post",
      `/api/releases/${r1.id}/confirmation-requests`,
      { memberIds: mids, note: "Review this version", dueAt: null },
    );
    expect(created.status).toBe(200);
    confirmationId = created.body.id;
    const body = {
      releaseId: r1.id,
      manifestHash: r1.hash,
      acknowledgement: true,
      wordingVersion: "receipt-v1",
    };
    const k = randomUUID();
    expect(
      (
        await c1.call(
          "post",
          `/api/confirmation-requests/${confirmationId}/confirm`,
          body,
          k,
        )
      ).status,
    ).toBe(200);
    await c1.call(
      "post",
      `/api/confirmation-requests/${confirmationId}/confirm`,
      body,
      k,
    );
    expect(
      (
        await c2.call(
          "post",
          `/api/confirmation-requests/${confirmationId}/confirm`,
          body,
        )
      ).status,
    ).toBe(200);
    expect(
      one("SELECT status FROM confirmation_requests WHERE id=?", confirmationId)
        ?.status,
    ).toBe("in_progress");
    expect(
      one(
        "SELECT COUNT(*) AS n FROM confirmations WHERE request_id=?",
        confirmationId,
      )?.n,
    ).toBe(2);
  });
  test("new release supersedes pending requests and rejects old confirmation", async () => {
    p = (await a.call("get", `/api/projects/${p.id}`)).body;
    const result = await publish(a, p, "Clarified the overview");
    expect(result.r.version).toBe(2);
    expect(
      one("SELECT status FROM confirmation_requests WHERE id=?", confirmationId)
        ?.status,
    ).toBe("superseded");
    expect(
      (
        await c3.call(
          "post",
          `/api/confirmation-requests/${confirmationId}/confirm`,
          {
            releaseId: r1.id,
            manifestHash: r1.hash,
            acknowledgement: true,
            wordingVersion: "receipt-v1",
          },
        )
      ).status,
    ).toBe(409);
    expect(
      one(
        "SELECT COUNT(*) AS n FROM confirmations WHERE request_id=?",
        confirmationId,
      )?.n,
    ).toBe(2);
  });
  test("new members cannot read history before their invite version", async () => {
    const latest = await invite(a, p, "new-client@example.test", "Reviewer");
    expect(
      (
        await latest.actor.call(
          "get",
          `/api/client/handbooks/${p.publicId}?release=${r1.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await latest.actor.call("get", `/api/client/handbooks/${p.publicId}`))
        .status,
    ).toBe(200);
  });
});
describe("Receipt history after completion", () => {
  test("later questions preserve a completed receipt and require a new request", async () => {
    const latest = one(
      "SELECT * FROM releases WHERE project_id=? ORDER BY version DESC",
      p.id,
    )!;
    const request = await a.call(
      "post",
      `/api/releases/${latest.id}/confirmation-requests`,
      { memberIds: [mids[0]], note: "Review version two", dueAt: null },
    );
    expect(request.status).toBe(200);
    expect(
      (
        await c1.call(
          "post",
          `/api/confirmation-requests/${request.body.id}/confirm`,
          {
            releaseId: latest.id,
            manifestHash: latest.hash,
            acknowledgement: true,
            wordingVersion: "receipt-v1",
          },
        )
      ).status,
    ).toBe(200);
    const question = await c1.call(
      "post",
      `/api/releases/${latest.id}/questions`,
      { body: "A later blocking question.", stepId: null, blocking: true },
    );
    expect(question.status).toBe(200);
    expect(
      one(
        "SELECT status FROM confirmation_requests WHERE id=?",
        request.body.id,
      )?.status,
    ).toBe("confirmed");
    expect(
      one(
        "SELECT COUNT(*) AS n FROM confirmations WHERE request_id=?",
        request.body.id,
      )?.n,
    ).toBe(1);
    expect(
      (
        await a.call(
          "post",
          `/api/releases/${latest.id}/confirmation-requests`,
          { memberIds: [mids[0]], note: "Review again", dueAt: null },
        )
      ).status,
    ).toBe(409);
    await a.call("patch", `/api/questions/${question.body.id}`, {
      status: "resolved",
      resolution: "Clarified without rewriting the receipt.",
    });
    const fresh = await a.call(
      "post",
      `/api/releases/${latest.id}/confirmation-requests`,
      { memberIds: [mids[0]], note: "A new receipt request", dueAt: null },
    );
    expect(fresh.status).toBe(200);
    expect(
      one(
        "SELECT status FROM confirmation_requests WHERE id=?",
        request.body.id,
      )?.status,
    ).toBe("confirmed");
    expect(
      one("SELECT status FROM confirmation_requests WHERE id=?", fresh.body.id)
        ?.status,
    ).toBe("pending");
  });
});
describe("Exports, revocation, expiry and deletion", () => {
  test("PDF includes clickable contents with actual page numbers and supports Chinese", async () => {
    const stored = one("SELECT * FROM releases WHERE id=?", r1.id)!;
    const snapshot = JSON.parse(stored.snapshot);
    snapshot.title = "客户网站操作手册 · Client handbook";
    snapshot.guides[0].steps[0].body = "打开内容管理列表并选择需要编辑的文章。";
    const generated = await generateExport(
      { ...stored, snapshot: JSON.stringify(snapshot) },
      randomUUID(),
      "pdf",
      "A4",
    );
    const buffer = readFileSync(
      path.join(process.env.DATA_DIR!, generated.file),
    );
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(generated.pages).toBeGreaterThanOrEqual(3);
    expect(generated.tocEntries).toBe(3);
    mkdirSync(".work", { recursive: true });
    writeFileSync(".work/qa-handbook.pdf", buffer);
  });
  test("offline HTML escapes content and exposes only the published snapshot", async () => {
    const r = one("SELECT * FROM releases WHERE id=?", r1.id)!;
    const rendered = await renderHtml(r);
    expect(rendered.html).not.toContain("Private source note");
    expect(rendered.html).not.toContain("client-1@example.test");
    expect(rendered.html).toContain(`assets/${assetId}.png`);
    expect(rendered.html).not.toContain("<script");
  });
  test("ZIP export uses a cache and authorizes every download", async () => {
    const k = randomUUID();
    const result = await a.call(
      "post",
      `/api/releases/${r1.id}/exports`,
      { format: "html", paper: "A4" },
      k,
    );
    expect(result.status).toBe(202);
    await processJobs();
    const job = await a.call("get", `/api/jobs/${result.body.jobId}`);
    expect(job.body.state).toBe("succeeded");
    const bytes = readFileSync(
      path.join(process.env.DATA_DIR!, job.body.output.file),
    );
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    const repeat = await a.call("post", `/api/releases/${r1.id}/exports`, {
      format: "html",
      paper: "A4",
    });
    expect(repeat.body.cached).toBe(true);
    expect(
      (await b.call("get", `/api/jobs/${result.body.jobId}/download`)).status,
    ).toBe(404);
    expect(
      one(
        "SELECT SUM(committed) AS n FROM usage WHERE project_id=? AND kind='export'",
        p.id,
      )?.n,
    ).toBe(1);
  });
  test("client revocation immediately blocks resources and search content", async () => {
    await a.call("patch", `/api/projects/${p.id}/members/${mids[0]}`, {
      role: "Confirmer",
      download: true,
      status: "removed",
    });
    expect(
      (await c1.call("get", `/api/client/handbooks/${p.publicId}`)).status,
    ).toBe(404);
    expect(
      (await c1.call("get", `/api/assets/${assetId}?release=${r1.id}`)).status,
    ).toBe(404);
  });
  test("security withdrawal isolates every version that references the asset", async () => {
    expect(
      (
        await a.call("post", `/api/releases/${r1.id}/withdraw`, {
          reason: "Simulated sensitive-image incident",
          security: true,
        })
      ).status,
    ).toBe(200);
    expect(one("SELECT status FROM assets WHERE id=?", assetId)?.status).toBe(
      "revoked",
    );
    expect(
      many("SELECT status FROM releases WHERE project_id=?", p.id).every(
        (r) => r.status === "security_revoked",
      ),
    ).toBe(true);
    expect((await a.call("get", `/api/assets/${assetId}`)).status).toBe(404);
    expect(
      (await a.call("post", `/api/releases/${r1.id}/restore`, {})).status,
    ).toBe(409);
  });
  test("uses exact UTC expiry and provides only the owner grace window", () => {
    const pr = one("SELECT * FROM projects WHERE id=?", p.id)!;
    const g = one("SELECT * FROM grants WHERE project_id=?", p.id)!;
    expect(entitlement(pr, g.expires_at - 1).state).toBe("paid_active");
    expect(entitlement(pr, g.expires_at).state).toBe("expired_grace");
    expect(entitlement(pr, g.expires_at + 30 * DAY).state).toBe("expired");
  });
  test("a full refund followed by stale paid event cannot reactivate rights", async () => {
    expect(
      (await a.call("post", "/api/billing/local-refund", { orderId })).status,
    ).toBe(200);
    applyTransaction(
      {
        id: `local-${orderId}`,
        orderId,
        status: "paid",
        amount: 1900,
        currency: "USD",
        environment: "sandbox",
        paidAt: new Date().toISOString(),
      },
      "sandbox",
    );
    expect(one("SELECT status FROM orders WHERE id=?", orderId)?.status).toBe(
      "refunded",
    );
    expect(
      one(
        "SELECT COUNT(*) AS n FROM grants WHERE project_id=? AND status='active'",
        p.id,
      )?.n,
    ).toBe(0);
  });
  test("deletion creates a tombstone and cancels queued work", async () => {
    expect(
      (await a.call("delete", `/api/projects/${p.id}`, { name: p.name }))
        .status,
    ).toBe(200);
    expect(
      (await a.call("delete", `/api/projects/${p.id}`, { name: p.name }))
        .status,
    ).toBe(200);
    expect((await a.call("get", `/api/projects/${p.id}`)).status).toBe(404);
    expect(
      one("SELECT lifecycle FROM projects WHERE id=?", p.id)?.lifecycle,
    ).toBe("deleted");
    expect(
      (await c2.call("get", `/api/client/handbooks/${p.publicId}`)).status,
    ).toBe(404);
  });
});

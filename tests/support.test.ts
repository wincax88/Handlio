import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";

process.env.DATA_DIR = mkdtempSync(
  path.join(tmpdir(), "handlio-support-tests-"),
);
process.env.NODE_ENV = "test";
const { createApp } = await import("../server/app");
const { one, run } = await import("../server/db");
const { processNotifications } = await import("../server/providers");
const app = createApp();

function mockMail() {
  vi.stubEnv("MAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "unit-test-secret");
  vi.stubEnv("MAIL_FROM", "Handlio <notifications@handlio.cloud>");
  return vi.spyOn(globalThis, "fetch");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("support request email notifications", () => {
  test.each(["help", "privacy", "security", "refund"])(
    "%s requests send their reference, contact and message to support",
    async (kind) => {
      const fetcher = mockMail().mockResolvedValue(
        new Response(JSON.stringify({ id: `support-${kind}` })),
      );
      const email = "requester@example.test";
      const body = "Please help with my request.\nDetails: 中文 <example>.";
      const response = await request(app)
        .post("/api/support")
        .send({ email, kind, body });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: "open" });
      const sid = response.body.id;
      expect(
        one("SELECT * FROM support_requests WHERE id=?", sid),
      ).toMatchObject({
        email,
        kind,
        body,
        status: "open",
        user_id: null,
      });
      const entry = one(
        "SELECT * FROM notifications WHERE event_key=?",
        `support:${sid}`,
      )!;
      expect(entry).toMatchObject({
        recipient: "support@handlio.cloud",
        project_id: null,
        state: "queued",
      });

      await processNotifications();
      expect(fetcher).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
      expect(sent.to).toEqual(["support@handlio.cloud"]);
      expect(sent.from).toBe("Handlio <notifications@handlio.cloud>");
      expect(sent.subject).toContain(sid);
      for (const value of [sid, kind, email, body])
        expect(sent.text).toContain(value);
      expect(sent.html).toBeUndefined();
      expect(
        one("SELECT state FROM notifications WHERE id=?", entry.id)!.state,
      ).toBe("accepted");
      await processNotifications();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  test("provider failure preserves the request and retries with the same delivery key", async () => {
    const fetcher = mockMail()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "support-retry" })),
      );
    const response = await request(app).post("/api/support").send({
      email: "retry@example.test",
      kind: "help",
      body: "I need help signing in.",
    });
    expect(response.status).toBe(200);
    const sid = response.body.id;
    const entry = one(
      "SELECT * FROM notifications WHERE event_key=?",
      `support:${sid}`,
    )!;
    await processNotifications();
    expect(
      one("SELECT status FROM support_requests WHERE id=?", sid)!.status,
    ).toBe("open");
    expect(
      one("SELECT * FROM notifications WHERE id=?", entry.id),
    ).toMatchObject({
      state: "retry",
      attempts: 1,
    });
    run("UPDATE notifications SET next_at=0 WHERE id=?", entry.id);
    await processNotifications();
    expect(
      one("SELECT * FROM notifications WHERE id=?", entry.id),
    ).toMatchObject({
      state: "accepted",
      attempts: 2,
    });
    const keys = fetcher.mock.calls.map(
      (call) => (call[1]!.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys).toEqual([
      `notification/${entry.id}`,
      `notification/${entry.id}`,
    ]);
  });

  test("invalid submissions do not create a request or notification", async () => {
    const before = one("SELECT count(*) AS n FROM support_requests")!.n;
    const queued = one("SELECT count(*) AS n FROM notifications")!.n;
    const response = await request(app).post("/api/support").send({
      email: "invalid",
      kind: "help",
      body: "",
    });
    expect(response.status).toBe(400);
    expect(one("SELECT count(*) AS n FROM support_requests")!.n).toBe(before);
    expect(one("SELECT count(*) AS n FROM notifications")!.n).toBe(queued);
  });

  test("queue storage failure rolls back the request instead of reporting success", async () => {
    const before = one("SELECT count(*) AS n FROM support_requests")!.n;
    run(
      "CREATE TRIGGER reject_support_notification BEFORE INSERT ON notifications WHEN NEW.event_key LIKE 'support:%' BEGIN SELECT RAISE(ABORT, 'queue unavailable'); END",
    );
    try {
      const response = await request(app).post("/api/support").send({
        email: "rollback@example.test",
        kind: "help",
        body: "Please help.",
      });
      expect(response.status).toBe(500);
      expect(one("SELECT count(*) AS n FROM support_requests")!.n).toBe(before);
    } finally {
      run("DROP TRIGGER reject_support_notification");
    }
  });
});

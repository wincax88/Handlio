import { afterAll, expect, test } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "handlio-device-risk-"));
process.env.NODE_ENV = "test";
process.env.MAIL_PROVIDER = "local";
const { createApp } = await import("../server/app");
const { db, one, run } = await import("../server/db");
const { DEVICE_RISK_LIMITS } = await import("../server/device-risk");
const app = createApp();
const cookies = (response: { headers: Record<string, any> }): string[] =>
  Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"]
    : [response.headers["set-cookie"] || ""];
afterAll(() => db.close());

test("a signed browser identifier limits sending across different email addresses", async () => {
  const agent = request.agent(app);
  let cookie = "";
  for (let i = 0; i < DEVICE_RISK_LIMITS.challenges; i++) {
    const response = await agent
      .post("/api/auth/challenges")
      .send({ email: `device-send-${i}@example.test`, purpose: "owner" });
    expect(response.status).toBe(200);
    if (!i) {
      cookie = cookies(response).find((v: string) =>
        v.startsWith("handlio_device="),
      )!;
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/api/auth");
    }
  }
  const denied = await agent
    .post("/api/auth/challenges")
    .send({ email: "one-more@example.test", purpose: "owner" });
  expect(denied.status).toBe(429);
  expect(Number(denied.headers["retry-after"])).toBeGreaterThan(0);
  expect(
    one("SELECT * FROM challenges WHERE email='one-more@example.test'"),
  ).toBeUndefined();
  const risk = one(
    "SELECT * FROM auth_device_risk WHERE challenges=?",
    DEVICE_RISK_LIMITS.challenges,
  )!;
  expect(risk.device_digest).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(risk)).not.toContain("example.test");
  expect(JSON.stringify(risk)).not.toContain(cookie.split(";")[0]);
});

test("failed guesses accumulate across challenges and remain blocked after an app restart", async () => {
  const agent = request.agent(app);
  let cookie = "";
  for (let i = 0; i < DEVICE_RISK_LIMITS.failures; i++) {
    const response = await agent
      .post("/api/auth/verify")
      .send({ challengeId: randomUUID(), purpose: "owner", code: "000000" });
    expect(response.status).toBe(400);
    if (!i)
      cookie = cookies(response)
        .find((v: string) => v.startsWith("handlio_device="))!
        .split(";")[0];
  }
  const restarted = createApp();
  const blocked = await request(restarted)
    .post("/api/auth/verify")
    .set("Cookie", cookie)
    .send({ challengeId: randomUUID(), purpose: "owner", code: "000000" });
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(900);
  expect(
    (
      await agent
        .post("/api/auth/challenges")
        .send({ email: "blocked-device@example.test", purpose: "owner" })
    ).status,
  ).toBe(429);
  // A new device is independent; IP and email throttles still apply separately.
  expect(
    (
      await request(app)
        .post("/api/auth/verify")
        .send({ challengeId: randomUUID(), purpose: "owner", code: "000000" })
    ).status,
  ).toBe(400);
  const risk = one("SELECT * FROM auth_device_risk WHERE blocked_until>0")!;
  run(
    "UPDATE auth_device_risk SET window_started_at=? WHERE device_digest=?",
    Date.now() - DEVICE_RISK_LIMITS.window - 1,
    risk.device_digest,
  );
  expect(
    (
      await request(restarted)
        .post("/api/auth/verify")
        .set("Cookie", cookie)
        .send({ challengeId: randomUUID(), purpose: "owner", code: "000000" })
    ).status,
  ).toBe(429);
  run(
    "UPDATE auth_device_risk SET blocked_until=? WHERE device_digest=?",
    Date.now() - 1,
    risk.device_digest,
  );
  expect(
    (
      await request(restarted)
        .post("/api/auth/verify")
        .set("Cookie", cookie)
        .send({ challengeId: randomUUID(), purpose: "owner", code: "000000" })
    ).status,
  ).toBe(400);
  expect(
    one(
      "SELECT failures FROM auth_device_risk WHERE device_digest=?",
      risk.device_digest,
    )?.failures,
  ).toBe(1);
});

test("invalid signatures cannot select another device's counters and normal OTP login still works", async () => {
  const agent = request.agent(app);
  const response = await agent
    .post("/api/auth/challenges")
    .send({ email: "normal-device@example.test", purpose: "owner" });
  expect(response.status).toBe(200);
  const cookie = cookies(response)
    .find((v: string) => v.startsWith("handlio_device="))!
    .split(";")[0];
  const bad = cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0");
  const forged = await request(app)
    .post("/api/auth/verify")
    .set("Cookie", bad)
    .send({ challengeId: randomUUID(), purpose: "owner", code: "000000" });
  expect(
    cookies(forged).some((v: string) => v.startsWith("handlio_device=")),
  ).toBe(true);
  expect(forged.status).toBe(400);
  expect(
    (
      await agent.post("/api/auth/verify").send({
        challengeId: response.body.challengeId,
        purpose: "owner",
        code: response.body.devCode,
      })
    ).status,
  ).toBe(200);
  expect((await agent.get("/api/session")).body.user.email).toBe(
    "normal-device@example.test",
  );
});

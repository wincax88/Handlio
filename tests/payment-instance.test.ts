import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "handlio-instance-"));
process.env.NODE_ENV = "test";
const { db, one, run } = await import("../server/db");
const { validatePaymentInstance, expectedPaymentEnvironment } =
  await import("../server/payment-instance");
const hosted = {
  NODE_ENV: "production",
  PAYMENTS_SANDBOX_INSTANCE: "1",
  APP_ORIGIN: "https://sandbox.example.test",
  DODO_PAYMENTS_ENVIRONMENT: "test_mode",
};
beforeEach(() => {
  run("DELETE FROM billing_instance");
  run("DELETE FROM orders");
  vi.unstubAllEnvs();
});
afterAll(() => {
  vi.unstubAllEnvs();
  db.close();
});
test("sandbox requires its dedicated directory, production security and test mode", () => {
  expect(() => validatePaymentInstance(hosted, "/app/data")).toThrow(
    "own /app/sandbox-data",
  );
  expect(() =>
    validatePaymentInstance(
      { ...hosted, NODE_ENV: "development" },
      "/app/sandbox-data",
    ),
  ).toThrow();
  expect(() =>
    validatePaymentInstance(
      { ...hosted, APP_ORIGIN: "http://sandbox.example.test" },
      "/app/sandbox-data",
    ),
  ).toThrow();
  expect(() =>
    validatePaymentInstance(
      { ...hosted, DODO_PAYMENTS_ENVIRONMENT: "live_mode" },
      "/app/sandbox-data",
    ),
  ).toThrow();
  expect(one("SELECT * FROM billing_instance")).toBeUndefined();
});
test("an initialized sandbox is persistent and cannot become a live instance", () => {
  validatePaymentInstance(hosted, "/app/sandbox-data");
  validatePaymentInstance(hosted, "/app/sandbox-data");
  expect(one("SELECT kind FROM billing_instance")!.kind).toBe("sandbox");
  expect(() =>
    validatePaymentInstance({ NODE_ENV: "production" }, "/app/data"),
  ).toThrow("separate data volume");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PAYMENTS_SANDBOX_INSTANCE", "1");
  expect(expectedPaymentEnvironment()).toBe("sandbox");
});
test("existing live databases and unmarked legacy data cannot become a sandbox", () => {
  validatePaymentInstance({ NODE_ENV: "production" }, "/app/data");
  expect(() => validatePaymentInstance(hosted, "/app/sandbox-data")).toThrow(
    "separate data volume",
  );
  run("DELETE FROM billing_instance");
  run(
    "INSERT INTO orders (id,project_id,workspace_id,product,amount,currency,status,created_at) VALUES ('legacy','project','workspace','project',1900,'USD','paid',0)",
  );
  expect(() => validatePaymentInstance(hosted, "/app/sandbox-data")).toThrow(
    "existing database",
  );
  expect(one("SELECT * FROM billing_instance")).toBeUndefined();
});
test("production remains live unless its sandbox identity is proven", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PAYMENTS_SANDBOX_INSTANCE", "1");
  expect(expectedPaymentEnvironment()).toBe("production");
  run("INSERT INTO billing_instance VALUES (1,'live')");
  expect(expectedPaymentEnvironment()).toBe("production");
});

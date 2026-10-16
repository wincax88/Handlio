import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import request from "supertest";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "handlio-dodo-"));
process.env.NODE_ENV = "test";
process.env.MAIL_PROVIDER = "local";
const { createApp } = await import("../server/app");
const { one, run, many, db } = await import("../server/db");
const { processWebhooks } = await import("../server/billing");
const { reconcilePendingOrders, WEBHOOK_RETRY_COOLDOWN } =
  await import("../server/billing-recovery");
const app = createApp();
const secret = `whsec_${Buffer.from("test-only-dodo-signing-key-32-bytes").toString("base64")}`;
let agent: ReturnType<typeof request.agent>, csrf: string, projectId: string;
let other: ReturnType<typeof request.agent>, otherCsrf: string;
let catalog: any,
  payments: Record<string, any>,
  sessions: Record<string, any>,
  checkoutBodies: any[];
let failure = false;
const call = (url: string, body = {}, key = randomUUID()) =>
  agent
    .post(url)
    .set("X-CSRF-Token", csrf)
    .set("Idempotency-Key", key)
    .send(body);
async function signIn(email: string) {
  const a = request.agent(app);
  const c = await a
    .post("/api/auth/challenges")
    .send({ email, purpose: "owner" });
  await a.post("/api/auth/verify").send({
    challengeId: c.body.challengeId,
    code: c.body.devCode,
    purpose: "owner",
  });
  return { agent: a, csrf: (await a.get("/api/session")).body.user.csrf };
}
beforeAll(async () => {
  ({ agent, csrf } = await signIn("dodo-owner@example.test"));
  const o = await signIn("dodo-outsider@example.test");
  other = o.agent;
  otherCsrf = o.csrf;
  const p = await call("/api/projects", {
    name: "Dodo test",
    clientName: "Client",
    title: "Guide",
    template: "blank",
  });
  expect(p.status).toBe(201);
  projectId = p.body.id;
});
beforeEach(() => {
  vi.stubEnv("OPS_EMAILS", "");
  vi.stubEnv("BILLING_ADAPTER_URL", "");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PAYMENTS_SANDBOX_INSTANCE", "");
  run("DELETE FROM billing_instance");
  vi.stubEnv("BILLING_PROVIDER", "dodo");
  vi.stubEnv("DODO_PAYMENTS_API_KEY", "test-only-key");
  vi.stubEnv("DODO_PAYMENTS_WEBHOOK_KEY", secret);
  vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "test_mode");
  vi.stubEnv("DODO_PROJECT_PRODUCT_ID", "pdt_project");
  vi.stubEnv("DODO_RENEWAL_PRODUCT_ID", "pdt_renewal");
  catalog = {
    price: {
      type: "one_time_price",
      price: 1900,
      currency: "USD",
      tax_inclusive: false,
    },
    is_recurring: false,
  };
  payments = {};
  sessions = {};
  checkoutBodies = [];
  failure = false;
  for (const table of [
    "dodo_receipts",
    "order_receipts",
    "order_checks",
    "grants",
    "dodo_checkouts",
    "orders",
    "webhooks",
    "notifications",
    "idempotency",
  ])
    run(`DELETE FROM ${table}`);
  run("UPDATE projects SET sharing=0,lifecycle='active' WHERE id=?", projectId);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(
        process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode"
          ? "https://live.dodopayments.com"
          : "https://test.dodopayments.com",
      );
      if (failure)
        return new Response("{}", {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      let data: any;
      if (url.pathname.startsWith("/products/")) {
        const productId = url.pathname.split("/").pop();
        data = {
          ...catalog,
          product_id: productId,
          business_id: "bus_test",
          price: {
            ...catalog.price,
            price: productId === "pdt_renewal" ? 900 : catalog.price.price,
          },
        };
      } else if (url.pathname === "/checkouts" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        checkoutBodies.push(body);
        const sid = `cks_${randomUUID()}`;
        sessions[sid] = {
          id: sid,
          created_at: new Date().toISOString(),
          payment_id: null,
          payment_status: null,
        };
        data = {
          session_id: sid,
          checkout_url: `https://${process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "checkout" : "test.checkout"}.dodopayments.com/session/${sid}`,
        };
      } else if (url.pathname.startsWith("/checkouts/"))
        data = sessions[url.pathname.split("/").pop()!];
      else if (url.pathname.startsWith("/payments/"))
        data = payments[url.pathname.split("/").pop()!];
      else throw new Error(`Unexpected Dodo route ${url.pathname}`);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  db.close();
});

test("daily reconciliation recovers a missed webhook once without creating another checkout", async () => {
  const oid = await checkout();
  const payment = paymentFor(oid);
  run("UPDATE orders SET created_at=? WHERE id=?", Date.now() - 600000, oid);
  const results = await Promise.all([
    reconcilePendingOrders(),
    reconcilePendingOrders(),
  ]);
  expect(results.reduce((n, r) => n + r.checked, 0)).toBe(1);
  expect(one("SELECT status FROM orders WHERE id=?", oid)?.status).toBe("paid");
  expect(one("SELECT COUNT(*) AS n FROM grants WHERE order_id=?", oid)?.n).toBe(
    1,
  );
  expect(checkoutBodies).toHaveLength(1);
  expect((await reconcilePendingOrders()).checked).toBe(0);
  await event(payment);
  await processWebhooks();
  expect(one("SELECT COUNT(*) AS n FROM grants WHERE order_id=?", oid)?.n).toBe(
    1,
  );
});

test("pending lookups retain a durable daily schedule and respect manual verification cooldown", async () => {
  const oid = await checkout();
  run("UPDATE orders SET created_at=? WHERE id=?", Date.now() - 600000, oid);
  run("INSERT INTO order_checks VALUES (?,?)", oid, Date.now());
  expect((await reconcilePendingOrders()).checked).toBe(0);
  run("UPDATE order_checks SET checked_at=0 WHERE order_id=?", oid);
  expect((await reconcilePendingOrders()).checked).toBe(1);
  const schedule = one(
    "SELECT * FROM billing_reconciliations WHERE order_id=?",
    oid,
  )!;
  expect(schedule.state).toBe("succeeded");
  expect(schedule.next_at - schedule.checked_at).toBe(86400000);
  expect(one("SELECT status FROM orders WHERE id=?", oid)?.status).toBe(
    "pending",
  );
  const calls = vi.mocked(fetch).mock.calls.length;
  expect((await reconcilePendingOrders()).checked).toBe(0);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
  paymentFor(oid);
  run("UPDATE billing_reconciliations SET next_at=0 WHERE order_id=?", oid);
  run("UPDATE order_checks SET checked_at=0 WHERE order_id=?", oid);
  expect((await reconcilePendingOrders()).checked).toBe(1);
  expect(one("SELECT status FROM orders WHERE id=?", oid)?.status).toBe("paid");
});

test("a mismatched provider result cannot grant rights or starve another pending order", async () => {
  const badId = await checkout();
  const badPayment = paymentFor(badId, { total_amount: 1 });
  run("UPDATE orders SET status='failed' WHERE id=?", badId);
  const goodId = await checkout();
  paymentFor(goodId);
  run("UPDATE orders SET status='pending',created_at=?", Date.now() - 600000);
  expect(await reconcilePendingOrders()).toEqual({
    checked: 1,
    failed: 1,
    skipped: 0,
  });
  expect(one("SELECT status FROM orders WHERE id=?", badId)?.status).toBe(
    "pending",
  );
  expect(one("SELECT status FROM orders WHERE id=?", goodId)?.status).toBe(
    "paid",
  );
  const failed = one(
    "SELECT * FROM billing_reconciliations WHERE order_id=?",
    badId,
  )!;
  expect(failed.state).toBe("failed");
  expect(failed.error_code).toBe("PAYMENT_MISMATCH");
  expect(failed.next_at).toBeGreaterThan(Date.now());
  expect(
    one("SELECT COUNT(*) AS n FROM grants WHERE order_id=?", badId)?.n,
  ).toBe(0);
  vi.stubEnv("OPS_EMAILS", "dodo-owner@example.test");
  const diagnostics = (await agent.get("/api/ops")).body;
  expect(diagnostics.alerts).toContainEqual(
    expect.objectContaining({ id: badId, error_code: "PAYMENT_MISMATCH" }),
  );
  badPayment.total_amount = 2090;
  run("UPDATE billing_reconciliations SET next_at=0 WHERE order_id=?", badId);
  run("UPDATE order_checks SET checked_at=0 WHERE order_id=?", badId);
  expect((await reconcilePendingOrders()).checked).toBe(1);
  expect(
    one("SELECT COUNT(*) AS n FROM grants WHERE order_id=?", badId)?.n,
  ).toBe(1);
});

test("reconciliation excludes unsubmitted and other-environment checkouts and bounds each batch", async () => {
  const oid = await checkout();
  run("UPDATE orders SET created_at=? WHERE id=?", Date.now() - 600000, oid);
  run(
    "UPDATE dodo_checkouts SET environment='live_mode' WHERE order_id=?",
    oid,
  );
  expect((await reconcilePendingOrders()).checked).toBe(0);
  vi.stubEnv("BILLING_PROVIDER", "");
  expect((await reconcilePendingOrders()).checked).toBe(0);
  vi.stubEnv("BILLING_ADAPTER_URL", "https://billing-adapter.example.test");
  const pending = vi.fn(async (input: RequestInfo | URL) => {
    const id = new URL(String(input)).pathname.split("/").pop();
    return new Response(JSON.stringify({ orderId: id, status: "pending" }), {
      status: 200,
    });
  });
  vi.stubGlobal("fetch", pending);
  // A generic adapter must never query an order belonging to Dodo.
  expect((await reconcilePendingOrders()).checked).toBe(0);
  for (let i = 0; i < 12; i++)
    run(
      "INSERT INTO orders (id,project_id,workspace_id,product,amount,currency,status,checkout_url,created_at) SELECT ?,id,workspace_id,'project',1900,'USD','pending',?,? FROM projects WHERE id=?",
      `generic-${i}`,
      i === 11 ? null : "https://checkout.example.test/session",
      Date.now() - 600000,
      projectId,
    );
  expect((await reconcilePendingOrders()).checked).toBe(10);
  expect((await reconcilePendingOrders()).checked).toBe(1);
  expect(pending).toHaveBeenCalledTimes(11);
  expect(
    one("SELECT * FROM billing_reconciliations WHERE order_id='generic-11'"),
  ).toBeUndefined();
  vi.stubEnv("BILLING_ADAPTER_URL", "");
});

test("generic reconciliation verifies the original transaction and resumes an expired worker lease", async () => {
  vi.stubEnv("BILLING_PROVIDER", "");
  vi.stubEnv("BILLING_ADAPTER_URL", "https://billing-adapter.example.test");
  const oid = randomUUID();
  run(
    "INSERT INTO orders (id,project_id,workspace_id,product,amount,currency,status,checkout_url,created_at) SELECT ?,id,workspace_id,'project',1900,'USD','pending',?,? FROM projects WHERE id=?",
    oid,
    "https://checkout.example.test/session",
    Date.now() - 600000,
    projectId,
  );
  run(
    "INSERT INTO billing_reconciliations VALUES (?,?,?,'running',NULL)",
    oid,
    Date.now() - 1000000,
    Date.now() - 1,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "generic-transaction",
            orderId: oid,
            status: "paid",
            amount: 1900,
            currency: "USD",
            environment: "sandbox",
            paidAt: new Date().toISOString(),
          }),
          { status: 200 },
        ),
    ),
  );
  expect((await reconcilePendingOrders()).checked).toBe(1);
  expect(one("SELECT status FROM orders WHERE id=?", oid)?.status).toBe("paid");
  expect(one("SELECT COUNT(*) AS n FROM grants WHERE order_id=?", oid)?.n).toBe(
    1,
  );
  vi.stubEnv("BILLING_ADAPTER_URL", "");
});

test("dead webhook repair requires operations access, recent verification, CSRF and a reason", async () => {
  const oid = await checkout();
  const payment = paymentFor(oid);
  const deliveryId = randomUUID();
  const eid = `dodo:test_mode:${deliveryId}`;
  expect((await event(payment, "payment.succeeded", deliveryId)).status).toBe(
    200,
  );
  failure = true;
  for (let i = 0; i < 5; i++) await processWebhooks();
  expect(one("SELECT status FROM webhooks WHERE id=?", eid)?.status).toBe(
    "dead",
  );
  expect(
    (
      await call(`/api/ops/webhooks/${eid}/retry`, {
        reason: "Provider recovered",
      })
    ).status,
  ).toBe(404);
  vi.stubEnv("OPS_EMAILS", "dodo-owner@example.test");
  expect(
    (
      await agent
        .post(`/api/ops/webhooks/${eid}/retry`)
        .send({ reason: "Provider recovered" })
    ).status,
  ).toBe(403);
  expect(
    (await call(`/api/ops/webhooks/${eid}/retry`, { reason: "no" })).status,
  ).toBe(400);
  run(
    "UPDATE sessions SET verified_at=0 WHERE user_id=(SELECT id FROM users WHERE email='dodo-owner@example.test')",
  );
  expect(
    (
      await call(`/api/ops/webhooks/${eid}/retry`, {
        reason: "Provider recovered",
      })
    ).status,
  ).toBe(401);
  run(
    "UPDATE sessions SET verified_at=? WHERE user_id=(SELECT id FROM users WHERE email='dodo-owner@example.test')",
    Date.now(),
  );
  const metadata = (await agent.get(`/api/ops/webhooks/${eid}`)).body;
  expect(metadata.status).toBe("dead");
  expect(metadata.total_attempts).toBe(5);
  expect(metadata).not.toHaveProperty("body");
  expect((await agent.get("/api/ops")).body.alerts).toContainEqual(
    expect.objectContaining({ id: eid, error_code: "PAYMENT_WEBHOOK_DEAD" }),
  );
  const retried = await call(`/api/ops/webhooks/${eid}/retry`, {
    reason: "Provider recovered after outage",
  });
  expect(retried.status).toBe(202);
  expect(retried.body.status).toBe("queued");
  expect(retried.body.total_attempts).toBe(5);
  expect(retried.body).not.toHaveProperty("body");
  const audit = JSON.parse(
    one(
      "SELECT metadata FROM audit WHERE action='ops_webhook_retry' ORDER BY created_at DESC LIMIT 1",
    )!.metadata,
  );
  expect(audit).toMatchObject({
    webhookId: eid,
    reason: "Provider recovered after outage",
    before: { status: "dead", attempts: 5 },
    after: { status: "queued", attempts: 0 },
  });
  expect(one("SELECT status FROM orders WHERE id=?", oid)?.status).toBe(
    "pending",
  );
  const concurrent = await Promise.all([
    call(`/api/ops/webhooks/${eid}/retry`, { reason: "Another retry" }),
    call(`/api/ops/webhooks/${eid}/retry`, { reason: "Another retry" }),
  ]);
  expect(concurrent.map((r) => r.status)).toEqual([429, 429]);
  failure = false;
  await processWebhooks();
  expect(one("SELECT status FROM webhooks WHERE id=?", eid)?.status).toBe(
    "processed",
  );
  expect(one("SELECT COUNT(*) AS n FROM grants WHERE order_id=?", oid)?.n).toBe(
    1,
  );
});

test("repair preserves lifetime attempts and rejects wrong environments and completed events", async () => {
  const oid = await checkout();
  const payment = paymentFor(oid);
  const deliveryId = randomUUID();
  const eid = `dodo:test_mode:${deliveryId}`;
  expect((await event(payment, "payment.succeeded", deliveryId)).status).toBe(
    200,
  );
  vi.stubEnv("OPS_EMAILS", "dodo-owner@example.test");
  expect(
    (
      await call(`/api/ops/webhooks/${eid}/retry`, {
        reason: "Inspect queued event",
      })
    ).status,
  ).toBe(409);
  run("UPDATE webhooks SET status='dead',attempts=5 WHERE id=?", eid);
  vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "live_mode");
  expect(
    (
      await call(`/api/ops/webhooks/${eid}/retry`, {
        reason: "Wrong environment",
      })
    ).status,
  ).toBe(409);
  expect(one("SELECT attempts FROM webhooks WHERE id=?", eid)?.attempts).toBe(
    5,
  );
  vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "test_mode");
  expect(
    (
      await call(`/api/ops/webhooks/${eid}/retry`, {
        reason: "Retry after provider recovery",
      })
    ).status,
  ).toBe(202);
  run("UPDATE webhooks SET status='dead',attempts=5 WHERE id=?", eid);
  expect(
    (
      await call(`/api/ops/webhooks/${eid}/retry`, {
        reason: "Still cooling down",
      })
    ).status,
  ).toBe(429);
  run(
    "UPDATE webhook_retries SET retried_at=? WHERE webhook_id=?",
    Date.now() - WEBHOOK_RETRY_COOLDOWN - 1,
    eid,
  );
  const again = await call(`/api/ops/webhooks/${eid}/retry`, {
    reason: "Recovered after second outage",
  });
  expect(again.status).toBe(202);
  expect(again.body.total_attempts).toBe(10);
  await processWebhooks();
  expect(
    (await agent.get(`/api/ops/webhooks/${eid}`)).body.total_attempts,
  ).toBe(11);
  run("UPDATE webhook_retries SET retried_at=0 WHERE webhook_id=?", eid);
  expect(
    (
      await call(`/api/ops/webhooks/${eid}/retry`, {
        reason: "Already processed event",
      })
    ).status,
  ).toBe(409);
  expect(one("SELECT COUNT(*) AS n FROM grants WHERE order_id=?", oid)?.n).toBe(
    1,
  );
});
async function checkout(product = "project") {
  const c = await call("/api/billing/checkouts", { projectId, product });
  expect(c.status).toBe(200);
  expect(c.body.url).toContain("test.checkout.dodopayments.com");
  return c.body.orderId as string;
}
function paymentFor(orderId: string, extra: any = {}) {
  const mapping = one(
    "SELECT * FROM dodo_checkouts WHERE order_id=? AND status='ready' ORDER BY created_at DESC LIMIT 1",
    orderId,
  )!;
  const order = one("SELECT * FROM orders WHERE id=?", orderId)!;
  const pid = `pay_${randomUUID()}`;
  const body = checkoutBodies.find((b) => b.metadata.order_id === orderId)!;
  const payment = {
    payment_id: pid,
    business_id: "bus_test",
    checkout_session_id: mapping.session_id,
    metadata: body.metadata,
    currency: "USD",
    total_amount: order.amount + 190,
    tax: 190,
    created_at: new Date(Date.now() - 10000).toISOString(),
    updated_at: new Date().toISOString(),
    status: "succeeded",
    product_cart: [{ product_id: mapping.product_id, quantity: 1 }],
    refunds: [],
    disputes: [],
    subscription_ids: [],
    invoice_id: "INV-TEST",
    invoice_url: "https://receipts.example.test/invoice.pdf",
    ...extra,
  };
  payments[pid] = payment;
  sessions[mapping.session_id].payment_id = pid;
  sessions[mapping.session_id].payment_status = payment.status;
  return payment;
}
async function event(
  payment: any,
  type = "payment.succeeded",
  eventId = randomUUID(),
  seconds = Math.floor(Date.now() / 1000),
) {
  const body = JSON.stringify({
    business_id: "bus_test",
    type,
    timestamp: new Date().toISOString(),
    data: { payment_id: payment.payment_id },
  });
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${eventId}.${seconds}.${body}`)
    .digest("base64");
  return request(app)
    .post("/api/webhooks/dodo")
    .set("Content-Type", "application/json")
    .set("webhook-id", eventId)
    .set("webhook-timestamp", String(seconds))
    .set("webhook-signature", `v1,${signature}`)
    .send(body);
}

test("hosted checkout serializes concurrent requests and fixes server-owned product, customer and metadata", async () => {
  const results = await Promise.all([
    call("/api/billing/checkouts", { projectId, product: "project" }),
    call("/api/billing/checkouts", { projectId, product: "project" }),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(results[0].body).toEqual(results[1].body);
  expect(checkoutBodies).toHaveLength(1);
  expect(checkoutBodies[0].product_cart).toEqual([
    { product_id: "pdt_project", quantity: 1 },
  ]);
  expect(checkoutBodies[0].customer.email).toBe("dodo-owner@example.test");
  expect(checkoutBodies[0].feature_flags).toMatchObject({
    allow_discount_code: false,
    allow_currency_selection: false,
  });
  expect(one("SELECT COUNT(*) AS n FROM grants")!.n).toBe(0);
  expect(
    (
      await call("/api/billing/local-confirm", {
        orderId: results[0].body.orderId,
      })
    ).status,
  ).toBe(404);
});
test.each([
  "price",
  "currency",
  "recurring",
  "discount",
  "parity",
  "localized",
  "variable",
])("rejects catalog mismatch: %s", async (kind) => {
  if (kind === "price") catalog.price.price = 1800;
  if (kind === "currency") catalog.price.currency = "EUR";
  if (kind === "recurring") catalog.is_recurring = true;
  if (kind === "discount") catalog.price.discount_bps = 100;
  if (kind === "parity") catalog.price.purchasing_power_parity = true;
  if (kind === "localized") catalog.pricing_mode = "country";
  if (kind === "variable") catalog.price.pay_what_you_want = true;
  expect(
    (await call("/api/billing/checkouts", { projectId, product: "project" }))
      .body.code,
  ).toBe("PAYMENT_CATALOG_MISMATCH");
  expect(checkoutBodies).toHaveLength(0);
});
test("signed events are queued and deduplicated; only authoritative payment creates one grant and invoice", async () => {
  const oid = await checkout(),
    p = paymentFor(oid),
    eid = randomUUID();
  expect((await event(p, "payment.succeeded", eid)).status).toBe(200);
  expect((await event(p, "payment.succeeded", eid)).status).toBe(200);
  expect(one("SELECT COUNT(*) AS n FROM webhooks")!.n).toBe(1);
  expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe(
    "pending",
  );
  await processWebhooks();
  expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe("paid");
  expect(many("SELECT * FROM grants")).toHaveLength(1);
  const detail = (await agent.get(`/api/billing/orders/${oid}`)).body;
  expect(detail.receipt).toMatchObject({
    tax: 190,
    invoice_number: "INV-TEST",
  });
  expect(detail.chargedTotal).toBe(2090);
  expect(detail.provider.mode).toBe("test");
  expect(
    one(
      "SELECT sharing,current_release_id FROM projects WHERE id=?",
      projectId,
    ),
  ).toMatchObject({ sharing: 0, current_release_id: null });
  await event(p);
  await processWebhooks();
  expect(many("SELECT * FROM grants")).toHaveLength(1);
});
test("rejects unsigned, modified and expired notifications", async () => {
  const oid = await checkout(),
    p = paymentFor(oid);
  expect(
    (
      await request(app)
        .post("/api/webhooks/dodo")
        .send({ type: "payment.succeeded" })
    ).status,
  ).toBe(401);
  expect(
    (
      await event(
        p,
        "payment.succeeded",
        randomUUID(),
        Math.floor(Date.now() / 1000) - 600,
      )
    ).status,
  ).toBe(401);
  const raw = JSON.stringify({
    business_id: "bus_test",
    type: "payment.succeeded",
    data: { payment_id: p.payment_id },
  });
  expect(
    (
      await request(app)
        .post("/api/webhooks/dodo")
        .set("Content-Type", "application/json")
        .set("webhook-id", "fake")
        .set("webhook-timestamp", String(Math.floor(Date.now() / 1000)))
        .set("webhook-signature", "v1,bm90LWEtdmFsaWQtc2lnbmF0dXJl")
        .send(raw)
    ).status,
  ).toBe(401);
  expect(many("SELECT * FROM webhooks")).toHaveLength(0);
});
test.each([
  "workspace",
  "project",
  "session",
  "amount",
  "currency",
  "product",
  "quantity",
  "subscription",
  "environment",
  "business",
])("never grants a mismatched authoritative payment: %s", async (kind) => {
  const oid = await checkout(),
    p = paymentFor(oid);
  if (kind === "workspace")
    p.metadata = { ...p.metadata, workspace_id: "foreign" };
  if (kind === "project") p.metadata = { ...p.metadata, project_id: "foreign" };
  if (kind === "session") p.checkout_session_id = "foreign";
  if (kind === "amount") p.total_amount--;
  if (kind === "currency") p.currency = "EUR";
  if (kind === "product") p.product_cart[0].product_id = "pdt_foreign";
  if (kind === "quantity") p.product_cart[0].quantity = 2;
  if (kind === "subscription") p.subscription_ids = ["sub_unwanted"];
  if (kind === "environment")
    p.metadata = { ...p.metadata, environment: "live_mode" };
  if (kind === "business") p.business_id = "foreign";
  await event(p);
  await processWebhooks();
  expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe(
    "pending",
  );
  expect(many("SELECT * FROM grants")).toHaveLength(0);
  expect(one("SELECT status FROM webhooks")!.status).toBe("retry");
});
test("original order checks are isolated by ownership, preserve processing and enforce cooldown", async () => {
  const oid = await checkout(),
    p = paymentFor(oid, { status: "processing" });
  expect(
    (
      await other
        .post(`/api/billing/orders/${oid}/check`)
        .set("X-CSRF-Token", otherCsrf)
        .send({})
    ).status,
  ).toBe(404);
  expect((await call(`/api/billing/orders/${oid}/check`)).body.status).toBe(
    "pending",
  );
  expect(many("SELECT * FROM grants")).toHaveLength(0);
  p.status = "succeeded";
  expect((await call(`/api/billing/orders/${oid}/check`)).status).toBe(429);
  run("DELETE FROM order_checks WHERE order_id=?", oid);
  expect((await call(`/api/billing/orders/${oid}/check`)).body.status).toBe(
    "paid",
  );
});
test("full tax-inclusive refund wins over delayed success events and revokes sharing", async () => {
  const oid = await checkout(),
    p = paymentFor(oid);
  await event(p);
  await processWebhooks();
  run("UPDATE projects SET sharing=1 WHERE id=?", projectId);
  p.refunds = [
    {
      payment_id: p.payment_id,
      status: "succeeded",
      amount: 2090,
      currency: "USD",
    },
  ];
  p.refund_status = "full";
  await event(p, "refund.succeeded");
  await processWebhooks();
  expect(
    one("SELECT status,refunded FROM orders WHERE id=?", oid),
  ).toMatchObject({ status: "refunded", refunded: 1900 });
  expect(
    one("SELECT sharing FROM projects WHERE id=?", projectId)!.sharing,
  ).toBe(0);
  await event(p);
  await processWebhooks();
  expect(one("SELECT status FROM grants")!.status).toBe("revoked");
});
test("partial refunds enter review; pending refunds cannot revoke; dispute resolution never reopens sharing", async () => {
  const oid = await checkout(),
    p = paymentFor(oid);
  await event(p);
  await processWebhooks();
  p.refunds = [
    {
      payment_id: p.payment_id,
      status: "pending",
      amount: 100,
      currency: "USD",
    },
  ];
  await event(p, "refund.failed");
  await processWebhooks();
  expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe("paid");
  p.disputes = [{ dispute_status: "dispute_opened" }];
  run("UPDATE projects SET sharing=1 WHERE id=?", projectId);
  await event(p, "dispute.opened");
  await processWebhooks();
  expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe(
    "disputed",
  );
  p.disputes[0].dispute_status = "dispute_won";
  await event(p, "dispute.won");
  await processWebhooks();
  expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe("paid");
  expect(
    one("SELECT sharing FROM projects WHERE id=?", projectId)!.sharing,
  ).toBe(0);
  p.refunds[0].status = "succeeded";
  await event(p, "refund.succeeded");
  await processWebhooks();
  expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe(
    "review",
  );
  // Even an eventually consistent provider snapshot cannot erase a confirmed refund.
  p.refunds = [];
  p.refund_status = null;
  await event(p);
  await processWebhooks();
  expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe(
    "review",
  );
});
test("renewal uses the $9 product, retains remaining days, adds no AI and does not publish", async () => {
  const first = await checkout(),
    p = paymentFor(first);
  await event(p);
  await processWebhooks();
  const previous = one("SELECT * FROM grants WHERE order_id=?", first)!;
  const next = await checkout("renewal"),
    renewal = paymentFor(next);
  expect(checkoutBodies[1].product_cart[0].product_id).toBe("pdt_renewal");
  await event(renewal);
  await processWebhooks();
  expect(one("SELECT * FROM grants WHERE order_id=?", next)).toMatchObject({
    starts_at: previous.expires_at,
    ai_expires_at: null,
  });
  expect(
    one("SELECT current_release_id FROM projects WHERE id=?", projectId)!
      .current_release_id,
  ).toBeNull();
});
test("expired unused checkout is replaced, while a submitted payment is checked before any new link", async () => {
  const oid = await checkout();
  run(
    "UPDATE dodo_checkouts SET created_at=? WHERE order_id=?",
    Date.now() - 90000000,
    oid,
  );
  expect(await checkout()).toBe(oid);
  expect(checkoutBodies).toHaveLength(2);
  const p = paymentFor(oid);
  run(
    "UPDATE dodo_checkouts SET created_at=? WHERE order_id=?",
    Date.now() - 90000000,
    oid,
  );
  const c = await call("/api/billing/checkouts", {
    projectId,
    product: "project",
  });
  expect(c.body).toMatchObject({ orderId: oid, status: "paid" });
  expect(c.body.url).toBeUndefined();
  expect(checkoutBodies).toHaveLength(2);
});
test("provider outages leave the order retryable, and unavailable credentials never fall back to simulation", async () => {
  failure = true;
  expect(
    (await call("/api/billing/checkouts", { projectId, product: "project" }))
      .status,
  ).toBe(503);
  failure = false;
  const oid = await checkout();
  vi.stubEnv("DODO_PAYMENTS_API_KEY", "");
  expect(
    (await call("/api/billing/checkouts", { projectId, product: "project" }))
      .status,
  ).toBe(503);
  expect(
    (await call("/api/billing/local-confirm", { orderId: oid })).status,
  ).toBe(404);
});
test("tax-inclusive pricing is validated against the checkout snapshot even when catalog changes", async () => {
  catalog.price.tax_inclusive = true;
  const oid = await checkout(),
    p = paymentFor(oid, { total_amount: 1900, tax: 190 });
  catalog.price.price = 2500;
  await event(p);
  await processWebhooks();
  expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe("paid");
  expect(
    (await agent.get(`/api/billing/orders/${oid}`)).body.chargedTotal,
  ).toBe(1900);
});
test.each(["full", "partial"])(
  "a verified %s refund revokes access even when Dodo omits optional amount and currency",
  async (refundStatus) => {
    const oid = await checkout(),
      p = paymentFor(oid);
    await event(p);
    await processWebhooks();
    p.refunds = [
      {
        payment_id: p.payment_id,
        status: "succeeded",
        amount: null,
        currency: null,
        is_partial: refundStatus === "partial",
      },
    ];
    p.refund_status = refundStatus;
    await event(p, "refund.succeeded");
    await processWebhooks();
    expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe(
      refundStatus === "full" ? "refunded" : "review",
    );
    expect(one("SELECT status FROM grants")!.status).toBe("revoked");
  },
);
test.each(["failed", "cancelled"])(
  "%s payments do not grant access and a new attempt uses a new order",
  async (status) => {
    const oid = await checkout(),
      p = paymentFor(oid, { status });
    await event(p, `payment.${status}`);
    await processWebhooks();
    expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe(
      "failed",
    );
    expect(many("SELECT * FROM grants")).toHaveLength(0);
    expect(await checkout()).not.toBe(oid);
  },
);
test("a submitted payment cannot expose another checkout link, and failures eventually become visible dead events", async () => {
  const oid = await checkout(),
    p = paymentFor(oid, { status: "processing" });
  const c = await call("/api/billing/checkouts", {
    projectId,
    product: "project",
  });
  expect(c.body).toEqual({ orderId: oid, status: "pending" });
  expect(checkoutBodies).toHaveLength(1);
  await event(p);
  failure = true;
  for (let attempt = 0; attempt < 5; attempt++) await processWebhooks();
  expect(one("SELECT status,attempts FROM webhooks")).toMatchObject({
    status: "dead",
    attempts: 5,
  });
  expect(many("SELECT * FROM grants")).toHaveLength(0);
});
test("production refuses test-mode fulfillment and development refuses live keys", async () => {
  const oid = await checkout(),
    p = paymentFor(oid);
  await event(p);
  vi.stubEnv("NODE_ENV", "production");
  expect((await agent.get("/api/session")).body.billingEnabled).toBe(false);
  await processWebhooks();
  expect(many("SELECT * FROM grants")).toHaveLength(0);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "live_mode");
  expect(
    (await call("/api/billing/checkouts", { projectId, product: "project" }))
      .status,
  ).toBe(503);
});
test("live-mode configuration uses the live API and creates production entitlements from verified payments", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "live_mode");
  const c = await call("/api/billing/checkouts", {
    projectId,
    product: "project",
  });
  expect(c.status).toBe(200);
  expect(c.body.url).toContain("https://checkout.dodopayments.com/");
  const p = paymentFor(c.body.orderId);
  await event(p);
  await processWebhooks();
  expect(
    one("SELECT status FROM orders WHERE id=?", c.body.orderId)!.status,
  ).toBe("paid");
  expect(
    one(
      "SELECT environment FROM dodo_checkouts WHERE order_id=?",
      c.body.orderId,
    )!.environment,
  ).toBe("live_mode");
});
test("an initialized hosted sandbox verifies test payments with production runtime security", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PAYMENTS_SANDBOX_INSTANCE", "1");
  run("INSERT INTO billing_instance VALUES (1,'sandbox')");
  const oid = await checkout(),
    p = paymentFor(oid);
  await event(p);
  await processWebhooks();
  expect(one("SELECT status FROM orders WHERE id=?", oid)!.status).toBe("paid");
  expect(
    (await call("/api/billing/local-confirm", { orderId: oid })).status,
  ).toBe(404);
  vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "live_mode");
  expect((await agent.get("/api/session")).body.billingEnabled).toBe(false);
});

import type { Express, Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { authenticated } from "./auth.js";
import {
  AppError,
  audit,
  id,
  idem,
  many,
  now,
  one,
  requireValue,
  run,
  tx,
  type Row,
} from "./db.js";
import { DAY, entitlement, owner, recalculateGrants } from "./domain.js";
import { PRICING } from "../shared/model.js";
import { adapterRequest, localMode, notify, origin } from "./providers.js";
const key = (r: Request) => String(r.get("idempotency-key") || "");
const transactionSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  status: z.enum(["paid", "refunded", "disputed", "failed"]),
  amount: z.number().int(),
  currency: z.literal("USD"),
  environment: z.enum(["production", "sandbox"]),
  paidAt: z.string().datetime(),
  refundAmount: z.number().int().min(0).default(0),
});
export function applyTransaction(input: unknown, expectedEnvironment: string) {
  const t = transactionSchema.parse(input);
  if (t.environment !== expectedEnvironment)
    throw new AppError(
      "PAYMENT_ENVIRONMENT",
      400,
      "The payment environment does not match.",
    );
  return tx(() => {
    const o = requireValue(
      one("SELECT * FROM orders WHERE id=?", t.orderId),
      "ORDER_UNAVAILABLE",
      404,
      "Order unavailable.",
    );
    if (
      o.amount !== t.amount ||
      o.currency !== t.currency ||
      (o.provider_transaction && o.provider_transaction !== t.id)
    )
      throw new AppError(
        "PAYMENT_MISMATCH",
        400,
        "Payment details do not match the order.",
      );
    const p = requireValue(
      one("SELECT * FROM projects WHERE id=?", o.project_id),
    );
    if (
      t.status === "paid" &&
      (o.status === "refunded" || o.refunded >= o.amount)
    )
      return { ok: true };
    if (t.refundAmount > o.amount)
      throw new AppError("PAYMENT_MISMATCH", 400, "Refund amount is invalid.");
    const paidAt = Date.parse(t.paidAt);
    if (!Number.isFinite(paidAt) || paidAt > now() + 300000)
      throw new AppError(
        "PAYMENT_MISMATCH",
        400,
        "Payment timestamp is invalid.",
      );
    const status =
      t.status === "refunded" && t.refundAmount < o.amount
        ? "review"
        : t.status;
    run(
      "UPDATE orders SET status=?,provider_transaction=?,paid_at=?,refunded=? WHERE id=?",
      status,
      t.id,
      paidAt,
      t.refundAmount,
      o.id,
    );
    recalculateGrants(p.id);
    if (status === "refunded" || status === "disputed" || status === "review") {
      run("UPDATE projects SET sharing=0 WHERE id=?", p.id);
      run(
        "UPDATE confirmation_requests SET status='withdrawn' WHERE project_id=? AND status IN ('pending','in_progress')",
        p.id,
      );
    }
    if (status === "paid" && p.lifecycle === "deleted")
      audit("billing", p.id, "payment_on_deleted_project", { orderId: o.id });
    audit(
      "billing",
      p.id,
      status === "paid" ? "payment_confirmed" : "payment_state_changed",
      { orderId: o.id, transactionId: t.id, status },
    );
    const u = one(
      "SELECT email FROM users WHERE workspace_id=?",
      p.workspace_id,
    );
    if (u)
      notify(
        p.id,
        `billing:${o.id}:${status}`,
        u.email,
        "Your project payment status changed",
        `Review the project payment and hosting dates at ${origin}/app/billing.`,
      );
    return { ok: true };
  });
}
export function installBilling(app: Express) {
  app.get("/api/billing", authenticated, (req, res) =>
    res.json({
      pricing: PRICING,
      orders: many(
        "SELECT * FROM orders WHERE workspace_id=? ORDER BY created_at DESC",
        res.locals.user.workspace_id,
      ),
      grants: many(
        "SELECT g.* FROM grants g JOIN projects p ON p.id=g.project_id WHERE p.workspace_id=?",
        res.locals.user.workspace_id,
      ),
    }),
  );
  app.post("/api/billing/checkouts", authenticated, async (req, res) => {
    const b = z
      .object({
        projectId: z.string(),
        product: z.enum(["project", "renewal"]),
      })
      .parse(req.body);
    const p = owner(res.locals.user, b.projectId);
    const e = entitlement(p);
    if (
      p.lifecycle !== "active" ||
      e.state === "expired" ||
      e.state === "revoked"
    )
      throw new AppError(
        "ENTITLEMENT_EXPIRED",
        403,
        "This project cannot be purchased or renewed.",
      );
    if (b.product === "project" && e.state !== "free")
      throw new AppError(
        "ALREADY_PAID",
        409,
        "This project already has a package. Choose renewal.",
      );
    if (
      b.product === "renewal" &&
      !["paid_active", "expired_grace"].includes(e.state)
    )
      throw new AppError(
        "RENEWAL_UNAVAILABLE",
        409,
        "Only existing recoverable paid projects can be renewed.",
      );
    const result = idem(
      `${res.locals.user.id}:checkout:${p.id}`,
      key(req),
      b,
      () => {
        const pending = one(
          "SELECT * FROM orders WHERE project_id=? AND status='pending' AND product=?",
          p.id,
          b.product,
        );
        if (pending) return { orderId: pending.id };
        const oid = id();
        run(
          "INSERT INTO orders (id,project_id,workspace_id,product,amount,currency,status,created_at) VALUES (?,?,?,?,?,?,?,?)",
          oid,
          p.id,
          p.workspace_id,
          b.product,
          PRICING[b.product],
          PRICING.currency,
          "pending",
          now(),
        );
        audit(res.locals.user.id, p.id, "checkout_started", { orderId: oid });
        return { orderId: oid };
      },
    );
    const o = requireValue(
      one("SELECT * FROM orders WHERE id=?", result.orderId),
    );
    if (o.status !== "pending") {
      res.json({ orderId: o.id, status: o.status });
      return;
    }
    if (!process.env.BILLING_ADAPTER_URL) {
      if (!localMode)
        throw new AppError(
          "PROVIDER_UNAVAILABLE",
          503,
          "Payment is not configured.",
        );
      res.json({
        ...result,
        local: true,
        amount: o.amount,
        currency: o.currency,
        projectId: p.id,
      });
      return;
    }
    if (!o.checkout_url) {
      const response = await adapterRequest("billing", "/checkouts", {
        orderId: o.id,
        amount: o.amount,
        currency: o.currency,
        product: o.product,
        projectId: p.id,
        returnUrl: `${origin}/app/billing`,
        idempotencyKey: o.id,
      });
      const checked = z
        .object({
          url: z
            .string()
            .url()
            .refine((v) => v.startsWith("https://")),
        })
        .parse(response);
      run("UPDATE orders SET checkout_url=? WHERE id=?", checked.url, o.id);
    }
    res.json({
      ...result,
      url: one("SELECT checkout_url FROM orders WHERE id=?", o.id)
        ?.checkout_url,
    });
  });
  app.post("/api/billing/local-confirm", authenticated, (req, res) => {
    if (!localMode || process.env.BILLING_ADAPTER_URL)
      throw new AppError("ACCESS_UNAVAILABLE", 404, "Unavailable.");
    const b = z.object({ orderId: z.string() }).parse(req.body);
    const o = requireValue(one("SELECT * FROM orders WHERE id=?", b.orderId));
    owner(res.locals.user, o.project_id);
    if (o.status === "refunded")
      throw new AppError(
        "ORDER_REFUNDED",
        409,
        "This order has already been refunded.",
      );
    res.json(
      applyTransaction(
        {
          id: `local-${o.id}`,
          orderId: o.id,
          status: "paid",
          amount: o.amount,
          currency: o.currency,
          environment: "sandbox",
          paidAt: new Date(o.paid_at || now()).toISOString(),
        },
        "sandbox",
      ),
    );
  });
  app.post("/api/billing/local-refund", authenticated, (req, res) => {
    if (!localMode || process.env.BILLING_ADAPTER_URL)
      throw new AppError("ACCESS_UNAVAILABLE", 404, "Unavailable.");
    const o = requireValue(
      one("SELECT * FROM orders WHERE id=?", req.body.orderId),
    );
    owner(res.locals.user, o.project_id);
    if (!o.provider_transaction)
      throw new AppError("ORDER_UNPAID", 409, "This order has not been paid.");
    res.json(
      applyTransaction(
        {
          id: o.provider_transaction,
          orderId: o.id,
          status: "refunded",
          amount: o.amount,
          currency: o.currency,
          refundAmount: o.amount,
          environment: "sandbox",
          paidAt: new Date(o.paid_at).toISOString(),
        },
        "sandbox",
      ),
    );
  });
  app.post("/api/webhooks/billing", (req, res) => {
    const secret = process.env.BILLING_WEBHOOK_SECRET;
    if (!secret)
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        503,
        "Payment notifications are not configured.",
      );
    const signature = String(req.get("x-handlio-signature") || "");
    const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signature);
    const raw = req.body as Buffer;
    if (
      !match ||
      !Buffer.isBuffer(raw) ||
      Math.abs(now() - Number(match[1]) * 1000) > 300000
    )
      throw new AppError(
        "SIGNATURE_INVALID",
        400,
        "Invalid payment notification.",
      );
    const expected = createHmac("sha256", secret)
      .update(`${match[1]}.`)
      .update(raw)
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(match[2])))
      throw new AppError(
        "SIGNATURE_INVALID",
        400,
        "Invalid payment notification.",
      );
    const b = z
      .object({
        eventId: z.string().min(1).max(200),
        transactionId: z.string().min(1).max(200),
      })
      .parse(JSON.parse(raw.toString()));
    run(
      "INSERT OR IGNORE INTO webhooks VALUES (?,?,?,?,?,?)",
      b.eventId,
      b.transactionId,
      JSON.stringify(b),
      "queued",
      0,
      now(),
    );
    res.status(202).json({ received: true });
  });
}
export async function processWebhooks() {
  for (const e of many(
    "SELECT * FROM webhooks WHERE status IN ('queued','retry') AND attempts<5 ORDER BY created_at LIMIT 5",
  )) {
    try {
      const t = await adapterRequest(
        "billing",
        `/transactions/${encodeURIComponent(e.transaction_id)}`,
      );
      if (t.id !== e.transaction_id) throw new Error("transaction mismatch");
      applyTransaction(
        t,
        process.env.NODE_ENV === "production" ? "production" : "sandbox",
      );
      run(
        "UPDATE webhooks SET status='processed',attempts=attempts+1 WHERE id=?",
        e.id,
      );
    } catch {
      run(
        "UPDATE webhooks SET status=?,attempts=attempts+1 WHERE id=?",
        e.attempts >= 4 ? "dead" : "retry",
        e.id,
      );
    }
  }
}

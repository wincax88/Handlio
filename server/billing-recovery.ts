import {
  AppError,
  audit,
  many,
  now,
  one,
  requireValue,
  run,
  tx,
} from "./db.js";
import { reconcileOrder } from "./billing.js";
import { dodoSelected } from "./dodo.js";
import { DAY } from "./domain.js";

let reconciliationBusy = false;
export async function reconcilePendingOrders() {
  const result = { checked: 0, failed: 0, skipped: 0 };
  if (
    reconciliationBusy ||
    (!dodoSelected() && !process.env.BILLING_ADAPTER_URL)
  )
    return result;
  reconciliationBusy = true;
  try {
    // Persist per-order scheduling so a failed lookup cannot starve later
    // orders. Only submitted checkouts for the active provider are eligible.
    const orders = many(
      `SELECT o.id FROM orders o
       LEFT JOIN billing_reconciliations r ON r.order_id=o.id
       LEFT JOIN order_checks c ON c.order_id=o.id
       WHERE o.status='pending' AND o.created_at<=?
         AND COALESCE(r.next_at,0)<=? AND COALESCE(c.checked_at,0)<=?
         AND ${
           dodoSelected()
             ? "EXISTS (SELECT 1 FROM dodo_checkouts d WHERE d.order_id=o.id AND d.session_id IS NOT NULL AND d.environment=?)"
             : "o.checkout_url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dodo_checkouts d WHERE d.order_id=o.id)"
         }
       ORDER BY COALESCE(r.checked_at,0),o.created_at,o.id LIMIT 10`,
      now() - 5 * 60000,
      now(),
      now() - 60000,
      ...(dodoSelected()
        ? [process.env.DODO_PAYMENTS_ENVIRONMENT || "test_mode"]
        : []),
    );
    for (const order of orders) {
      const claimed = tx(() => {
        if (
          one("SELECT status FROM orders WHERE id=?", order.id)?.status !==
            "pending" ||
          (one(
            "SELECT next_at FROM billing_reconciliations WHERE order_id=?",
            order.id,
          )?.next_at || 0) > now()
        )
          return false;
        // Reserve before awaiting the provider. A crashed check becomes due
        // again after the lease; it never creates a purchase or grants rights.
        run(
          "INSERT INTO billing_reconciliations VALUES (?,?,?,'running',NULL) ON CONFLICT(order_id) DO UPDATE SET checked_at=excluded.checked_at,next_at=excluded.next_at,state='running',error_code=NULL",
          order.id,
          now(),
          now() + 15 * 60000,
        );
        return true;
      });
      if (!claimed) continue;
      try {
        await reconcileOrder(order.id, "billing-reconciliation");
        run(
          "UPDATE billing_reconciliations SET state='succeeded',error_code=NULL,next_at=checked_at+? WHERE order_id=?",
          DAY,
          order.id,
        );
        result.checked++;
      } catch (error) {
        const limited =
          error instanceof AppError && error.code === "RATE_LIMITED";
        const code =
          error instanceof AppError &&
          [
            "PAYMENT_MISMATCH",
            "PAYMENT_ENVIRONMENT",
            "PROVIDER_UNAVAILABLE",
          ].includes(error.code)
            ? error.code
            : "RECONCILIATION_FAILED";
        run(
          "UPDATE billing_reconciliations SET state=?,error_code=?,next_at=? WHERE order_id=?",
          limited ? "deferred" : "failed",
          limited ? null : code,
          now() + (limited ? 60000 : 15 * 60000),
          order.id,
        );
        if (limited) result.skipped++;
        else {
          result.failed++;
          audit("billing-reconciliation", null, "order_reconciliation_failed", {
            orderId: order.id,
            code,
          });
        }
      }
    }
    run(
      "INSERT INTO worker_state VALUES ('billing_reconciliation',?,NULL,NULL) ON CONFLICT(name) DO UPDATE SET last_success_at=excluded.last_success_at,error_code=NULL",
      now(),
    );
    return result;
  } finally {
    reconciliationBusy = false;
  }
}

export const WEBHOOK_RETRY_COOLDOWN = 15 * 60000;
export function webhookMetadata(webhookId: string) {
  const event = requireValue(
    one(
      "SELECT w.id,w.transaction_id,w.status,w.attempts,w.created_at,r.retried_at,COALESCE(r.previous_attempts,0)+w.attempts AS total_attempts FROM webhooks w LEFT JOIN webhook_retries r ON r.webhook_id=w.id WHERE w.id=?",
      webhookId,
    ),
  );
  return {
    id: event.id,
    transaction_id: event.transaction_id,
    status: event.status,
    attempts: event.attempts,
    created_at: event.created_at,
    retried_at: event.retried_at,
    total_attempts: event.total_attempts,
    retry_available_at:
      event.retried_at == null
        ? null
        : event.retried_at + WEBHOOK_RETRY_COOLDOWN,
  };
}
export function retryWebhook(
  webhookId: string,
  actorId: string,
  reason: string,
) {
  return tx(() => {
    const event = requireValue(
      one("SELECT * FROM webhooks WHERE id=?", webhookId),
    );
    const retry = one(
      "SELECT * FROM webhook_retries WHERE webhook_id=?",
      webhookId,
    );
    if (retry && retry.retried_at + WEBHOOK_RETRY_COOLDOWN > now())
      throw new AppError(
        "RATE_LIMITED",
        429,
        "Wait 15 minutes between controlled webhook retries.",
      );
    // Retry only terminal failures; an automatically retrying event may
    // already have a provider lookup in flight.
    if (event.status !== "dead")
      throw new AppError(
        "WEBHOOK_NOT_RETRYABLE",
        409,
        "Only dead payment events can be retried.",
      );
    const input = JSON.parse(event.body);
    if (input.provider === "dodo") {
      if (
        !dodoSelected() ||
        input.environment !==
          (process.env.DODO_PAYMENTS_ENVIRONMENT || "test_mode")
      )
        throw new AppError(
          "PAYMENT_ENVIRONMENT",
          409,
          "This event does not match the configured payment provider and environment.",
        );
    } else if (dodoSelected() || !process.env.BILLING_ADAPTER_URL) {
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        503,
        "This event's payment provider is not configured.",
      );
    }
    run(
      "INSERT INTO webhook_retries VALUES (?,?,?) ON CONFLICT(webhook_id) DO UPDATE SET retried_at=excluded.retried_at,previous_attempts=excluded.previous_attempts",
      event.id,
      now(),
      (retry?.previous_attempts || 0) + event.attempts,
    );
    run("UPDATE webhooks SET status='queued',attempts=0 WHERE id=?", event.id);
    audit(actorId, null, "ops_webhook_retry", {
      webhookId: event.id,
      reason,
      before: { status: event.status, attempts: event.attempts },
      after: { status: "queued", attempts: 0 },
    });
    return webhookMetadata(event.id);
  });
}

import { AppError, id, many, now, one, run } from "./db.js";
import { entitlement } from "./domain.js";
import { deliverMail, MailProviderError, type MailOptions } from "./mail.js";
export const development =
  process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";
export const localMode = process.env.NODE_ENV !== "production";
export const origin = process.env.APP_ORIGIN || "http://localhost:5173";
export function notify(
  projectId: string | null,
  eventKey: string,
  email: string,
  subject: string,
  body: string,
) {
  run(
    "INSERT OR IGNORE INTO notifications VALUES (?,?,?,?,?,?,?,?,?,?)",
    id(),
    projectId,
    eventKey,
    email,
    subject,
    body,
    "queued",
    0,
    now(),
    now(),
  );
}
export async function sendMail(email: string, subject: string, body: string, options: MailOptions = {}) {
  const key = options.key || `mail/${id()}`;
  const kind = options.kind || 'notification';
  try {
    const receipt = await deliverMail(email, subject, body, { ...options, key });
    run("INSERT INTO mail_deliveries VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(delivery_key) DO UPDATE SET provider_message_id=excluded.provider_message_id,state=excluded.state,error_code=NULL,updated_at=excluded.updated_at",
      id(), key, kind, receipt.provider, receipt.messageId, receipt.state, null, now(), now());
    // A signed event may arrive before the provider's send response returns.
    if (receipt.messageId) reconcileMailEvents(receipt.messageId);
    return receipt.state;
  } catch (error) {
    const code = error instanceof MailProviderError ? error.code : 'EMAIL_PROVIDER_UNAVAILABLE';
    run("INSERT INTO mail_deliveries VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(delivery_key) DO UPDATE SET state='failed',error_code=excluded.error_code,updated_at=excluded.updated_at",
      id(), key, kind, process.env.MAIL_PROVIDER || 'smtp', null, 'failed', code, now(), now());
    throw new AppError('PROVIDER_UNAVAILABLE', 503, 'Email delivery is temporarily unavailable. Retry later.');
  }
}
export function reconcileMailEvents(messageId: string) {
  // Terminal failure is authoritative; late accepted/delayed events cannot undo it.
  const events = many('SELECT state FROM mail_events WHERE provider_message_id=? ORDER BY occurred_at DESC,created_at DESC', messageId);
  const final = events.find(e => ['bounced', 'failed', 'complained', 'suppressed'].includes(e.state)) || events.find(e => e.state === 'delivered') || events[0];
  if (final) run('UPDATE mail_deliveries SET state=?,updated_at=? WHERE provider_message_id=?', final.state, now(), messageId);
}
export async function processNotifications() {
  for (const n of many(
    "SELECT * FROM notifications WHERE state IN ('queued','retry') AND next_at<=? LIMIT 10",
    now(),
  )) {
    if (n.project_id) {
      const p = one("SELECT * FROM projects WHERE id=?", n.project_id);
      if (!p || p.lifecycle === "deleted") {
        run("UPDATE notifications SET state='canceled' WHERE id=?", n.id);
        continue;
      }
      const owner = one(
        "SELECT email FROM users WHERE workspace_id=?",
        p.workspace_id,
      );
      if (n.recipient !== owner?.email) {
        const m = one(
          "SELECT * FROM members WHERE project_id=? AND email=? AND status='active'",
          p.id,
          n.recipient,
        );
        if (
          !m ||
          !p.sharing ||
          p.lifecycle !== "active" ||
          entitlement(p).state !== "paid_active"
        ) {
          run("UPDATE notifications SET state='canceled' WHERE id=?", n.id);
          continue;
        }
        if (
          n.event_key.startsWith("confirm-request:") ||
          n.event_key.startsWith("reminder:")
        ) {
          const q = one(
            "SELECT status FROM confirmation_requests WHERE id=?",
            n.event_key.split(":")[1],
          );
          if (!q || !["pending", "in_progress"].includes(q.status)) {
            run("UPDATE notifications SET state='canceled' WHERE id=?", n.id);
            continue;
          }
        }
      }
    }
    try {
      const state = await sendMail(n.recipient, n.subject, n.body, { kind: 'notification', key: `notification/${n.id}` });
      run(
        "UPDATE notifications SET state=?,attempts=attempts+1 WHERE id=?",
        state,
        n.id,
      );
    } catch {
      const attempts = n.attempts + 1;
      run(
        "UPDATE notifications SET state=?,attempts=?,next_at=? WHERE id=?",
        attempts >= 5 ? "failed" : "retry",
        attempts,
        now() + Math.min(3600000, 60000 * 2 ** attempts),
        n.id,
      );
    }
  }
}
export async function adapterRequest(
  kind: "billing" | "ai",
  route: string,
  body?: object,
) {
  const url =
    process.env[kind === "billing" ? "BILLING_ADAPTER_URL" : "AI_ADAPTER_URL"];
  if (!url)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      503,
      `${kind === "ai" ? "AI" : "Payment"} provider is not configured. Your manual workflow is still available.`,
    );
  if (!url.startsWith("https://") && !localMode)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      503,
      "The provider connection must use HTTPS.",
    );
  const response = await fetch(url + route, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env[kind === "billing" ? "BILLING_ADAPTER_TOKEN" : "AI_ADAPTER_TOKEN"] || ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(kind === "ai" ? 90000 : 15000),
  });
  if (!response.ok)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      503,
      "The provider is unavailable. Retry later.",
    );
  return response.json();
}

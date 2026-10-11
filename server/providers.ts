import nodemailer from "nodemailer";
import { AppError, id, many, now, one, run } from "./db.js";
import { entitlement } from "./domain.js";
export const development =
  process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";
export const localMode = process.env.NODE_ENV !== "production";
export const origin = process.env.APP_ORIGIN || "http://localhost:5173";
const mail = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === "465",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    })
  : null;
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
export async function sendMail(email: string, subject: string, body: string) {
  if (!mail) {
    if (localMode) return "local";
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      503,
      "Email delivery is not configured.",
    );
  }
  await mail.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject,
    text: body,
  });
  return "sent";
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
      const state = await sendMail(n.recipient, n.subject, n.body);
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

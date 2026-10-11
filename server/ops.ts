import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticated } from "./auth.js";
import { AppError, audit, many, requireValue, one, run } from "./db.js";
import { fresh } from "./domain.js";
export const isOps = (email: string) =>
  (process.env.OPS_EMAILS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
function operator(req: Request, res: Response, next: NextFunction) {
  if (!isOps(res.locals.user.email))
    return next(
      new AppError("ACCESS_UNAVAILABLE", 404, "This resource is unavailable."),
    );
  fresh(res.locals.user);
  next();
}
export function installOps(app: Express) {
  app.get("/api/ops", authenticated, operator, (req, res) => {
    audit(res.locals.user.id, null, "ops_diagnostics_read");
    res.json({
      jobs: many(
        "SELECT id,project_id,type,state,error,attempts,created_at FROM jobs ORDER BY created_at DESC LIMIT 100",
      ),
      orders: many(
        "SELECT id,project_id,amount,currency,status,created_at FROM orders ORDER BY created_at DESC LIMIT 100",
      ),
      webhooks: many(
        "SELECT id,status,attempts,created_at FROM webhooks ORDER BY created_at DESC LIMIT 100",
      ),
      notifications: many(
        "SELECT id,state,attempts,created_at FROM notifications ORDER BY created_at DESC LIMIT 100",
      ),
      mailDeliveries: many(
        "SELECT id,kind,provider,provider_message_id,state,error_code,created_at,updated_at FROM mail_deliveries ORDER BY created_at DESC LIMIT 100",
      ),
      requests: many(
        "SELECT id,kind,status,created_at FROM support_requests ORDER BY created_at DESC LIMIT 100",
      ),
    });
  });
  app.patch("/api/ops/requests/:id", authenticated, operator, (req, res) => {
    const b = z
      .object({
        status: z.enum(["open", "in_progress", "resolved"]),
        reason: z.string().trim().min(1).max(500),
      })
      .parse(req.body);
    const r = requireValue(
      one(
        "SELECT status FROM support_requests WHERE id=?",
        String(req.params.id),
      ),
    );
    run(
      "UPDATE support_requests SET status=? WHERE id=?",
      b.status,
      String(req.params.id),
    );
    audit(res.locals.user.id, null, "support_request_state_changed", {
      requestId: String(req.params.id),
      before: r.status,
      after: b.status,
      reason: b.reason,
    });
    res.json({ ok: true });
  });
}

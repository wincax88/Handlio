import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticated } from "./auth.js";
import { AppError, audit, many, requireValue, one, run } from "./db.js";
import { fresh } from "./domain.js";
import { retryJob } from "./jobs.js";
import { reconcileOrder } from "./billing.js";
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
  app.get("/api/ops/jobs/:id", authenticated, operator, (req, res) => {
    const job = requireValue(
      one(
        "SELECT id,project_id,type,state,error,attempts,created_at,finished_at FROM jobs WHERE id=?",
        String(req.params.id),
      ),
    );
    audit(res.locals.user.id, job.project_id, "ops_job_inspected", {
      jobId: job.id,
    });
    res.json(job);
  });
  app.post("/api/ops/jobs/:id/retry", authenticated, operator, (req, res) => {
    const b = z
      .object({ reason: z.string().trim().min(5).max(500) })
      .parse(req.body);
    res
      .status(202)
      .json(retryJob(String(req.params.id), res.locals.user.id, b.reason));
  });
  app.post(
    "/api/ops/orders/:id/check",
    authenticated,
    operator,
    async (req, res) => {
      const b = z
        .object({ reason: z.string().trim().min(5).max(500) })
        .parse(req.body);
      const order = requireValue(
        one(
          "SELECT id,project_id FROM orders WHERE id=?",
          String(req.params.id),
        ),
      );
      audit(res.locals.user.id, order.project_id, "ops_order_check", {
        orderId: order.id,
        reason: b.reason,
      });
      res.json(await reconcileOrder(order.id, res.locals.user.id));
    },
  );
  app.get("/api/ops/grants/:id", authenticated, operator, (req, res) => {
    const grant = requireValue(
      one(
        "SELECT id,scope,sample,expires_at FROM support_grants WHERE id=? AND revoked_at IS NULL AND expires_at>?",
        String(req.params.id),
        Date.now(),
      ),
    );
    audit(res.locals.user.id, null, "support_grant_read", {
      grantId: grant.id,
      scope: grant.scope,
    });
    res.json(grant);
  });
  app.get("/api/ops", authenticated, operator, (req, res) => {
    audit(res.locals.user.id, null, "ops_diagnostics_read");
    res.json({
      workers: many(
        "SELECT name AS id,last_success_at,last_error_at,error_code FROM worker_state",
      ),
      alerts: many(
        "SELECT name AS id,error_code,last_error_at FROM worker_state WHERE error_code IS NOT NULL AND COALESCE(last_error_at,0)>=COALESCE(last_success_at,0) UNION ALL SELECT project_id AS id,reason AS error_code,NULL AS last_error_at FROM ai_controls WHERE paused=1",
      ),
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
      grants: many(
        "SELECT id,scope,expires_at,revoked_at,created_at FROM support_grants ORDER BY created_at DESC LIMIT 100",
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

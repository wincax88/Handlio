import type { Express } from "express";
import { z } from "zod";
import { authenticated } from "./auth.js";
import { audit, many, now, run } from "./db.js";
import { fresh, owner } from "./domain.js";
import { aiCostSummary } from "./ai-budget.js";
export function installResources(app: Express) {
  app.get("/api/projects/:id/resources", authenticated, (req, res) => {
    const p = owner(res.locals.user, String(req.params.id));
    res.json({
      ai: aiCostSummary(p.id),
      tasks: many(
        "SELECT type,state,COUNT(*) AS count,MAX(finished_at-created_at) AS longest_ms FROM jobs WHERE project_id=? GROUP BY type,state",
        p.id,
      ),
      workers: many("SELECT * FROM worker_state"),
    });
  });
  app.patch("/api/projects/:id/ai-budget", authenticated, (req, res) => {
    const p = owner(res.locals.user, String(req.params.id));
    fresh(res.locals.user);
    const b = z
      .object({
        budgetUsd: z.number().finite().min(0.1).max(1000),
        resume: z.boolean().default(false),
        reason: z.string().trim().min(5).max(500),
        acknowledgement: z.literal(true),
      })
      .parse(req.body);
    run(
      "INSERT INTO ai_controls VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET budget_micros=excluded.budget_micros,paused=CASE WHEN ? THEN 0 ELSE ai_controls.paused END,reason=CASE WHEN ? THEN '' ELSE ai_controls.reason END",
      p.id,
      Math.round(b.budgetUsd * 1000000),
      0,
      "",
      Number(b.resume),
      Number(b.resume),
    );
    audit(res.locals.user.id, p.id, "ai_budget_updated", {
      budgetUsd: b.budgetUsd,
      resumed: b.resume,
      reason: b.reason,
      at: now(),
    });
    res.json(aiCostSummary(p.id));
  });
}

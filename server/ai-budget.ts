import {
  AppError,
  audit,
  many,
  now,
  one,
  requireValue,
  run,
  type Row,
} from "./db.js";
const micros = (value: number) => Math.round(value * 1000000);
export function aiCostSummary(projectId: string) {
  const control = one(
    "SELECT * FROM ai_controls WHERE project_id=?",
    projectId,
  ) || { budget_micros: micros(5), paused: 0, reason: "" };
  const costs = many(
    "SELECT reserved_micros,cost_micros,status FROM ai_costs WHERE project_id=?",
    projectId,
  );
  const known = costs.reduce((n, c) => n + (c.cost_micros || 0), 0),
    uncertain = costs
      .filter((c) => c.cost_micros === null && c.status !== "released")
      .reduce((n, c) => n + c.reserved_micros, 0);
  return {
    budgetUsd: control.budget_micros / 1000000,
    knownCostUsd: known / 1000000,
    reservedOrUncertainUsd: uncertain / 1000000,
    remainingUsd:
      Math.max(0, control.budget_micros - known - uncertain) / 1000000,
    paused: !!control.paused,
    reason: control.reason,
    currency: "USD",
  };
}
export function reserveAiCost(
  p: Row,
  jobId: string,
  steps: number,
  attempt = 1,
) {
  const costId = `${jobId}:${attempt}`,
    prior = one("SELECT * FROM ai_costs WHERE job_id=?", costId);
  if (prior) return prior.reserved_micros / 1000000;
  const cost = Math.ceil(
    steps * Number(process.env.AI_MAX_STEP_COST_USD || 0.05) * 1000000,
  );
  if (!Number.isFinite(cost) || cost <= 0)
    throw new AppError(
      "AI_BUDGET_CONFIG",
      503,
      "AI cost limits are not configured correctly.",
    );
  const summary = aiCostSummary(p.id);
  if (summary.paused || cost > micros(summary.remainingUsd))
    throw new AppError(
      "AI_BUDGET_EXCEEDED",
      409,
      "AI is paused or its project cost budget is exhausted. Review the budget before generating again.",
    );
  const daily =
    one(
      "SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) AS n FROM ai_costs WHERE status!='released' AND created_at>=?",
      new Date().setUTCHours(0, 0, 0, 0),
    )?.n || 0;
  const dailyCap = micros(Number(process.env.AI_DAILY_BUDGET_USD || 100));
  if (!Number.isFinite(dailyCap) || daily + cost > dailyCap)
    throw new AppError(
      "AI_DAILY_BUDGET",
      503,
      "The service AI cost limit has been reached for today.",
    );
  run(
    "INSERT INTO ai_costs VALUES (?,?,?,?,?,?,?)",
    costId,
    p.id,
    p.workspace_id,
    cost,
    null,
    "reserved",
    now(),
  );
  return cost / 1000000;
}
export function dispatchAiCost(costId: string) {
  run("UPDATE ai_costs SET status='dispatching' WHERE job_id=?", costId);
}
export function settleAiCost(p: Row, costId: string, cost: number | null) {
  const reservation = requireValue(
    one("SELECT * FROM ai_costs WHERE job_id=?", costId),
  );
  run(
    "UPDATE ai_costs SET cost_micros=?,status=? WHERE job_id=?",
    cost === null ? null : micros(cost),
    cost === null ? "unknown" : "settled",
    costId,
  );
  if (cost !== null && micros(cost) > reservation.reserved_micros) {
    run(
      "INSERT INTO ai_controls VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET paused=1,reason=excluded.reason",
      p.id,
      micros(5),
      1,
      "Provider exceeded the agreed cost cap",
    );
    throw new AppError(
      "AI_COST_CAP_EXCEEDED",
      503,
      "The AI provider exceeded its agreed cost cap. Generation is paused for review.",
    );
  }
}
export function failAiCost(p: Row, costId: string) {
  const cost = one("SELECT * FROM ai_costs WHERE job_id=?", costId);
  if (cost?.status === "reserved")
    run(
      "UPDATE ai_costs SET status='released',reserved_micros=0 WHERE job_id=?",
      costId,
    );
  if (cost?.status === "dispatching")
    run("UPDATE ai_costs SET status='unknown' WHERE job_id=?", costId);
  if (
    (one(
      "SELECT COUNT(*) AS n FROM ai_costs WHERE project_id=? AND status='unknown' AND created_at>?",
      p.id,
      now() - 15 * 60000,
    )?.n || 0) >= 3
  ) {
    run(
      "INSERT INTO ai_controls VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET paused=1,reason=excluded.reason",
      p.id,
      micros(5),
      1,
      "Repeated provider failures; cost needs review",
    );
    audit("worker", p.id, "ai_circuit_opened");
  }
}

import { useEffect, useState } from "react";
import { api, send } from "./api";
import { Badge, Button, ErrorNotice, Field, Panel } from "./ui";
export function Resources({ projectId }: { projectId: string }) {
  const [data, setData] = useState<any>(null),
    [budget, setBudget] = useState(5),
    [reason, setReason] = useState(""),
    [ack, setAck] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function load() {
    const result = await api(`/projects/${projectId}/resources`);
    setData(result);
    setBudget(result.ai.budgetUsd);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [projectId]);
  return (
    <Panel title="AI cost & task protection">
      <ErrorNotice error={error} />
      {data && (
        <>
          <div className="action-row">
            <Badge tone={data.ai.paused ? "amber" : "green"}>
              {data.ai.paused ? "AI paused for review" : "AI budget available"}
            </Badge>
            <span>Known cost: ${data.ai.knownCostUsd.toFixed(4)} USD</span>
            <span>
              Reserved or uncertain: $
              {data.ai.reservedOrUncertainUsd.toFixed(4)} USD
            </span>
            <span>Remaining: ${data.ai.remainingUsd.toFixed(4)} USD</span>
          </div>
          {data.ai.reason && <p>{data.ai.reason}</p>}
          <p className="muted">
            Unknown provider charges stay reserved. Successful schema validation
            consumes AI step allowance even if a suggestion is rejected. Budget
            controls do not enable an unconfigured provider.
          </p>
          <Field label="Project AI cost budget (USD)">
            <input
              type="number"
              min={0.1}
              max={1000}
              step={0.1}
              value={budget}
              onChange={(e) => {
                setBudget(Number(e.target.value));
                setAck(false);
              }}
            />
          </Field>
          <Field label="Reason for budget change">
            <textarea
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <label className="check-field">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I reviewed known and uncertain charges before changing this limit or
            resuming AI.
          </label>
          <Button
            kind="secondary"
            disabled={
              !ack || reason.trim().length < 5 || !Number.isFinite(budget)
            }
            onClick={async () => {
              try {
                await send(
                  `/projects/${projectId}/ai-budget`,
                  {
                    budgetUsd: budget,
                    resume: data.ai.paused,
                    reason,
                    acknowledgement: true,
                  },
                  "PATCH",
                );
                await load();
                setAck(false);
                setReason("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {data.ai.paused ? "Update budget & resume AI" : "Save AI budget"}
          </Button>
          <details>
            <summary>Task metadata and limits</summary>
            <p>
              Exports run in a credential-free process with a 256 MiB Node heap
              and a 180-second hard limit. Canceling a task terminates its
              renderer process tree.
            </p>
            {data.tasks.map((task: any) => (
              <p key={`${task.type}:${task.state}`}>
                {task.type} · {task.state} · {task.count} tasks · Longest
                recorded {Math.round((task.longest_ms || 0) / 1000)}s
              </p>
            ))}
          </details>
        </>
      )}
    </Panel>
  );
}

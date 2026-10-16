import { useEffect, useState } from "react";
import { api, formatDate, send } from "./api";
import {
  Badge,
  Button,
  ErrorNotice,
  Field,
  Link,
  PageHeading,
  Panel,
} from "./ui";

export function Operations() {
  const [data, setData] = useState<any>(null);
  const [selected, setSelected] = useState<{ kind: string; row: any } | null>(
    null,
  );
  const [detail, setDetail] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [requestStatus, setRequestStatus] = useState("in_progress");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  async function load() {
    setData(await api("/ops"));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="public-document">
      <Link to="/app/projects" className="button text">
        Creator workspace
      </Link>
      <PageHeading
        eyebrow="METADATA ONLY"
        title="Operations diagnostics"
        description="Restricted support access. Repair actions require a reason and are recorded in the audit trail."
        actions={
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() => void action(load)}
          >
            Refresh status
          </Button>
        }
      />
      <ErrorNotice error={error} />
      {message && <p role="status">{message}</p>}
      {data &&
        Object.entries(data).map(([kind, rows]) => (
          <Panel key={kind} title={kind}>
            {!(rows as any[]).length ? (
              <p>No records.</p>
            ) : (
              (rows as any[]).map((row) => (
                <div className="request-row" key={row.id}>
                  <div>
                    <strong>{row.id}</strong>
                    <small>
                      {row.type ||
                        row.kind ||
                        row.currency ||
                        row.scope ||
                        kind}{" "}
                      · {formatDate(row.created_at)}
                    </small>
                    {row.error && <small>{row.error}</small>}
                    {row.error_code && <small>{row.error_code}</small>}
                  </div>
                  <Badge>
                    {row.state ||
                      row.status ||
                      row.error_code ||
                      (row.revoked_at
                        ? "revoked"
                        : row.expires_at <= Date.now()
                          ? "expired"
                          : "active")}
                  </Badge>
                  {[
                    "jobs",
                    "orders",
                    "requests",
                    "grants",
                    "webhooks",
                  ].includes(kind) && (
                    <Button
                      kind="secondary"
                      disabled={
                        busy ||
                        (kind === "grants" &&
                          (!!row.revoked_at || row.expires_at <= Date.now()))
                      }
                      onClick={() =>
                        void action(async () => {
                          setSelected({ kind, row });
                          setReason("");
                          setDetail(null);
                          setDetail(
                            kind === "jobs"
                              ? await api(`/ops/jobs/${row.id}`)
                              : kind === "webhooks"
                                ? await api(`/ops/webhooks/${row.id}`)
                                : kind === "grants"
                                  ? await api(`/ops/grants/${row.id}`)
                                  : row,
                          );
                        })
                      }
                    >
                      {kind === "grants"
                        ? "Review authorized scope"
                        : "Inspect"}
                    </Button>
                  )}
                </div>
              ))
            )}
          </Panel>
        ))}
      {selected && detail && (
        <Panel
          title={`${selected.kind === "jobs" ? "Job metadata" : selected.kind === "grants" ? "Authorized support sample" : "Review record"} · ${detail.id}`}
        >
          {selected.kind === "grants" ? (
            <>
              <p>
                Scope: {detail.scope} · Expires {formatDate(detail.expires_at)}
              </p>
              {detail.scope === "sample" ? (
                <pre className="support-sample">{detail.sample}</pre>
              ) : (
                <p>No content access was authorized.</p>
              )}
            </>
          ) : (
            <>
              <dl className="detail-list">
                {Object.entries(detail).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replaceAll("_", " ")}</dt>
                    <dd>
                      {key.endsWith("_at") && typeof value === "number"
                        ? formatDate(value)
                        : String(value ?? "Unavailable")}
                    </dd>
                  </div>
                ))}
              </dl>
              <Field label="Reason for repair">
                <textarea
                  rows={2}
                  minLength={5}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain why this controlled action is needed."
                />
              </Field>
              {selected.kind === "jobs" && (
                <Button
                  disabled={
                    busy ||
                    reason.trim().length < 5 ||
                    detail.state !== "failed" ||
                    !["ai", "export"].includes(detail.type)
                  }
                  onClick={() =>
                    void action(async () => {
                      await send(`/ops/jobs/${detail.id}/retry`, { reason });
                      setDetail(null);
                      setSelected(null);
                      setMessage(
                        "Controlled retry queued. Permissions and allowance were checked again.",
                      );
                    })
                  }
                >
                  Retry task
                </Button>
              )}
              {selected.kind === "orders" && (
                <Button
                  disabled={busy || reason.trim().length < 5}
                  onClick={() =>
                    void action(async () => {
                      const result = await send(
                        `/ops/orders/${detail.id}/check`,
                        { reason },
                      );
                      setMessage(
                        `Provider verification result: ${result.status}${result.local ? " · Local order only" : ""}`,
                      );
                    })
                  }
                >
                  Verify provider status
                </Button>
              )}
              {selected.kind === "webhooks" && (
                <>
                  <p>
                    Retry queries the current provider transaction. It does not
                    trust or edit the stored event. Controlled retries have a
                    15-minute cooldown.
                  </p>
                  <Button
                    disabled={
                      busy ||
                      reason.trim().length < 5 ||
                      detail.status !== "dead" ||
                      (detail.retry_available_at != null &&
                        detail.retry_available_at > Date.now())
                    }
                    onClick={() =>
                      void action(async () => {
                        await send(`/ops/webhooks/${detail.id}/retry`, {
                          reason,
                        });
                        setDetail(null);
                        setSelected(null);
                        setMessage(
                          "Payment event queued for provider verification. Entitlements change only after verification succeeds.",
                        );
                      })
                    }
                  >
                    Retry payment event
                  </Button>
                </>
              )}
              {selected.kind === "requests" && (
                <>
                  <Field label="Support request status">
                    <select
                      value={requestStatus}
                      onChange={(e) => setRequestStatus(e.target.value)}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </Field>
                  <Button
                    disabled={busy || reason.trim().length < 5}
                    onClick={() =>
                      void action(async () => {
                        await send(
                          `/ops/requests/${detail.id}`,
                          { status: requestStatus, reason },
                          "PATCH",
                        );
                        setDetail(null);
                        setSelected(null);
                        setMessage("Support request status updated.");
                      })
                    }
                  >
                    Update request status
                  </Button>
                </>
              )}
            </>
          )}
          <Button
            kind="text"
            onClick={() => {
              setSelected(null);
              setDetail(null);
            }}
          >
            Close details
          </Button>
        </Panel>
      )}
      <p className="muted">
        No edits to published snapshots or receipt records. No account
        impersonation. Content access is limited to an active sample explicitly
        provided by its owner.
      </p>
      <Link to="/auth?reauth=1" className="button secondary">
        Reverify for operations access
      </Link>
    </div>
  );
}

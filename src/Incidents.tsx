import { useEffect, useState } from "react";
import { api, formatDate, send } from "./api";
import { Badge, Button, ErrorNotice, Field, Panel } from "./ui";
export function Incidents({ projectId }: { projectId: string }) {
  const [incidents, setIncidents] = useState<any[]>([]),
    [error, setError] = useState<string | null>(null),
    [resolution, setResolution] = useState<Record<string, string>>({}),
    [ack, setAck] = useState<Record<string, boolean>>({});
  async function load() {
    setIncidents(await api(`/projects/${projectId}/incidents`));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [projectId]);
  return (
    <Panel title="Safety incidents">
      <ErrorNotice error={error} />
      {!incidents.length ? (
        <p className="muted">
          Safety withdrawals create an incident record and notify affected
          active clients.
        </p>
      ) : (
        incidents.map((incident) => (
          <article className="incident-record" key={incident.id}>
            <div className="action-row">
              <Badge tone={incident.status === "closed" ? "green" : "red"}>
                {incident.status}
              </Badge>
              <small>{formatDate(incident.created_at)}</small>
            </div>
            <p>{incident.reason}</p>
          <p>{incident.affected.length} affected versions · {incident.notified.length} client notifications</p>
            <p className="muted">
              Withdrawn images, annotation bases and exports stay isolated.
              Closing this record does not restore sharing or withdrawn content.
            </p>
            {incident.resolution && <p>Resolution: {incident.resolution}</p>}
            {incident.status !== "closed" && (
              <>
                <Field label="Incident resolution">
                  <textarea
                    maxLength={2000}
                    rows={3}
                    value={resolution[incident.id] || ""}
                    onChange={(e) =>
                      setResolution({
                        ...resolution,
                        [incident.id]: e.target.value,
                      })
                    }
                  />
                </Field>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={!!ack[incident.id]}
                    onChange={(e) =>
                      setAck({ ...ack, [incident.id]: e.target.checked })
                    }
                  />
                  I reviewed affected content and notifications, and handled
                  exposed credentials through their original provider.
                </label>
                <Button
                  kind="secondary"
                  disabled={
                    !ack[incident.id] ||
                    (resolution[incident.id] || "").trim().length < 5
                  }
                  onClick={async () => {
                    try {
                      await send(
                        `/projects/${projectId}/incidents/${incident.id}`,
                        {
                          status: "closed",
                          resolution: resolution[incident.id],
                          checklist: true,
                        },
                        "PATCH",
                      );
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Close incident record
                </Button>
              </>
            )}
          </article>
        ))
      )}
    </Panel>
  );
}

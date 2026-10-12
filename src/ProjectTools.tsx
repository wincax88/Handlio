import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  FileText,
  History,
  ListChecks,
  Mail,
  MessageSquare,
  Plus,
  RotateCcw,
  ShieldCheck,
  Users,
  X,
  BookOpen,
  ArrowUp,
  ArrowDown,
  CircleHelp,
} from "lucide-react";
import type { Issue, Release } from "../shared/model";
import type { ProjectEditorProps } from "./ProjectPage";
import { api, formatDate, navigate, send } from "./api";
import {
  Badge,
  Button,
  Empty,
  ErrorNotice,
  Field,
  Link,
  Loading,
  PageHeading,
  Panel,
} from "./ui";
import { Manual } from "./Reader";
import { Metric } from "./Prototype";
import { VersionComparison } from "./Comparison";
export async function waitJob(jid: string) {
  for (let i = 0; i < 185; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const j = await api(`/jobs/${jid}`);
    if (j.state === "succeeded") return j;
    if (["failed", "canceled", "expired"].includes(j.state))
      throw new Error(j.error || `Task ${j.state}.`);
  }
  throw new Error(
    "The task is taking longer than expected. Check the task list.",
  );
}
export function Handbook({
  project: p,
  draft: d,
  update,
  flush,
  session,
}: ProjectEditorProps) {
  const [check, setCheck] = useState<any>(null);
  const [preview, setPreview] = useState(
    new URLSearchParams(location.search).has("preview"),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoAssets, setLogoAssets] = useState<any[]>([]);
  const [previewMode, setPreviewMode] = useState("desktop");
  useEffect(() => {
    void api(`/projects/${p.id}/assets`)
      .then(setLogoAssets)
      .catch(() => {});
  }, [p.id]);
  async function inspect() {
    setBusy(true);
    setError(null);
    try {
      await flush();
      setCheck(await send(`/projects/${p.id}/validate`, {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Shape the handoff"
        description="A complete manual: clear steps, a checklist and somewhere to ask for help."
        actions={
          <>
            <Button kind="secondary" onClick={() => setPreview(!preview)}>
              <Eye size={16} />
              {preview ? "Close preview" : "Preview"}
            </Button>
            <Button disabled={busy} onClick={() => void inspect()}>
              <ListChecks size={16} />
              {busy ? "Checking…" : "Run publishing check"}
            </Button>
          </>
        }
      />
      <ErrorNotice error={error} />
      {preview ? (
        <div className={`draft-preview preview-${previewMode}`}>
          <div className="action-row preview-controls">
            <Button
              kind={previewMode === "desktop" ? "" : "secondary"}
              onClick={() => setPreviewMode("desktop")}
            >
              Desktop
            </Button>
            <Button
              kind={previewMode === "mobile" ? "" : "secondary"}
              onClick={() => setPreviewMode("mobile")}
            >
              Mobile
            </Button>
          </div>
          <Badge tone="amber">
            Owner draft preview · not a published version
          </Badge>
          <Manual
            release={{
              id: "draft",
              version: 0,
              status: "draft",
              hash: "",
              summary: "",
              publishedAt: "",
              changes: { added: [], modified: [], removed: [] },
              snapshot: {
                ...d,
                guides: d.guides.filter((g) => g.included),
                projectName: p.name,
                clientName: p.clientName,
              },
            }}
          />
        </div>
      ) : (
        <div className="handbook-grid">
          <div>
            <Panel
              title="Handbook structure"
              actions={<small>Included in this draft</small>}
            >
              <div className="structure-fixed-row">
                <FileText size={19} />
                <div>
                  <strong>Project overview</strong>
                  <small>Cover, introduction and scope</small>
                </div>
              </div>
              {d.guides.map((g, i) => (
                <div
                  className="structure-guide-row"
                  key={g.id}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/plain", g.id)
                  }
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const gid = e.dataTransfer.getData("text/plain");
                    update((v) => {
                      const index = v.guides.findIndex((x) => x.id === gid);
                      if (index < 0) return;
                      const [moved] = v.guides.splice(index, 1);
                      v.guides.splice(i, 0, moved);
                    });
                  }}
                >
                  <span className="drag-handle" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <span className="project-monogram">
                    <BookOpen size={18} />
                  </span>
                  <div>
                    <strong>{g.title}</strong>
                    <small>
                      {g.steps.length} steps ·{" "}
                      {g.goal || "Add the goal in your guide"}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Move ${g.title} up`}
                    disabled={i === 0}
                    onClick={() =>
                      update((v) => {
                        [v.guides[i - 1], v.guides[i]] = [
                          v.guides[i],
                          v.guides[i - 1],
                        ];
                      })
                    }
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Move ${g.title} down`}
                    disabled={i === d.guides.length - 1}
                    onClick={() =>
                      update((v) => {
                        [v.guides[i + 1], v.guides[i]] = [
                          v.guides[i],
                          v.guides[i + 1],
                        ];
                      })
                    }
                  >
                    <ArrowDown size={15} />
                  </button>
                  <Link
                    to={`/app/projects/${p.id}/guides/${g.id}`}
                    className="button secondary"
                  >
                    Edit
                  </Link>
                  <input
                    type="checkbox"
                    aria-label={`Include ${g.title} in release`}
                    checked={g.included}
                    onChange={(e) =>
                      update((v) => {
                        v.guides.find((x) => x.id === g.id)!.included =
                          e.target.checked;
                      })
                    }
                  />
                </div>
              ))}
              <div className="structure-fixed-row">
                <CheckCircle2 size={19} />
                <div>
                  <strong>Handoff checklist</strong>
                  <small>
                    {d.checklist.filter((c) => c.required).length} required
                    items
                  </small>
                </div>
                <a href="#handbook-checklist" className="button secondary">
                  Edit
                </a>
              </div>
              <div className="structure-fixed-row">
                <CircleHelp size={19} />
                <div>
                  <strong>Support & maintenance</strong>
                  <small>Contact details and clear boundaries</small>
                </div>
                <a href="#handbook-support" className="button secondary">
                  Edit
                </a>
              </div>
              <p className="muted structure-note">
                Only included guides are published. Internal notes and client
                comments are excluded from the handbook and exports.
              </p>
            </Panel>
            <div id="handbook-checklist">
              <Panel
                title="Required handoff checklist"
                actions={
                  <Button
                    kind="text"
                    onClick={() =>
                      update((v) =>
                        v.checklist.push({
                          id: crypto.randomUUID(),
                          title: "New checklist item",
                          description: "",
                          guideId: null,
                          required: true,
                          done: false,
                        }),
                      )
                    }
                  >
                    <Plus size={15} />
                    Add item
                  </Button>
                }
              >
                <p className="muted">
                  Your checklist marks content as provided. It does not mean the
                  client has received or understood it.
                </p>
                {d.checklist.map((c) => (
                  <div key={c.id} className="checklist-editor">
                    <label className="check-box">
                      <input
                        aria-label={`Complete ${c.title}`}
                        type="checkbox"
                        checked={c.done}
                        onChange={(e) =>
                          update((v) => {
                            v.checklist.find((x) => x.id === c.id)!.done =
                              e.target.checked;
                          })
                        }
                      />
                    </label>
                    <div>
                      <input
                        aria-label="Checklist title"
                        maxLength={160}
                        value={c.title}
                        onChange={(e) =>
                          update((v) => {
                            v.checklist.find((x) => x.id === c.id)!.title =
                              e.target.value;
                          })
                        }
                      />
                      <textarea
                        aria-label="Checklist explanation"
                        rows={2}
                        maxLength={1000}
                        value={c.description}
                        onChange={(e) =>
                          update((v) => {
                            v.checklist.find(
                              (x) => x.id === c.id,
                            )!.description = e.target.value;
                          })
                        }
                        placeholder="What has been explained?"
                      />
                      <select
                        aria-label="Associated guide"
                        value={c.guideId || ""}
                        onChange={(e) =>
                          update((v) => {
                            v.checklist.find((x) => x.id === c.id)!.guideId =
                              e.target.value || null;
                          })
                        }
                      >
                        <option value="">No guide reference</option>
                        {d.guides.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.title}
                          </option>
                        ))}
                      </select>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={c.required}
                          onChange={(e) =>
                            update((v) => {
                              v.checklist.find((x) => x.id === c.id)!.required =
                                e.target.checked;
                            })
                          }
                        />
                        Required for receipt request
                      </label>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Remove checklist item"
                      onClick={() =>
                        update((v) => {
                          v.checklist = v.checklist.filter(
                            (x) => x.id !== c.id,
                          );
                        })
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </Panel>
            </div>
            <div id="handbook-support">
              <Panel title="Support & maintenance">
                <div className="form-grid">
                  <Field label="Support email">
                    <input
                      type="email"
                      value={d.supportEmail}
                      onChange={(e) =>
                        update((v) => {
                          v.supportEmail = e.target.value;
                        })
                      }
                      placeholder="support@yourstudio.com"
                    />
                  </Field>
                  <Field label="Support website (HTTPS)">
                    <input
                      type="url"
                      value={d.supportUrl}
                      onChange={(e) =>
                        update((v) => {
                          v.supportUrl = e.target.value;
                        })
                      }
                      placeholder="https://yourstudio.com/support"
                    />
                  </Field>
                </div>
                <Field label="Maintenance boundaries">
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={d.maintenance}
                    onChange={(e) =>
                      update((v) => {
                        v.maintenance = e.target.value;
                      })
                    }
                    placeholder="What is included, what requires another request, and how your client gets help."
                  />
                </Field>
                <details className="internal-source">
                  <summary>Project terminology</summary>
                  <Field
                    label="Terms used in this project"
                    hint="Up to 30 terms, one per line. Used for AI consistency checks."
                  >
                    <textarea
                      rows={3}
                      value={d.terms.join("\n")}
                      onChange={(e) =>
                        update((v) => {
                          v.terms = e.target.value
                            .split("\n")
                            .filter(Boolean)
                            .slice(0, 30)
                            .map((t) => t.slice(0, 100));
                        })
                      }
                    />
                  </Field>
                </details>
              </Panel>
            </div>
          </div>
          <aside>
            <Panel
              title="Brand & cover"
              actions={<Badge>One reliable layout</Badge>}
            >
              <Field label="Cover title">
                <input
                  maxLength={160}
                  value={d.title}
                  onChange={(e) =>
                    update((v) => {
                      v.title = e.target.value;
                    })
                  }
                />
              </Field>
              <Field label="Introduction">
                <textarea
                  maxLength={1000}
                  rows={3}
                  value={d.intro}
                  onChange={(e) =>
                    update((v) => {
                      v.intro = e.target.value;
                    })
                  }
                  placeholder="A clear guide to your client’s next steps."
                />
              </Field>
              <Field label="Brand color">
                <div className="color-field">
                  <input
                    type="color"
                    value={d.color}
                    onChange={(e) =>
                      update((v) => {
                        v.color = e.target.value;
                      })
                    }
                  />
                  <span>{d.color.toUpperCase()}</span>
                </div>
              </Field>
              <Field
                label="Brand logo (optional)"
                hint="Only processed images from your screenshot library."
              >
                <select
                  value={d.logoId || ""}
                  onChange={(e) =>
                    update((v) => {
                      v.logoId = e.target.value || null;
                    })
                  }
                >
                  <option value="">Text-only cover</option>
                  {logoAssets
                    .filter((a) => a.status === "ready")
                    .map((a, i) => (
                      <option key={a.id} value={a.id}>
                        Processed image {i + 1} · {a.width} × {a.height}
                      </option>
                    ))}
                </select>
              </Field>
              <div className="cover-preview">
                <p className="eyebrow" style={{ color: d.color }}>
                  {p.clientName}
                </p>
                <h2>{d.title}</h2>
                <p>{d.intro || "Add an introduction to frame the handoff."}</p>
                <div className="divider" />
                <small>
                  Prepared by {session.user!.settings.name}
                  <br />
                  Draft for version {(p.currentRelease?.version || 0) + 1}
                </small>
                <p style={{ margin: "18px 0 0" }}>
                  <Badge>Creator preview</Badge>
                </p>
              </div>
            </Panel>
            {check && <ValidationResult check={check} projectId={p.id} />}
            <div className="notice">
              <ShieldCheck size={17} />
              <span>
                Publishing freezes the instructions, images, brand and checklist
                into a new version. Draft edits never change a client’s release.
              </span>
            </div>
            <Link to={`/app/projects/${p.id}/releases`} className="button full">
              Continue to publishing <ArrowRight size={15} />
            </Link>
          </aside>
        </div>
      )}
    </>
  );
}
function ValidationResult({
  check,
  projectId,
}: {
  check: any;
  projectId: string;
}) {
  return (
    <Panel title="Publishing check">
      <Badge tone={check.blockers.length ? "red" : "green"}>
        {check.blockers.length
          ? `${check.blockers.length} blocking checks`
          : "Ready for review"}
      </Badge>
      {check.blockers.map((v: Issue, i: number) => (
        <div className="validation-item blocking" key={i}>
          <X size={15} />
          <div>
            <p>{v.message}</p>
            {v.guideId && (
              <Link to={`/app/projects/${projectId}/guides/${v.guideId}`}>
                Review guide <ArrowUpRight size={12} />
              </Link>
            )}
            {v.code === "PAYMENT_REQUIRED" && (
              <Link to={`/app/billing?project=${projectId}`}>
                Activate package
              </Link>
            )}
          </div>
        </div>
      ))}
      {check.warnings.map((v: Issue, i: number) => (
        <div className="validation-item warning" key={i}>
          <span>!</span>
          <p>{v.message}</p>
        </div>
      ))}
      {!check.blockers.length && !check.warnings.length && (
        <p className="muted">
          All publishing checks passed for saved revision {check.revision}.
        </p>
      )}
    </Panel>
  );
}
export function Releases({
  project: p,
  draft,
  flush,
  refresh,
  session,
  saved,
}: ProjectEditorProps) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [check, setCheck] = useState<any>(null);
  const [summary, setSummary] = useState("");
  const [warningReason, setWarningReason] = useState("");
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdraw, setWithdraw] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [security, setSecurity] = useState(false);
  const [view, setView] = useState<Release | null>(null);
  async function load() {
    setReleases(await api(`/projects/${p.id}/releases`));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [p.id, p.currentRelease?.id]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    await flush();
    if (!check || check.revision !== p.revision)
      throw new Error("Run a publishing check for the saved draft again.");
    const job = await send(`/projects/${p.id}/releases`, {
      draftRevision: check.revision,
      validationId: check.id,
      summary,
      warningReason,
    });
    await waitJob(job.jobId);
    await refresh();
    await load();
    setCheck(null);
    setSummary("");
  }
  return (
    <>
      <PageHeading
        eyebrow="A CLEAR RECORD OF EVERY CHANGE"
        title="Publish & manage versions"
        description="Every release is a frozen snapshot. A new version needs its own client receipt."
      />
      <ErrorNotice error={error} />
      <div className="release-compose">
        <div>
          <p className="eyebrow">NEXT RELEASE</p>
          <h2>Version {Math.max(0, ...releases.map((r) => r.version)) + 1}</h2>
          <p>
            Save and check your draft before publishing. Existing clients keep
            reading the current release.
          </p>
          <Field label="What changed?">
            <textarea
              rows={3}
              maxLength={1000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={
                releases.length
                  ? "Explain the changes clients need to know about."
                  : "Initial client handbook, reviewed and ready for handoff."
              }
            />
          </Field>
          {check?.warnings.length > 0 && (
            <>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={warningAccepted}
                  onChange={(e) => setWarningAccepted(e.target.checked)}
                />
                I reviewed these warnings and accept them for this release.
              </label>
              <Field label="Reason for accepting the warnings">
                <textarea
                  rows={2}
                  value={warningReason}
                  maxLength={1000}
                  onChange={(e) => setWarningReason(e.target.value)}
                />
              </Field>
            </>
          )}
          <div className="action-row">
            <Button
              kind="secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await flush();
                  setCheck(await send(`/projects/${p.id}/validate`, {}));
                  setWarningAccepted(false);
                  setWarningReason("");
                })
              }
            >
              <ListChecks size={16} />
              Check saved draft
            </Button>
            <Button
              disabled={
                busy ||
                !summary.trim() ||
                !saved ||
                !check ||
                check.revision !== p.revision ||
                check.blockers.length > 0 ||
                (check.warnings.length > 0 &&
                  (!warningAccepted || !warningReason.trim()))
              }
              onClick={() => void action(publish)}
            >
              {busy ? "Working…" : "Publish version"}
              <ArrowUpRight size={16} />
            </Button>
          </div>
        </div>
        <div>
          {check ? (
            <ValidationResult check={check} projectId={p.id} />
          ) : (
            <div className="publishing-note">
              <ShieldCheck size={27} />
              <h3>Checked, frozen, versioned.</h3>
              <p>
                Instructions, images, brand settings and checklist are bound to
                one manifest hash. Draft edits won’t rewrite this record.
              </p>
              <small>
                Free drafts can be previewed. Formal publishing requires an
                active project package.
              </small>
            </div>
          )}
        </div>
      </div>
      <h2 className="section-title">Version history</h2>
      {releases.length > 0 && (
        <VersionComparison
          key={releases.map((r) => r.id).join(":")}
          releases={releases}
          draft={draft}
          projectName={p.name}
          clientName={p.clientName}
        />
      )}
      {!releases.length ? (
        <Panel>
          <Empty
            title="Your first release is ahead."
            body="Complete the handbook, run the check, and publish version 1."
            icon={<History size={27} />}
          />
        </Panel>
      ) : (
        <div className="release-history">
          {releases.map((r) => (
            <article key={r.id}>
              <div className="release-history-heading">
                <span className="release-version">v{r.version}</span>
                <div>
                  <strong>{r.summary}</strong>
                  <small>
                    {formatDate(r.publishedAt, session.user!.settings.timezone)}
                  </small>
                </div>
                <Badge tone={r.status === "published" ? "green" : "red"}>
                  {r.id === p.currentRelease?.id ? "Current · " : ""}
                  {r.status.replace("_", " ")}
                </Badge>
              </div>
              <p className="hash-line">SHA-256 {r.hash}</p>
              <details>
                <summary>Changes in this version</summary>
                <p>Added: {r.changes.added.join(", ") || "No steps"}</p>
                <p>Modified: {r.changes.modified.join(", ") || "No steps"}</p>
                <p>Removed: {r.changes.removed.join(", ") || "No steps"}</p>
              </details>
              <div className="action-row">
                <Button
                  kind="text"
                  disabled={r.status === "security_revoked"}
                  onClick={() => setView(view?.id === r.id ? null : r)}
                >
                  <Eye size={15} />
                  View snapshot
                </Button>
                <Button
                  kind="text"
                  disabled={busy || r.status === "security_revoked"}
                  onClick={() =>
                    void action(async () => {
                      await flush();
                      await send(`/releases/${r.id}/restore`, {});
                      await refresh();
                      setCheck(null);
                    })
                  }
                >
                  <RotateCcw size={15} />
                  Copy to new draft
                </Button>
                <Button
                  kind="text danger-text"
                  disabled={r.status !== "published"}
                  onClick={() => setWithdraw(withdraw === r.id ? null : r.id)}
                >
                  Withdraw release
                </Button>
              </div>
              {view?.id === r.id && (
                <div className="draft-preview">
                  <Manual release={r} />
                </div>
              )}
              {withdraw === r.id && (
                <div className="withdraw-form">
                  <Field label="Withdrawal reason">
                    <textarea
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={security}
                      onChange={(e) => setSecurity(e.target.checked)}
                    />
                    Safety incident: isolate all images and affected versions
                  </label>
                  <p className="muted">
                    Previously downloaded files cannot be recalled. Security
                    withdrawal blocks related assets and exports.
                  </p>
                  <Link to="/auth?reauth=1" className="button text">
                    Verify session if needed
                  </Link>
                  <Button
                    kind="danger"
                    disabled={!reason.trim() || busy}
                    onClick={() =>
                      void action(async () => {
                        await send(`/releases/${r.id}/withdraw`, {
                          reason,
                          security,
                        });
                        await refresh();
                        await load();
                        setWithdraw(null);
                      })
                    }
                  >
                    Withdraw this release
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
export function Handoff({
  project: p,
  session,
  flush,
  refresh,
}: ProjectEditorProps) {
  const [data, setData] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Confirmer");
  const [download, setDownload] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localInvite, setLocalInvite] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [reply, setReply] = useState<Record<string, string>>({});
  const [questionFilter, setQuestionFilter] = useState("open");
  const [resolutionVersions, setResolutionVersions] = useState<
    Record<string, string>
  >({});
  const [versions, setVersions] = useState<Release[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [linkMessage, setLinkMessage] = useState("");
  async function load() {
    setData(await api(`/projects/${p.id}/handoff`));
    setVersions(await api(`/projects/${p.id}/releases`));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [p.id]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await flush();
      await fn();
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="A clear handoff, together."
        description="Invite the right people. Keep questions and receipts tied to a version."
        actions={
          <>
            <Button
              kind="secondary"
              disabled={!p.currentRelease}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${location.origin}/h/${p.publicId}`,
                  );
                  setLinkMessage(
                    "Invited-client link copied. Email verification is required.",
                  );
                } catch {
                  setLinkMessage(
                    `Copy this link: ${location.origin}/h/${p.publicId}`,
                  );
                }
              }}
            >
              Copy invited-client link
            </Button>
            <Link to={`/h/${p.publicId}`} className="button secondary">
              Preview as a client
            </Link>
            <Button
              disabled={!p.sharing}
              onClick={() =>
                document
                  .getElementById("invite-client")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              <Users size={16} />
              Invite client
            </Button>
          </>
        }
      />
      <ErrorNotice error={error} />
      {linkMessage && <p role="status">{linkMessage}</p>}
      <div className="sharing-strip">
        <div>
          <ShieldCheck size={20} />
          <div>
            <strong>
              {p.sharing
                ? "Client access is enabled"
                : "Client access is paused"}
            </strong>
            <p>
              Clients see published versions only. Invitations never grant
              workspace access.
            </p>
          </div>
        </div>
        <Button
          kind="secondary"
          disabled={busy || !p.currentRelease}
          onClick={() =>
            void action(async () => {
              await send(`/projects/${p.id}`, { sharing: !p.sharing }, "PATCH");
            })
          }
        >
          {p.sharing ? "Pause sharing" : "Enable sharing"}
        </Button>
      </div>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="workspace-summary handoff-stats">
            <Metric
              label="Current release"
              value={
                p.currentRelease ? `v${p.currentRelease.version}` : "Draft"
              }
              note={
                p.currentRelease
                  ? `Published ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: session.user!.settings.timezone }).format(new Date(p.currentRelease.publishedAt))}`
                  : "No published version yet"
              }
              icon={BookOpen}
            />
            <Metric
              label="Client receipts"
              value={
                p.confirmation
                  ? `${p.confirmation.confirmations.length} / ${p.confirmation.required.length}`
                  : "Not requested"
              }
              note="Required confirmers for this version"
              icon={CheckCircle2}
            />
            <Metric
              label="Open questions"
              value={p.openQuestions}
              note={
                data.questions.some(
                  (q: any) => q.blocking && q.status === "open",
                )
                  ? "Blocking questions need attention"
                  : "No blocking questions"
              }
              icon={MessageSquare}
            />
          </div>
          <div className="handoff-grid">
            <div id="invite-client">
              <Panel title="Invite a client">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      const emails = email.split(/[\s,;]+/).filter(Boolean);
                      const result = await send(`/projects/${p.id}/invites`, {
                        emails,
                        role,
                        download,
                      });
                      setLocalInvite(
                        result.localInviteUrl ||
                          (result.invitations?.length === 1
                            ? result.invitations[0].localInviteUrl
                            : "") ||
                          "",
                      );
                      setInvitations(result.invitations || [result]);
                      setEmail("");
                    });
                  }}
                >
                  <Field
                    label="Client email"
                    hint="One per line or separated by commas. Up to 10 emails per batch; duplicates are sent once."
                  >
                    <textarea
                      rows={3}
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="client@company.com"
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Project role">
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                      >
                        <option>Viewer</option>
                        <option>Reviewer</option>
                        <option>Confirmer</option>
                      </select>
                    </Field>
                    <Field label="Downloads">
                      <select
                        value={String(download)}
                        onChange={(e) => setDownload(e.target.value === "true")}
                      >
                        <option value="true">Allowed</option>
                        <option value="false">Disabled</option>
                      </select>
                    </Field>
                  </div>
                  <Button type="submit" disabled={busy || !p.sharing}>
                    <Mail size={16} />
                    Send private invitation
                  </Button>
                </form>
                <small className="muted">
                  Disabling downloads does not prevent screenshots or copies
                  already saved.
                </small>
                {localInvite && (
                  <div className="notice">
                    <span>
                      Local development invitation:{" "}
                      <a href={localInvite} target="_blank" rel="noreferrer">
                        Open in a separate browser session{" "}
                        <ArrowUpRight size={12} />
                      </a>
                    </span>
                  </div>
                )}
                {invitations.length > 0 && (
                  <div role="status">
                    <p>
                      {invitations.length} invitation
                      {invitations.length === 1 ? "" : "s"} queued.
                    </p>
                    {invitations.map((invite) => (
                      <p key={invite.id}>
                        {invite.email}
                        {invite.localInviteUrl && (
                          <>
                            {" "}
                            ·{" "}
                            <a
                              href={invite.localInviteUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open local invitation
                            </a>
                          </>
                        )}
                      </p>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
            <Panel title="Request version receipt">
              <p className="muted">
                Select 1–3 active confirmers. Required checklist items and
                blocking questions must be complete.
              </p>
              {data.members
                .filter(
                  (m: any) => m.role === "Confirmer" && m.status === "active",
                )
                .map((m: any) => (
                  <label className="check-field" key={m.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(m.id)}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked
                            ? [...prev, m.id]
                            : prev.filter((v) => v !== m.id),
                        )
                      }
                    />
                    {m.email}
                  </label>
                ))}
              {!data.members.some(
                (m: any) => m.role === "Confirmer" && m.status === "active",
              ) && <p>Invite a client as a Confirmer to get started.</p>}
              <Field label="Message (optional)">
                <textarea
                  rows={2}
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              <Field label="Requested reply date (optional)">
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </Field>
              <Button
                disabled={
                  busy ||
                  !p.currentRelease ||
                  selected.length < 1 ||
                  selected.length > 3 ||
                  !p.sharing
                }
                onClick={() =>
                  void action(async () => {
                    await send(
                      `/releases/${p.currentRelease!.id}/confirmation-requests`,
                      { memberIds: selected, note, dueAt: due || null },
                    );
                    setSelected([]);
                  })
                }
              >
                <CheckCircle2 size={16} />
                Request receipt of v{p.currentRelease?.version || "—"}
              </Button>
              <small className="muted">
                This records receipt. It is not an electronic contract
                signature.
              </small>
            </Panel>
          </div>
          <Panel title="Project members">
            <div className="members-list">
              {!data.members.length ? (
                <Empty
                  title="No clients invited yet"
                  body="Publish a handbook, enable sharing, and invite your client’s verified email."
                  icon={<Users size={24} />}
                />
              ) : (
                data.members.map((m: any) => (
                  <div className="member-row" key={m.id}>
                    <span className="avatar">{m.email[0].toUpperCase()}</span>
                    <div>
                      <strong>{m.email}</strong>
                      <small>
                        Visible from v{m.min_version} · {m.status}
                      </small>
                    </div>
                    <select
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      disabled={busy || m.status === "removed"}
                      onChange={(e) =>
                        void action(async () => {
                          await send(
                            `/projects/${p.id}/members/${m.id}`,
                            {
                              role: e.target.value,
                              download: !!m.download,
                              status: m.status,
                            },
                            "PATCH",
                          );
                        })
                      }
                    >
                      <option>Viewer</option>
                      <option>Reviewer</option>
                      <option>Confirmer</option>
                    </select>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        disabled={m.status === "removed"}
                        checked={!!m.download}
                        onChange={(e) =>
                          void action(async () => {
                            await send(
                              `/projects/${p.id}/members/${m.id}`,
                              {
                                role: m.role,
                                download: e.target.checked,
                                status: m.status,
                              },
                              "PATCH",
                            );
                          })
                        }
                      />
                      Download
                    </label>
                    <Button
                      kind="text danger-text"
                      disabled={busy || m.status === "removed"}
                      onClick={() =>
                        void action(async () => {
                          await send(
                            `/projects/${p.id}/members/${m.id}`,
                            {
                              role: m.role,
                              download: !!m.download,
                              status: "removed",
                            },
                            "PATCH",
                          );
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))
              )}
            </div>
          </Panel>
          <Panel title="Version receipt requests">
            {!data.requests.length ? (
              <p className="muted">
                No receipt has been requested. Reading activity never counts as
                confirmation.
              </p>
            ) : (
              data.requests.map((r: any) => (
                <div className="request-row" key={r.id}>
                  <div>
                    <strong>
                      {r.confirmations.length} / {r.required.length} required
                      confirmations
                    </strong>
                    <small>
                      Version hash {r.hash.slice(0, 16)}… ·{" "}
                      {r.due_at ? `Requested by ${r.due_at}` : "No due date"}
                    </small>
                    {r.confirmations.map((c: any) => (
                      <small key={c.member_id}>
                        Confirmed{" "}
                        {formatDate(
                          c.created_at,
                          session.user!.settings.timezone,
                        )}{" "}
                        · receipt-v1
                      </small>
                    ))}
                  </div>
                  <Badge tone={r.status === "confirmed" ? "green" : "neutral"}>
                    {r.status}
                    {r.due_at &&
                    new Date(r.due_at + "T23:59:59Z").getTime() < Date.now() &&
                    ["pending", "in_progress"].includes(r.status)
                      ? " · Overdue"
                      : ""}
                  </Badge>
                  <Button
                    kind="text"
                    disabled={
                      busy || !["pending", "in_progress"].includes(r.status)
                    }
                    onClick={() =>
                      void action(async () => {
                        await send(`/confirmation-requests/${r.id}/remind`, {});
                      })
                    }
                  >
                    Remind pending clients
                  </Button>
                </div>
              ))
            )}
          </Panel>
          <Panel title="Client questions">
            <Field label="Question status">
              <select
                value={questionFilter}
                onChange={(e) => setQuestionFilter(e.target.value)}
              >
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="all">All questions</option>
              </select>
            </Field>
            {data.questions.length > 0 &&
              !data.questions.some(
                (q: any) =>
                  questionFilter === "all" || q.status === questionFilter,
              ) && <p>No {questionFilter} questions.</p>}
            {!data.questions.length ? (
              <Empty
                title="All quiet, for now."
                body="Version and step-specific questions from clients will appear here."
                icon={<MessageSquare size={24} />}
              />
            ) : (
              data.questions
                .filter(
                  (q: any) =>
                    questionFilter === "all" || q.status === questionFilter,
                )
                .map((q: any) => (
                  <article className="question-card" key={q.id}>
                    <div className="action-row">
                      <Badge tone={q.status === "open" ? "amber" : "green"}>
                        {q.status}
                      </Badge>
                      {!!q.blocking && (
                        <Badge tone="red">Blocks confirmation</Badge>
                      )}
                      <small>
                        {formatDate(
                          q.created_at,
                          session.user!.settings.timezone,
                        )}
                      </small>
                    </div>
                    <p>{q.body}</p>
                    <small>
                      Version v{q.version}
                      {q.step_id ? ` · Step ${q.step_id.slice(0, 8)}` : ""}
                    </small>
                    <a
                      className="button text"
                      href={`/h/${p.publicId}?release=${q.release_id}#${q.step_id ? `step-${q.step_id}` : "handbook-overview"}`}
                    >
                      View the referenced {q.step_id ? "step" : "version"}
                    </a>
                    {q.replies.map((r: any) => (
                      <div className="reply" key={r.id}>
                        {r.body}
                      </div>
                    ))}
                    {q.status === "open" && (
                      <>
                        <Field label="Reply">
                          <textarea
                            rows={2}
                            maxLength={2000}
                            value={reply[q.id] || ""}
                            onChange={(e) =>
                              setReply((v) => ({
                                ...v,
                                [q.id]: e.target.value,
                              }))
                            }
                          />
                        </Field>
                        <Button
                          kind="text"
                          disabled={busy || !reply[q.id]?.trim()}
                          onClick={() =>
                            void action(async () => {
                              await send(`/questions/${q.id}/replies`, {
                                body: reply[q.id],
                              });
                              setReply((v) => ({ ...v, [q.id]: "" }));
                            })
                          }
                        >
                          Send reply
                        </Button>
                        <Field label="Resolution note">
                          <textarea
                            rows={2}
                            maxLength={2000}
                            value={resolutions[q.id] || ""}
                            onChange={(e) =>
                              setResolutions((v) => ({
                                ...v,
                                [q.id]: e.target.value,
                              }))
                            }
                            placeholder="Explain how this was resolved. It remains attached to its original version."
                          />
                        </Field>
                        <Field label="Resolved by">
                          <select
                            value={resolutionVersions[q.id] || "reply"}
                            onChange={(e) =>
                              setResolutionVersions({
                                ...resolutionVersions,
                                [q.id]: e.target.value,
                              })
                            }
                          >
                            <option value="reply">
                              Reply only — no new release
                            </option>
                            {versions
                              .filter((v) => v.status === "published")
                              .map((v) => (
                                <option key={v.id} value={v.id}>
                                  Version v{v.version} · {v.summary}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <Button
                          kind="secondary"
                          disabled={busy || !resolutions[q.id]?.trim()}
                          onClick={() =>
                            void action(async () => {
                              await send(
                                `/questions/${q.id}`,
                                {
                                  status: "resolved",
                                  resolution: resolutions[q.id],
                                  resolvedReleaseId:
                                    resolutionVersions[q.id] &&
                                    resolutionVersions[q.id] !== "reply"
                                      ? resolutionVersions[q.id]
                                      : null,
                                },
                                "PATCH",
                              );
                            })
                          }
                        >
                          Mark resolved
                        </Button>
                      </>
                    )}
                    {q.resolution && (
                      <p className="resolution">Resolution: {q.resolution}</p>
                    )}
                  </article>
                ))
            )}
          </Panel>
          <details className="delivery-status">
            <summary>Notification delivery status</summary>
            {data.notifications.map((n: any) => (
              <div className="request-row" key={n.id}>
                <span>{n.subject}</span>
                <Badge>{n.state}</Badge>
                <small>{n.attempts} attempts</small>
              </div>
            ))}
          </details>
        </>
      )}
    </>
  );
}
export function Exports({ project: p, session }: ProjectEditorProps) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [rid, setRid] = useState(p.currentRelease?.id || "");
  const [format, setFormat] = useState("pdf");
  const [paper, setPaper] = useState("A4");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState(p.entitlement);
  async function load() {
    setJobs(await api(`/projects/${p.id}/jobs`));
    setReleases(await api(`/projects/${p.id}/releases`));
    setUsage((await api(`/projects/${p.id}`)).entitlement);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const t = setInterval(
      () =>
        void api(`/projects/${p.id}/jobs`)
          .then(setJobs)
          .catch(() => {}),
      3000,
    );
    return () => clearInterval(t);
  }, [p.id]);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const j = await send(`/releases/${rid}/exports`, { format, paper });
      await load();
      await waitJob(j.jobId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="READY BEYOND THE BROWSER"
        title="Export your handoff"
        description="Portable files generated from a published version. No comments, client emails, or internal notes."
      />
      <ErrorNotice error={error} />
      <div className="export-allowance">
        <strong>Export allowance</strong>
        <span>
          Current window: {usage.exportsUsed} /{" "}
          {usage.state === "expired_grace" ? 10 : usage.limits.exports}
        </span>
        <span>Today: {usage.exportsToday} / 10</span>
        <small>
          Failed jobs do not use successful-export allowance. Valid cached
          downloads do not use a new export.
        </small>
      </div>
      <div className="export-layout">
        <Panel title="Prepare an export">
          <Field label="Published version">
            <select value={rid} onChange={(e) => setRid(e.target.value)}>
              <option value="">Choose a version</option>
              {releases
                .filter((r) => r.status === "published")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    v{r.version} · {r.summary}
                  </option>
                ))}
            </select>
          </Field>
          <div className="export-formats">
            <button
              className={format === "pdf" ? "selected" : ""}
              onClick={() => setFormat("pdf")}
            >
              <FileText size={24} />
              <strong>PDF document</strong>
              <p>A printable, versioned handbook.</p>
            </button>
            <button
              className={format === "html" ? "selected" : ""}
              onClick={() => setFormat("html")}
            >
              <ArrowDownToLine size={24} />
              <strong>Offline HTML ZIP</strong>
              <p>A complete, self-contained reading package.</p>
            </button>
          </div>
          {format === "pdf" && (
            <Field label="Paper size">
              <select value={paper} onChange={(e) => setPaper(e.target.value)}>
                <option>A4</option>
                <option>Letter</option>
              </select>
            </Field>
          )}
          <Button disabled={busy || !rid} onClick={() => void create()}>
            <ArrowDownToLine size={16} />
            {busy ? "Preparing your export…" : "Generate export"}
          </Button>
        </Panel>
        <div className="export-note">
          <ShieldCheck size={25} />
          <h2>The version travels with it.</h2>
          <p>
            Each file includes the release number, publication time, support
            information, and manifest identity.
          </p>
          <p>
            The offline ZIP includes all images and styling. Unzip the whole
            folder and open index.html. No login or network is needed to read
            it.
          </p>
          <small>
            Generated files are kept for 7 days. Repeated downloads of a cached
            file do not use another export. Existing copies cannot be remotely
            recalled.
          </small>
        </div>
      </div>
      <Panel title="Export activity">
        {!jobs.some((j) => j.type === "export") ? (
          <Empty
            title="No exports yet"
            body="Publish a version, then choose PDF or an offline reading package."
          />
        ) : (
          jobs
            .filter((j) => j.type === "export")
            .map((j) => (
              <div className="export-job" key={j.id}>
                <FileText size={23} />
                <div>
                  <strong>
                    {j.format === "html"
                      ? "Offline HTML ZIP"
                      : j.format === "pdf"
                        ? "PDF handbook"
                        : "Preparing export"}
                  </strong>
                  <small>
                    Version v
                    {releases.find((r) => r.id === j.releaseId)?.version || "—"}
                    {j.format === "pdf" ? ` · ${j.paper}` : " · HTML ZIP"}
                  </small>
                  <small>
                    {formatDate(j.created_at, session.user!.settings.timezone)}
                    {j.output?.bytes
                      ? ` · ${(j.output.bytes / 1024).toFixed(0)} KiB`
                      : ""}
                  </small>
                  {j.error && <small className="danger-text">{j.error}</small>}
                  {j.availableUntil && (
                    <small>
                      Available until{" "}
                      {formatDate(
                        j.availableUntil,
                        session.user!.settings.timezone,
                      )}
                    </small>
                  )}
                </div>
                <Badge
                  tone={
                    j.state === "succeeded"
                      ? "green"
                      : j.state === "failed"
                        ? "red"
                        : "neutral"
                  }
                >
                  {j.state}
                </Badge>
                {j.state === "failed" && (
                  <Button
                    kind="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const retry = await send(`/jobs/${j.id}/retry`, {
                          reason:
                            "Retry failed export after reviewing the error",
                        });
                        await load();
                        await waitJob(retry.jobId);
                        await load();
                      } catch (e) {
                        setError((e as Error).message);
                        await load();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Retry export
                  </Button>
                )}
                {j.state === "expired" && (
                  <Button
                    kind="secondary"
                    disabled={busy}
                    onClick={() => {
                      setRid(j.releaseId);
                      setFormat(j.format);
                      setPaper(j.paper || "A4");
                      document
                        .querySelector(".export-layout")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    Generate again
                  </Button>
                )}
                {j.state === "succeeded" && (
                  <>
                    <a
                      className="button secondary"
                      href={`/api/jobs/${j.id}/download`}
                    >
                      <ArrowDownToLine size={15} />
                      Download
                    </a>
                    <Button
                      kind="text danger-text"
                      onClick={async () => {
                        try {
                          await send(`/jobs/${j.id}/export`, {}, "DELETE");
                          await load();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Delete file
                    </Button>
                  </>
                )}
                {["queued", "running"].includes(j.state) && (
                  <Button
                    kind="text"
                    onClick={async () => {
                      await send(`/jobs/${j.id}/cancel`, {});
                      await load();
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            ))
        )}
      </Panel>
    </>
  );
}

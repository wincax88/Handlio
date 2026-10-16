import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Image,
  ListChecks,
  MessageSquare,
  Plus,
  ShieldCheck,
  Upload,
  Clock3,
  BookOpen,
  ArrowRight,
  RotateCcw,
  History,
  Users,
  Pencil,
  Eye,
} from "lucide-react";
import type { Draft } from "../shared/model";
import { sectionOrder } from "../shared/handbook";
import { ProjectLocaleSettings } from "./ProjectLocale";
import type { Project, Session } from "./types";
import { api, ApiError, formatDate, navigate, send } from "./api";
import {
  Back,
  Badge,
  Button,
  Empty,
  ErrorNotice,
  Field,
  Link,
  Loading,
  PageHeading,
  Panel,
  StepRow,
} from "./ui";
import { Metric, UsageBar } from "./Prototype";
import { Editor } from "./Editor";
import { Assets } from "./Assets";
import { Handbook, Releases, Handoff, Exports } from "./ProjectTools";
import { DraftMerge } from "./Comparison";
import { Resources } from "./Resources";
export type ProjectEditorProps = {
  project: Project;
  draft: Draft;
  update: (fn: (d: Draft) => void) => void;
  session: Session;
  flush: () => Promise<void>;
  refresh: () => Promise<void>;
  saved: boolean;
};
export function ProjectPage({
  id,
  tab,
  session,
}: {
  id: string;
  tab: string;
  session: Session;
}) {
  const [p, setP] = useState<Project | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState<string | null>(null);
  const [activeGuideId, setActiveGuideId] = useState<string | null>(null);
  const [compare, setCompare] = useState<Project | null>(null);
  const revision = useRef(0);
  const latest = useRef<Draft | null>(null);
  const persisted = useRef("");
  const refreshGeneration = useRef(0);
  const changedAt = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const blocked = useRef(false);
  const dirty = useRef(false);
  async function refresh(discard = false) {
    const generation = ++refreshGeneration.current;
    const editTime = changedAt.current;
    const result = await api<Project>(`/projects/${id}`);
    if (
      generation !== refreshGeneration.current ||
      result.revision < revision.current
    )
      return;
    if (dirty.current && (!discard || changedAt.current !== editTime)) {
      setP({ ...result, revision: revision.current, draft: latest.current! });
      return;
    }
    setP(result);
    setDraft(result.draft);
    latest.current = result.draft;
    persisted.current = JSON.stringify(result.draft);
    revision.current = result.revision;
    dirty.current = false;
    blocked.current = false;
    setStatus("saved");
    setError(null);
  }
  function update(fn: (d: Draft) => void) {
    const next = structuredClone(latest.current!);
    fn(next);
    next.sectionOrder = sectionOrder(next);
    if (
      JSON.stringify(next.guides.map((g) => g.id)) !==
      JSON.stringify(latest.current!.guides.map((g) => g.id))
    ) {
      let index = 0;
      next.sectionOrder = next.sectionOrder.map((key) =>
        key.startsWith("guide:") ? `guide:${next.guides[index++].id}` : key,
      );
    }
    latest.current = next;
    setDraft(next);
    dirty.current = JSON.stringify(next) !== persisted.current;
    changedAt.current = Date.now();
    setStatus(dirty.current ? "unsaved" : "saved");
  }
  async function flush() {
    if (inFlight.current) {
      await inFlight.current;
      if (dirty.current) return flush();
      return;
    }
    if (blocked.current)
      throw new Error("Resolve the save error before continuing.");
    if (!dirty.current) return;
    const body = structuredClone(latest.current!);
    const captured = JSON.stringify(body);
    setStatus("saving");
    const promise = (async () => {
      try {
        const saved = await send(
          `/projects/${id}/draft`,
          { baseRevision: revision.current, draft: body },
          "PATCH",
        );
        revision.current = saved.revision;
        persisted.current = captured;
        dirty.current = JSON.stringify(latest.current) !== captured;
        setP((prev) =>
          prev ? { ...prev, revision: saved.revision, draft: body } : prev,
        );
        setStatus(dirty.current ? "unsaved" : "saved");
        setError(null);
      } catch (e) {
        blocked.current = true;
        setStatus(
          e instanceof ApiError && e.code === "DRAFT_CONFLICT"
            ? "conflict"
            : "error",
        );
        setError((e as Error).message);
        throw e;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = promise;
    await promise;
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (
        dirty.current &&
        !blocked.current &&
        !inFlight.current &&
        Date.now() - changedAt.current >= 1500
      )
        void flush().catch(() => {});
    }, 500);
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      refreshGeneration.current++;
      clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
    };
  }, [id]);
  useEffect(() => {
    const prevent = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (
        dirty.current &&
        anchor &&
        !anchor.getAttribute("href")?.startsWith(`/app/projects/${id}`) &&
        !window.confirm(
          "Your latest changes are not saved. Leave this project?",
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", prevent, true);
    return () => document.removeEventListener("click", prevent, true);
  }, [id]);
  if (!p || !draft)
    return (
      <>
        <ErrorNotice error={error} />
        <Loading />
      </>
    );
  const tabs = [
    ["overview", "Overview"],
    ["assets", "Screenshots"],
    ["guides", "Guides"],
    ["handbook", "Handbook"],
    ["releases", "Versions"],
    ["handoff", "Handoff"],
    ["exports", "Exports"],
  ];
  const active = tab.startsWith("guides") ? "guides" : tab;
  const props: ProjectEditorProps = {
    project: p,
    draft,
    update,
    session,
    flush,
    refresh,
    saved: status === "saved",
  };
  const editable =
    ["free", "paid_active"].includes(p.entitlement.state) &&
    p.lifecycle === "active";
  if (active === "guides") {
    const g =
      draft.guides.find((g) => g.id === activeGuideId) ||
      draft.guides.find((g) => g.id === tab.split("/")[1]) ||
      draft.guides[0];
    return (
      <>
        <div className="editor-commandbar">
          <div>
            <Back to={`/app/projects/${id}/overview`}>Back to project</Back>
            <div>
              <strong>{g?.title || "Guide editor"}</strong>
              <small>
                {p.clientName} · Guide {g ? draft.guides.indexOf(g) + 1 : 0} /{" "}
                {draft.guides.length}
              </small>
            </div>
            <Badge>Draft v{(p.currentRelease?.version || 0) + 1}</Badge>
          </div>
          <div>
            <div className={`save-state ${status}`} role="status">
              {status === "saved" ? <Check size={15} /> : <Clock3 size={15} />}
              {
                {
                  saved: "Saved",
                  unsaved: "Unsaved changes",
                  saving: "Saving…",
                  error: "Save failed",
                  conflict: "Content conflict",
                }[status]
              }
            </div>
            <Link
              to={`/app/projects/${id}/handbook?preview=1`}
              className="button secondary"
            >
              <Eye size={14} />
              Preview
            </Link>
            <Link to={`/app/projects/${id}/releases`} className="button">
              Check & publish <ArrowRight size={14} />
            </Link>
          </div>
        </div>
        <ErrorNotice error={error} />
        {["error", "conflict"].includes(status) && (
          <div className="notice danger">
            <span>
              Your changes remain in memory. Open the project overview to
              compare conflicts or retry saving.
            </span>
            <Link to={`/app/projects/${id}/overview`} className="button text">
              Resolve save state
            </Link>
          </div>
        )}
        <div className={!editable ? "read-only" : ""}>
          <Editor
            {...props}
            guideId={tab.split("/")[1]}
            onGuideChange={setActiveGuideId}
          />
        </div>
      </>
    );
  }
  return (
    <>
      <div className="project-heading">
        <div>
          <div className="project-title-line">
            <h1>{p.name}</h1>
            <Badge tone={p.currentRelease ? "green" : "neutral"}>
              {p.currentRelease
                ? `Published · v${p.currentRelease.version}`
                : "Draft"}
            </Badge>
          </div>
          <p>
            {p.clientName}
            <span>·</span>Client handbook
          </p>
        </div>
        <div className="project-heading-actions">
          <div className={`save-state ${status}`} role="status">
            {status === "saved" ? <Check size={15} /> : <Clock3 size={15} />}
            {
              {
                saved: "All changes saved",
                unsaved: "Unsaved changes",
                saving: "Saving…",
                error: "Save failed",
                conflict: "Content conflict",
              }[status]
            }
          </div>
          <Link
            to={`/app/projects/${id}/handbook?preview=1`}
            className="button secondary"
          >
            <Eye size={15} />
            Preview
          </Link>
          <Link to={`/app/projects/${id}/guides`} className="button">
            <Pencil size={15} />
            Continue editing
          </Link>
        </div>
      </div>
      <nav className="project-tabs">
        {tabs.map(([path, label]) => (
          <Link
            key={path}
            to={`/app/projects/${id}/${path}`}
            className={active === path ? "active" : ""}
          >
            {label}
            {path === "handoff" && p.openQuestions > 0 && (
              <span className="tab-count">{p.openQuestions}</span>
            )}
          </Link>
        ))}
      </nav>
      <ErrorNotice error={error} />
      {status === "error" && (
        <Button
          kind="secondary"
          onClick={() => {
            blocked.current = false;
            void flush().catch(() => {});
          }}
        >
          Retry saving
        </Button>
      )}
      {status === "conflict" && (
        <div className="conflict-panel">
          <p>
            Your changes remain in this browser. Compare the server copy and
            merge changes before saving.
          </p>
          <Button
            kind="secondary"
            onClick={async () => setCompare(await api(`/projects/${id}`))}
          >
            Compare server draft
          </Button>
          {compare && (
            <DraftMerge
              key={compare.revision}
              base={JSON.parse(persisted.current)}
              local={draft}
              server={compare.draft}
              busy={false}
              onSave={async (merged) => {
                latest.current = merged;
                setDraft(merged);
                revision.current = compare.revision;
                setP({ ...compare, draft: merged });
                blocked.current = false;
                dirty.current = true;
                setStatus("unsaved");
                try {
                  await flush();
                  setCompare(null);
                } catch {}
              }}
              onDiscard={() => {
                if (
                  window.confirm(
                    "Discard your local changes and use the saved server draft?",
                  )
                )
                  void refresh(true);
              }}
            />
          )}
          {!compare && (
            <Button
              kind="text"
              onClick={() => {
                if (
                  window.confirm(
                    "Discard your local draft and reload the saved server version?",
                  )
                )
                  void refresh(true);
              }}
            >
              Discard local changes and reload
            </Button>
          )}
        </div>
      )}
      {!editable && (
        <div className="notice">
          {p.lifecycle === "archived"
            ? "This project is archived. Restore it to edit; sharing will stay paused."
            : `Editing has ended. Owner export access ends ${formatDate(p.entitlement.graceUntil, p.draft.timezone || "UTC")}.`}
        </div>
      )}
      <div
        className={
          !editable && ["assets", "guides", "handbook"].includes(active)
            ? "read-only"
            : ""
        }
      >
        {active === "overview" ? (
          <Overview {...props} />
        ) : active === "assets" ? (
          <Assets {...props} />
        ) : active === "guides" ? (
          <Editor {...props} guideId={tab.split("/")[1]} />
        ) : active === "handbook" ? (
          <Handbook {...props} />
        ) : active === "releases" ? (
          <Releases {...props} />
        ) : active === "handoff" ? (
          <Handoff {...props} />
        ) : active === "exports" ? (
          <Exports {...props} />
        ) : (
          <Overview {...props} />
        )}
      </div>
    </>
  );
}
function Overview(props: ProjectEditorProps) {
  const { project: p, draft: d, session, refresh, flush } = props;
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(p.name);
  const [clientName, setClientName] = useState(p.clientName);
  const [deleteName, setDeleteName] = useState("");
  const [copyName, setCopyName] = useState("");
  const [copyClient, setCopyClient] = useState("");
  const [copyReviewed, setCopyReviewed] = useState(false);
  const [copyAssets, setCopyAssets] = useState<string[]>([]);
  const [danger, setDanger] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handoff, setHandoff] = useState<any>(null);
  useEffect(() => {
    void api(`/projects/${p.id}/handoff`)
      .then(setHandoff)
      .catch(() => {});
  }, [p.id, p.updatedAt]);
  const steps = d.guides.reduce((n, g) => n + g.steps.length, 0);
  const e = p.entitlement;
  const tz = d.timezone || "UTC";
  const receipt = p.confirmation;
  const events = [
    ...(p.currentRelease
      ? [
          {
            id: p.currentRelease.id,
            title: `Version v${p.currentRelease.version} was published`,
            time: Date.parse(p.currentRelease.publishedAt),
            icon: BookOpen,
          },
        ]
      : []),
    ...(receipt?.confirmations || []).map((v: any) => ({
      id: v.member_id + v.created_at,
      title: `A client received version v${p.currentRelease?.version}`,
      time: v.created_at,
      icon: CheckCircle2,
    })),
    ...(handoff?.questions || []).map((v: any) => ({
      id: v.id,
      title:
        v.status === "resolved"
          ? "A question has been resolved"
          : "A client asked a question",
      time: v.created_at,
      icon: MessageSquare,
    })),
    ...(handoff?.members || [])
      .filter((v: any) => v.invited_at)
      .map((v: any) => ({
        id: v.id,
        title: "A client was invited",
        time: v.invited_at,
        icon: Users,
      })),
  ]
    .sort((a, b) => b.time - a.time)
    .slice(0, 4);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await flush();
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorNotice error={error} />
      {p.currentRelease ? (
        <div className="current-version-notice">
          <History size={17} />
          <p>
            <strong>
              Published version v{p.currentRelease.version} stays unchanged.
            </strong>{" "}
            You have a separate draft for v{p.currentRelease.version + 1}.
            Editing never changes the published handbook.
          </p>
          <Link
            to={`/app/projects/${p.id}/releases`}
            className="button secondary"
          >
            <ArrowRight size={14} />
            View versions
          </Link>
        </div>
      ) : (
        <div className="current-version-notice">
          <BookOpen size={17} />
          <p>
            <strong>Your handbook is a private draft.</strong> Add clear
            instructions, review your screenshots, and publish when you are
            ready to share.
          </p>
        </div>
      )}
      <div className="workspace-summary overview-stats">
        <Metric
          label="Current release"
          value={p.currentRelease ? `v${p.currentRelease.version}` : "Draft"}
          note={
            p.currentRelease
              ? `Published · ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: tz }).format(new Date(p.currentRelease.publishedAt))}`
              : "No published version yet"
          }
          icon={BookOpen}
        />
        <Metric
          label="Version receipts"
          value={
            receipt
              ? `${receipt.confirmations.length} / ${receipt.required.length}`
              : "Not requested"
          }
          note="Explicitly confirmed · not read progress"
          icon={Users}
        />
        <Metric
          label="Open questions"
          value={p.openQuestions}
          note={
            handoff?.questions.some(
              (q: any) => q.status === "open" && q.blocking,
            )
              ? "Blocking questions need attention"
              : "Questions are tied to their version"
          }
          icon={MessageSquare}
        />
        <Metric
          label="Hosting until"
          value={
            e.expiresAt
              ? new Intl.DateTimeFormat("en", {
                  month: "short",
                  day: "numeric",
                  timeZone: tz,
                }).format(new Date(e.expiresAt))
              : "Free draft"
          }
          note={
            e.expiresAt
              ? new Intl.DateTimeFormat("en", {
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: tz,
                  timeZoneName: "short",
                }).format(new Date(e.expiresAt))
              : "Activate when ready to share"
          }
          icon={Clock3}
        />
      </div>
      <div className="overview-grid">
        <div className="notice reading-summary">
          <span>
            Current version viewed by {p.reading.readers} / {p.reading.clients}{" "}
            active clients. Reading is separate from receipt confirmation.
          </span>
        </div>
        {e.storage >= e.limits.storage * 0.8 && (
          <div className="notice danger">
            <span>
              Storage is {Math.round((e.storage / e.limits.storage) * 100)}%
              full. Remove unused images or old export files before uploading
              more.
            </span>
          </div>
        )}
        <div>
          <section className="panel overview-handbook-list">
            <header className="panel-heading">
              <div>
                <h2>Your handbook</h2>
                <small>
                  {d.guides.length} guides · {steps} steps ·{" "}
                  {d.checklist.filter((c) => c.required).length} required
                  checklist items
                </small>
              </div>
              <Link
                to={`/app/projects/${p.id}/handbook`}
                className="button secondary"
              >
                <Pencil size={14} />
                Organize
              </Link>
            </header>
            {d.guides.map((g) => (
              <Link
                key={g.id}
                to={`/app/projects/${p.id}/guides/${g.id}`}
                className="guide-list-row"
              >
                <span className="project-monogram">
                  <BookOpen size={18} />
                </span>
                <div>
                  <strong>{g.title || "Untitled guide"}</strong>
                  <small>
                    {g.goal ||
                      "Add a goal, prerequisites and clear instructions."}
                  </small>
                </div>
                <Badge>{g.steps.length} steps</Badge>
                <ChevronRight size={17} />
              </Link>
            ))}
            <div className="handbook-list-footer">
              <small>Draft revision {p.revision} · Saved on the server</small>
              <Link
                to={`/app/projects/${p.id}/releases`}
                className="button secondary"
              >
                Check & publish <ArrowRight size={15} />
              </Link>
            </div>
          </section>
          <Panel
            title="Client handoff"
            actions={
              <Link
                to={`/app/projects/${p.id}/handoff`}
                className="button text"
              >
                Manage handoff <ArrowRight size={14} />
              </Link>
            }
          >
            <div className="current-handoff-preview">
              <span className="stepbubble">
                <CheckCircle2 size={19} />
              </span>
              <div>
                <h3>
                  {p.currentRelease
                    ? `Receipt of version v${p.currentRelease.version}`
                    : "Prepare your first handoff"}
                </h3>
                <p>
                  {receipt
                    ? receipt.status === "confirmed"
                      ? "All required client receipts are recorded for this version."
                      : "Waiting for the required clients to review and confirm this exact version."
                    : "Publish a version, invite your clients and request an explicit receipt."}
                </p>
                {receipt && (
                  <div className="receipt-progress">
                    <div className="usage-track">
                      <i
                        style={{
                          width: `${receipt.required.length ? (receipt.confirmations.length / receipt.required.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span>
                      {receipt.confirmations.length} of{" "}
                      {receipt.required.length}
                    </span>
                  </div>
                )}
                <p className="muted">
                  A receipt records this exact version. It is not a contract
                  acceptance.
                </p>
              </div>
            </div>
          </Panel>
        </div>
        <aside>
          <Panel
            title="Project pack"
            actions={
              <Badge tone={e.state === "paid_active" ? "green" : "neutral"}>
                <span className="status-dot" />
                {e.state === "paid_active"
                  ? "Active"
                  : e.state.replace("_", " ")}
              </Badge>
            }
          >
            <UsageBar
              label="Guides"
              value={d.guides.length}
              max={e.limits.guides}
            />
            <UsageBar label="Steps" value={steps} max={e.limits.steps} />
            <UsageBar
              label="Storage"
              value={e.storage / 1048576}
              max={Math.round(e.limits.storage / 1048576)}
              unit=" MiB"
            />
            <div className="detail-list compact">
              <div>
                <dt>AI steps remaining</dt>
                <dd>
                  {e.aiRemaining} / {e.limits.ai}
                </dd>
              </div>
              <div>
                <dt>New exports used</dt>
                <dd>
                  {e.exportsUsed} / {e.limits.exports}
                </dd>
              </div>
            </div>
            <p className="muted">
              No automatic renewal. AI credits expire with the original 90-day
              window.
            </p>
            <Link
              to={`/app/billing?project=${p.id}`}
              className="button secondary full"
            >
              {e.state === "free"
                ? "Activate project · $19"
                : "View billing & usage"}
              <ArrowUpRight size={15} />
            </Link>
          </Panel>
          <Panel title="Recent activity">
            {events.length ? (
              events.map((event) => (
                <div className="timeline-row" key={event.id}>
                  <span>
                    <event.icon size={13} />
                  </span>
                  <div>
                    <p>{event.title}</p>
                    <small>{formatDate(event.time, tz)}</small>
                  </div>
                </div>
              ))
            ) : (
              <p>
                Activity appears after you publish, invite a client, or receive
                a question.
              </p>
            )}
            <small>Times shown in {tz}.</small>
          </Panel>
        </aside>
      </div>
      <details className="project-details-fold">
        <summary>Project details</summary>
        <Panel title="Project details">
          <div className="form-grid">
            <Field label="Project name">
              <input
                maxLength={120}
                value={name}
                onChange={(ev) => setName(ev.target.value)}
              />
            </Field>
            <Field label="Client display name">
              <input
                maxLength={120}
                value={clientName}
                onChange={(ev) => setClientName(ev.target.value)}
              />
            </Field>
          </div>
          <Button
            kind="secondary"
            disabled={busy || (name === p.name && clientName === p.clientName)}
            onClick={() =>
              void action(async () => {
                await send(`/projects/${p.id}`, { name, clientName }, "PATCH");
                await refresh();
              })
            }
          >
            Save project details
          </Button>
        </Panel>
      </details>
      <ProjectLocaleSettings draft={d} update={props.update} />
      <section className="project-management">
        <Resources projectId={p.id} />
        <h2>Project management</h2>
        <details className="copy-project">
          <summary>Reuse this structure for another client</summary>
          <p>
            Review the guide text for customer-specific information. The new
            unpaid draft includes only the images you explicitly select. It
            excludes support details, invited clients, orders, links, questions
            and receipt records.
          </p>
          <div className="form-grid">
            <Field label="New project name">
              <input
                maxLength={120}
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
              />
            </Field>
            <Field label="New client name">
              <input
                maxLength={120}
                value={copyClient}
                onChange={(e) => setCopyClient(e.target.value)}
              />
            </Field>
          </div>
          <fieldset className="copy-images">
            <legend>Reviewed images to copy (optional)</legend>
            <p className="muted">
              Check these images for client-specific information. Each selected
              flattened image becomes an independent copy.
            </p>
            {[
              ...new Set(
                [
                  d.logoId,
                  ...d.guides.flatMap((g) => g.steps.map((s) => s.assetId)),
                ].filter(Boolean),
              ),
            ].map((aid) => (
              <label className="check-field" key={aid!}>
                <input
                  type="checkbox"
                  checked={copyAssets.includes(aid!)}
                  onChange={(e) => {
                    setCopyAssets(
                      e.target.checked
                        ? [...copyAssets, aid!]
                        : copyAssets.filter((id) => id !== aid),
                    );
                    setCopyReviewed(false);
                  }}
                />
                <img
                  src={`/api/assets/${aid}`}
                  alt="Reviewed image to copy"
                  style={{ width: 120, maxHeight: 80, objectFit: "contain" }}
                />
                {d.logoId === aid
                  ? "Brand logo"
                  : d.guides
                      .flatMap((g) => g.steps)
                      .find((s) => s.assetId === aid)?.title}
              </label>
            ))}
          </fieldset>
          <label className="check-field">
            <input
              type="checkbox"
              checked={copyReviewed}
              onChange={(e) => setCopyReviewed(e.target.checked)}
            />
            I reviewed the source text and will replace client-specific
            information.
          </label>
          <Button
            kind="secondary"
            disabled={
              busy || !copyName.trim() || !copyClient.trim() || !copyReviewed
            }
            onClick={() =>
              void action(async () => {
                const result = await send(`/projects/${p.id}/copy`, {
                  name: copyName,
                  clientName: copyClient,
                  reviewed: true,
                  assetIds: copyAssets,
                });
                navigate(`/app/projects/${result.id}`);
              })
            }
          >
            Create independent draft
          </Button>
        </details>
        <Button
          kind="secondary"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await send(
                `/projects/${p.id}`,
                {
                  lifecycle: p.lifecycle === "archived" ? "active" : "archived",
                },
                "PATCH",
              );
              await refresh();
            })
          }
        >
          {p.lifecycle === "archived" ? "Restore project" : "Archive project"}
        </Button>
        <Button kind="text danger-text" onClick={() => setDanger(!danger)}>
          Delete project
        </Button>
        {danger && (
          <div className="delete-form">
            <p>
              Deletion immediately revokes client access and cancels tasks.
              Content is removed within 7 days. Download existing releases
              first.
            </p>
            <Field label={`Type “${p.name}” to confirm`}>
              <input
                value={deleteName}
                onChange={(ev) => setDeleteName(ev.target.value)}
              />
            </Field>
            <Button
              kind="danger"
              disabled={busy || deleteName !== p.name}
              onClick={() =>
                void action(async () => {
                  await send(
                    `/projects/${p.id}`,
                    { name: deleteName },
                    "DELETE",
                  );
                  navigate("/app/projects");
                })
              }
            >
              Delete this project
            </Button>
            <Link to="/auth?reauth=1" className="button text">
              Verify session for sensitive actions
            </Link>
          </div>
        )}
      </section>
    </>
  );
}

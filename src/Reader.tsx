import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  FileText,
  List,
  Mail,
  MessageSquare,
  Search,
  ShieldCheck,
  X,
  ZoomIn,
  History,
} from "lucide-react";
import { Logo } from "./Prototype";
import type { Release } from "../shared/model";
import type { Session } from "./types";
import { api, assetUrl, formatDate, send } from "./api";
import {
  Badge,
  Button,
  Empty,
  ErrorNotice,
  Field,
  Link,
  Loading,
  Panel,
} from "./ui";
export function Manual({
  release,
  query = "",
  onQuestion,
}: {
  release: Release;
  query?: string;
  onQuestion?: (stepId: string) => void;
}) {
  const d = release.snapshot;
  const matches = (text: string) =>
    !query || text.toLowerCase().includes(query.toLowerCase());
  const isDraft = release.id === "draft";
  return (
    <div
      className="manual"
      style={{ "--brand": d.color } as React.CSSProperties}
    >
      <header className="manual-cover" id="handbook-overview">
        {d.logoId ? (
          <img
            className="manual-logo"
            src={assetUrl(d.logoId, isDraft ? undefined : release.id)}
            alt="Brand logo"
          />
        ) : (
          <span className="manual-brand">{d.projectName}</span>
        )}
        <p className="eyebrow">PREPARED FOR {d.clientName.toUpperCase()}</p>
        <h1>{d.title}</h1>
        <p className="manual-intro">{d.intro}</p>
        <div className="manual-meta">
          <Badge tone="green">
            {isDraft ? "Draft preview" : `Version ${release.version}`}
          </Badge>
          {release.publishedAt && (
            <span>{formatDate(release.publishedAt)}</span>
          )}
        </div>
        {release.summary && (
          <details className="manual-changes">
            <summary>What’s new in this version</summary>
            <p>{release.summary}</p>
          </details>
        )}
      </header>
      {d.guides.map((g, i) => {
        const guideMatches = matches(
          [
            g.title,
            g.goal,
            g.prerequisites,
            g.audience,
            g.completion,
            g.faq,
          ].join(" "),
        );
        const steps = g.steps.filter(
          (s) =>
            guideMatches ||
            matches([s.title, s.body, s.expected, s.warning, s.alt].join(" ")),
        );
        if (query && !guideMatches && !steps.length) return null;
        return (
          <section className="manual-guide" key={g.id} id={`guide-${g.id}`}>
            <div className="manual-guide-heading">
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h2>{g.title}</h2>
                <p>{g.goal}</p>
              </div>
            </div>
            <div className="manual-prerequisites">
              <p>
                <strong>Before you begin</strong>
                <br />
                {g.prerequisites}
              </p>
              <p>
                <strong>Who this is for</strong>
                <br />
                {g.audience}
              </p>
            </div>
            {steps.map((s) => (
              <article className="manual-step" key={s.id} id={`step-${s.id}`}>
                <div className="manual-step-heading">
                  <span>{g.steps.indexOf(s) + 1}</span>
                  <h3>{s.title}</h3>
                </div>
                <p>{s.body}</p>
                {s.assetId && (
                  <Screenshot
                    aid={s.assetId}
                    releaseId={isDraft ? undefined : release.id}
                    alt={s.alt}
                  />
                )}{" "}
                {s.expected && (
                  <p className="manual-result">
                    <CheckCircle2 size={17} />
                    <span>
                      <strong>Expected result</strong>
                      <br />
                      {s.expected}
                    </span>
                  </p>
                )}
                {s.warning && (
                  <p className="manual-warning">
                    <strong>Please note</strong>
                    <br />
                    {s.warning}
                  </p>
                )}
                {onQuestion && (
                  <div className="manual-step-actions">
                    <button onClick={() => onQuestion(s.id)}>
                      <MessageSquare size={15} />
                      Ask about this step
                    </button>
                    <button
                      onClick={() => {
                        const url = new URL(location.href);
                        url.hash = `step-${s.id}`;
                        void navigator.clipboard.writeText(url.toString());
                      }}
                    >
                      <ArrowUpRight size={15} />
                      Copy step link
                    </button>
                  </div>
                )}
              </article>
            ))}
            <p className="manual-completion">
              <strong>You’re done when</strong>
              <br />
              {g.completion}
            </p>
            {g.faq && (
              <details>
                <summary>Common questions</summary>
                <p>{g.faq}</p>
              </details>
            )}
          </section>
        );
      })}
      {query &&
        !d.guides.some((g) =>
          matches(
            [
              g.title,
              g.goal,
              g.prerequisites,
              g.audience,
              g.completion,
              g.faq,
              ...g.steps.flatMap((s) => [
                s.title,
                s.body,
                s.expected,
                s.warning,
                s.alt,
              ]),
            ].join(" "),
          ),
        ) && (
          <Empty
            title="No matching instructions"
            body="Try another word or clear the search to read the full handbook."
          />
        )}
      {!query && (
        <>
          <section className="manual-guide" id="handoff-checklist">
            <h2>Handoff checklist</h2>
            <p>
              The creator marks these when instructions are provided. Your
              receipt confirmation is a separate action.
            </p>
            {d.checklist.map((c) => (
              <div className="manual-checklist-item" key={c.id}>
                <span>
                  {c.done ? (
                    <CheckCircle2 size={19} />
                  ) : (
                    <span className="empty-circle" />
                  )}
                </span>
                <div>
                  <strong>{c.title}</strong>
                  {c.required && <Badge>Required</Badge>}
                  <p>{c.description}</p>
                </div>
              </div>
            ))}
          </section>
          <section className="manual-guide" id="support">
            <h2>Support & maintenance</h2>
            <p>{d.maintenance}</p>
            {d.supportEmail && (
              <a href={`mailto:${d.supportEmail}`} className="support-link">
                <Mail size={17} />
                {d.supportEmail}
              </a>
            )}
            {d.supportUrl && (
              <a
                href={d.supportUrl}
                target="_blank"
                rel="noreferrer"
                className="support-link"
              >
                Visit support website
                <ArrowUpRight size={16} />
              </a>
            )}
          </section>
        </>
      )}
      <footer className="manual-footer">
        <span>
          Prepared with <strong>handlio.</strong>
        </span>
        <p>
          Receipt confirmation is a workflow record, not an electronic contract
          signature.
        </p>
        {release.hash && (
          <small>Version identity · SHA-256 {release.hash}</small>
        )}
      </footer>
    </div>
  );
}
function Screenshot({
  aid,
  releaseId,
  alt,
}: {
  aid: string;
  releaseId?: string;
  alt: string;
}) {
  const [zoom, setZoom] = useState(false);
  return (
    <figure className={`manual-screenshot ${zoom ? "zoomed" : ""}`}>
      <div>
        <img loading="lazy" src={assetUrl(aid, releaseId)} alt={alt} />
      </div>
      <button className="zoom-button" onClick={() => setZoom(!zoom)}>
        <ZoomIn size={15} />
        {zoom ? "Fit screenshot" : "Zoom screenshot"}
      </button>
      {alt && <figcaption>{alt}</figcaption>}
    </figure>
  );
}
export function Reader({
  publicId,
  session,
}: {
  publicId: string;
  session: Session;
}) {
  const [data, setData] = useState<any>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState(false);
  const [stepId, setStepId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [activeAnchor, setActiveAnchor] = useState("handbook-overview");
  async function load() {
    const rid = new URLSearchParams(location.search).get("release");
    try {
      setData(
        await api(
          `/client/handbooks/${publicId}${rid ? `?release=${rid}` : ""}`,
        ),
      );
      setPreview(false);
    } catch (e) {
      if (session.user?.workspaceId) {
        try {
          const p = await api(
            `/projects/public/${publicId}/preview${rid ? `?release=${rid}` : ""}`,
          );
          setData(p);
          setPreview(true);
          return;
        } catch {}
      }
      throw e;
    }
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const listener = () => {
      setData(null);
      setError(null);
      void load().catch((e) => setError(e.message));
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, [publicId]);
  useEffect(() => {
    if (!data || preview) return;
    let started = Date.now();
    const visibility = () => {
      started = Date.now();
    };
    document.addEventListener("visibilitychange", visibility);
    const t = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - started >= 5000
      ) {
        void send(`/releases/${data.release.id}/read`, {}).catch(() => {});
        clearInterval(t);
      }
    }, 1000);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [data?.release.id, preview]);
  useEffect(() => {
    if (data && location.hash)
      setTimeout(
        () =>
          document
            .getElementById(decodeURIComponent(location.hash.slice(1)))
            ?.scrollIntoView(),
        100,
      );
  }, [data]);
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
  if (!data)
    return (
      <div className="reader-unavailable">
        <Link to="/" className="brand">
          handlio.
        </Link>
        {error ? (
          <>
            <h1>This handoff is unavailable.</h1>
            <ErrorNotice error={error} />
            <p>Verify the invited email or contact the sender.</p>
            <Link to={`/h/${publicId}/access`} className="button">
              Verify your email
            </Link>
            <Link to="/help" className="button text">
              Report a link problem
            </Link>
          </>
        ) : (
          <Loading />
        )}
      </div>
    );
  const r = data.release as Release;
  const request = data.requests?.find(
    (q: any) =>
      q.isRequired &&
      ["pending", "in_progress", "confirmed"].includes(q.status),
  );
  const confirmed = request?.confirmations.length > 0;
  const feedback = !preview && data.member.role !== "Viewer";
  const unresolved =
    data.questions?.filter((q: any) => q.status === "open") || [];
  async function exportFile(format: string) {
    const j = await send(`/releases/${r.id}/exports`, { format, paper: "A4" });
    for (let i = 0; i < 185; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await api(`/jobs/${j.jobId}`);
      if (result.state === "succeeded") {
        location.assign(`/api/jobs/${j.jobId}/download`);
        return;
      }
      if (["failed", "canceled"].includes(result.state))
        throw new Error("Export failed. Please retry.");
    }
    throw new Error("Export is taking longer than expected.");
  }
  return (
    <div className="reader-page">
      <header className="reader-topbar">
        <button
          className="icon-button reader-toc-toggle"
          aria-label="Open handbook contents"
          aria-expanded={tocOpen}
          onClick={() => setTocOpen(!tocOpen)}
        >
          <List size={18} />
        </button>
        <Link to={`/h/${publicId}`} className="reader-brand">
          <span>✳</span>
          <div>
            <strong>{r.snapshot.clientName}</strong>
            <small>{r.snapshot.title}</small>
          </div>
        </Link>
        <div className="reader-verified">
          <ShieldCheck size={15} />
          {preview ? "Owner preview" : "Verified private handoff"}
        </div>
        <div className="reader-header-actions">
          {((!preview && data.member.download) || preview) && (
            <details className="reader-download-menu">
              <summary className="button secondary">
                <ArrowDownToLine size={15} />
                Download
              </summary>
              <div>
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() => void action(async () => exportFile("pdf"))}
                >
                  <FileText size={15} />
                  PDF document
                </Button>
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() => void action(async () => exportFile("html"))}
                >
                  <ArrowDownToLine size={15} />
                  Offline HTML ZIP
                </Button>
              </div>
            </details>
          )}
          <Link
            to={
              preview
                ? `/app/projects/${data.projectId}`
                : `/h/${publicId}/access`
            }
            className="button text"
          >
            {preview ? "Back to project" : "Verify another email"}
          </Link>
          <span className="avatar" title={session.user?.email}>
            {session.user?.email[0].toUpperCase()}
          </span>
        </div>
      </header>
      {preview && (
        <div className="local-banner">
          Owner preview of a published snapshot. Client permissions are enforced
          separately.
        </div>
      )}
      {r.version !== data.currentVersion && (
        <div className="historical-banner">
          You are viewing historical version v{r.version}.{" "}
          <a href={`/h/${publicId}`}>
            Open current version v{data.currentVersion}
          </a>
          . This page keeps the original version’s content.
        </div>
      )}
      <div className="reader-layout">
        <aside className={`reader-outline ${tocOpen ? "open" : ""}`}>
          <button
            className="icon-button reader-toc-close"
            aria-label="Close handbook contents"
            onClick={() => setTocOpen(false)}
          >
            <X size={19} />
          </button>
          <details open>
            <summary>
              <List size={17} />
              HANDBOOK CONTENTS <ChevronDown size={16} />
            </summary>
            <div className="search-input">
              <Search size={15} />
              <input
                aria-label="Search this handbook"
                placeholder="Search this handbook…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <nav>
              <a
                href="#handbook-overview"
                className={activeAnchor === "handbook-overview" ? "active" : ""}
                onClick={() => {
                  setQuery("");
                  setTocOpen(false);
                  setActiveAnchor("handbook-overview");
                }}
              >
                Overview
              </a>
              {r.snapshot.guides.map((g, i) => (
                <a
                  key={g.id}
                  href={`#guide-${g.id}`}
                  className={activeAnchor === `guide-${g.id}` ? "active" : ""}
                  onClick={() => {
                    setQuery("");
                    setTocOpen(false);
                    setActiveAnchor(`guide-${g.id}`);
                  }}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {g.title}
                </a>
              ))}
              <a
                href="#handoff-checklist"
                onClick={() => {
                  setQuery("");
                  setTocOpen(false);
                  setActiveAnchor("handoff-checklist");
                }}
              >
                Handoff checklist
              </a>
              <a
                href="#support"
                onClick={() => {
                  setQuery("");
                  setTocOpen(false);
                  setActiveAnchor("support");
                }}
              >
                Support & maintenance
              </a>
            </nav>
          </details>
          <Field label="Version">
            <select
              value={r.id}
              onChange={(e) => {
                history.pushState(
                  {},
                  "",
                  `/h/${publicId}?release=${e.target.value}`,
                );
                window.dispatchEvent(new PopStateEvent("popstate"));
                setAck(false);
              }}
            >
              {data.versions.map((v: any) => (
                <option key={v.id} value={v.id}>
                  v{v.version}
                  {v.version === data.currentVersion ? " · Current" : ""}
                </option>
              ))}
            </select>
          </Field>
          <small>Published {formatDate(r.publishedAt)}</small>
          <Logo small />
          <p className="reader-signature">Clear guides. Smooth handoffs.</p>
          <small>
            {preview ? "Preview mode" : `Signed in as ${session.user?.email}`}
          </small>
          {((!preview && data.member.download) || preview) && (
            <div className="reader-downloads">
              <Button
                kind="secondary full"
                disabled={busy}
                onClick={() => void action(async () => exportFile("pdf"))}
              >
                <FileText size={15} />
                Download PDF
              </Button>
              <Button
                kind="text full"
                disabled={busy}
                onClick={() => void action(async () => exportFile("html"))}
              >
                <ArrowDownToLine size={15} />
                Offline HTML ZIP
              </Button>
            </div>
          )}
        </aside>
        <main className="reader-body">
          <ErrorNotice error={error} />
          {message && (
            <div className="notice" role="status">
              {message}
            </div>
          )}
          <details className="reading-intro">
            <summary>How to use your handbook</summary>
            <p>
              Use the contents to find a guide. Search works within this
              version. Review the instructions and expected results, then ask
              questions where needed. Reading does not automatically confirm
              receipt.
            </p>
          </details>
          <Manual
            release={r}
            query={query}
            onQuestion={
              feedback
                ? (id) => {
                    setStepId(id);
                    setQuestion(true);
                    document
                      .getElementById("client-feedback")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }
                : undefined
            }
          />
          {!preview && (
            <section className="client-feedback" id="client-feedback">
              <h2>Questions about this version</h2>
              <p>
                All clients with feedback access to this project can see its
                questions. Do not include passwords or sensitive information.
              </p>
              {feedback && (
                <Button
                  kind="secondary"
                  onClick={() => {
                    setQuestion(!question);
                    setStepId(null);
                  }}
                >
                  <MessageSquare size={16} />
                  Ask a question
                </Button>
              )}
              {question && feedback && (
                <form
                  className="question-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await send(`/releases/${r.id}/questions`, {
                        body,
                        stepId,
                        blocking,
                      });
                      setBody("");
                      setQuestion(false);
                      setMessage("Your question is attached to this version.");
                    });
                  }}
                >
                  <Field label="Question about">
                    <select
                      value={stepId || ""}
                      onChange={(e) => setStepId(e.target.value || null)}
                    >
                      <option value="">The whole handbook</option>
                      {r.snapshot.guides.flatMap((g) =>
                        g.steps.map((s) => (
                          <option key={s.id} value={s.id}>
                            {g.title} · {s.title}
                          </option>
                        )),
                      )}
                    </select>
                  </Field>
                  <Field label="Your question">
                    <textarea
                      required
                      rows={4}
                      maxLength={2000}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />
                  </Field>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={blocking}
                      onChange={(e) => setBlocking(e.target.checked)}
                    />
                    This needs to be resolved before I can confirm receipt.
                  </label>
                  <Button type="submit" disabled={busy || !body.trim()}>
                    Submit question
                  </Button>
                </form>
              )}
              {data.questions.length === 0 ? (
                <p className="muted">No questions on this version.</p>
              ) : (
                data.questions.map((q: any) => (
                  <article className="question-card" key={q.id}>
                    <div className="action-row">
                      <Badge>{q.status}</Badge>
                      {!!q.blocking && (
                        <Badge tone="red">Blocks confirmation</Badge>
                      )}
                    </div>
                    <p>{q.body}</p>
                    {q.replies.map((v: any) => (
                      <div key={v.id} className="reply">
                        {v.body}
                      </div>
                    ))}
                    {q.resolution && (
                      <p className="resolution">Resolution: {q.resolution}</p>
                    )}
                    {q.isMine && q.status === "open" && (
                      <Button
                        kind="text"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await send(
                              `/questions/${q.id}`,
                              { status: "withdrawn" },
                              "PATCH",
                            );
                          })
                        }
                      >
                        Withdraw my question
                      </Button>
                    )}
                  </article>
                ))
              )}
            </section>
          )}
          {request && (
            <section className="receipt-section" id="version-receipt">
              <div>
                <CheckCircle2 size={25} />
                <div>
                  <p className="eyebrow">EXPLICIT VERSION RECEIPT</p>
                  <h2>
                    {confirmed
                      ? `You confirmed receipt of v${r.version}`
                      : `Confirm receipt of version v${r.version}`}
                  </h2>
                </div>
              </div>
              <p>
                {request.note ||
                  "Review the handbook and required checklist items, then confirm that you have received this specific version."}
              </p>
              {unresolved.length > 0 && (
                <div className="notice">
                  {unresolved.length} open{" "}
                  {unresolved.length === 1 ? "question" : "questions"} on this
                  version.{" "}
                  {unresolved.some((q: any) => q.blocking)
                    ? "Blocking questions must be resolved before confirmation."
                    : "Review these before confirming."}
                </div>
              )}
              <p className="hash-line">SHA-256 {r.hash}</p>
              {!confirmed && (
                <>
                  <label className="review-check">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    <span>
                      <strong>
                        I reviewed version v{r.version} and the required handoff
                        checklist.
                      </strong>
                      <small>
                        This records receipt of this version. It is not an
                        electronic contract signature or automatic contractual
                        acceptance.
                      </small>
                    </span>
                  </label>
                  <Button
                    disabled={
                      !ack || busy || unresolved.some((q: any) => q.blocking)
                    }
                    onClick={() =>
                      void action(async () => {
                        await send(
                          `/confirmation-requests/${request.id}/confirm`,
                          {
                            releaseId: r.id,
                            manifestHash: r.hash,
                            acknowledgement: true,
                            wordingVersion: "receipt-v1",
                          },
                        );
                        setMessage(
                          `Receipt of version v${r.version} recorded.`,
                        );
                      })
                    }
                  >
                    {busy
                      ? "Recording…"
                      : `Confirm receipt of version v${r.version}`}
                    <CheckCircle2 size={16} />
                  </Button>
                </>
              )}
              {confirmed && (
                <Badge tone="green">
                  Recorded {formatDate(request.confirmations[0].created_at)}
                </Badge>
              )}
            </section>
          )}
        </main>
        <aside className="reader-rail">
          {request && (
            <Panel className="receipt-rail">
              <h3>
                <CheckCircle2 size={15} />
                {confirmed
                  ? "Your receipt is recorded"
                  : "Your receipt is requested"}
              </h3>
              <p>
                Review this handbook and its checklist, then confirm receipt of{" "}
                <strong>version v{r.version}</strong>.
              </p>
              <a href="#version-receipt" className="button full">
                {confirmed ? "View receipt" : `Review & confirm v${r.version}`}
                <ArrowUpRight size={14} />
              </a>
              <small>Not a contract acceptance or electronic signature.</small>
            </Panel>
          )}
          <Panel>
            <h3>Questions about this handbook?</h3>
            <p>
              Ask in context. Questions are visible to project members with
              feedback access.
            </p>
            {feedback ? (
              <Button
                kind="secondary full"
                onClick={() => {
                  setStepId(null);
                  setQuestion(true);
                  document
                    .getElementById("client-feedback")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <MessageSquare size={15} />
                Ask a question
              </Button>
            ) : (
              <small>
                {preview
                  ? "Client permissions are enforced separately."
                  : "Read-only access. Ask the sender for feedback permission."}
              </small>
            )}
          </Panel>
          <Panel>
            <h3>What changed in v{r.version}?</h3>
            <p>{r.summary || "No change summary provided."}</p>
            <a href="#handbook-overview" className="button text">
              <History size={15} />
              Version information
            </a>
          </Panel>
          <p>
            Need help?
            <br />
            Contact your project sender.
          </p>
          {r.snapshot.supportEmail && (
            <a
              href={`mailto:${r.snapshot.supportEmail}`}
              className="support-link"
            >
              {r.snapshot.supportEmail}
            </a>
          )}
          <small>Client viewing does not mean the handoff is confirmed.</small>
        </aside>{" "}
      </div>
      {!preview && request && !confirmed && (
        <div className="reader-mobile-actions">
          {feedback && (
            <Button
              kind="secondary"
              onClick={() => {
                setStepId(null);
                setQuestion(true);
                document
                  .getElementById("client-feedback")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <MessageSquare size={14} />
              Ask a question
            </Button>
          )}
          <a href="#version-receipt" className="button">
            Review v{r.version}
            <ArrowUpRight size={14} />
          </a>
        </div>
      )}{" "}
    </div>
  );
}

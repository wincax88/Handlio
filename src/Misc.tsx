import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CreditCard,
  Download,
  Mail,
  ShieldCheck,
  Clock3,
  BookOpen,
  CircleHelp,
} from "lucide-react";
import { UsageBar } from "./Prototype";
import type { Project, Session } from "./types";
import { api, formatDate, send } from "./api";
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
} from "./ui";
export function Billing({ session }: { session: Session }) {
  const [data, setData] = useState<any>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pid, setPid] = useState(
    new URLSearchParams(location.search).get("project") || "",
  );
  const [checkout, setCheckout] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(
    new URLSearchParams(location.search).has("project"),
  );
  const tz = session.user!.settings.timezone;
  async function load() {
    setData(await api("/billing"));
    const ps = await api<Project[]>("/projects");
    setProjects(ps);
    if (!pid && ps[0]) setPid(ps[0].id);
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
  const p = projects.find((v) => v.id === pid);
  const renewal =
    p && ["paid_active", "expired_grace"].includes(p.entitlement.state);
  const amount = renewal ? 9 : 19;
  const newEnd = p
    ? Math.max(Date.now(), p.entitlement.expiresAt || 0) + 90 * 86400000
    : null;
  const active = projects.filter((p) => p.entitlement.state === "paid_active");
  const soon = (p: Project) =>
    p.entitlement.expiresAt &&
    p.entitlement.expiresAt - Date.now() < 14 * 86400000 &&
    p.entitlement.expiresAt > Date.now();
  function select(id: string) {
    setPid(id);
    setCheckout(null);
    setPurchaseOpen(true);
    requestAnimationFrame(() =>
      document
        .getElementById("project-checkout")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
  return (
    <>
      <PageHeading
        title="Billing & usage"
        description="Project-based purchases. No subscription, no automatic renewal."
        actions={
          <Link to="/app/help" className="button secondary">
            <CircleHelp size={16} />
            Request purchase review
          </Link>
        }
      />
      <ErrorNotice error={error} />
      <div className="billing-layout">
        <div>
          <section className="panel entitlement-list">
            <header className="panel-heading">
              <div>
                <h2>Project entitlements</h2>
                <small>Each purchase is assigned to one project.</small>
              </div>
              <Badge tone="green">
                {active.length} active{" "}
                {active.length === 1 ? "project pack" : "project packs"}
              </Badge>
            </header>
            {!projects.length ? (
              <Empty
                title="No project entitlements yet"
                body="Create and preview your handbook before activating a project pack."
                action={
                  <Link to="/app/projects/new" className="button">
                    Create a project <ArrowRight size={15} />
                  </Link>
                }
              />
            ) : (
              projects.map((project) => (
                <div className="entitlement-row" key={project.id}>
                  <span
                    className={`project-monogram ${soon(project) ? "shade-2" : ""}`}
                  >
                    <BookOpen size={18} />
                  </span>
                  <div>
                    <strong>{project.name}</strong>
                    <small>
                      {project.entitlement.expiresAt
                        ? `Hosting until ${formatDate(project.entitlement.expiresAt, tz)}`
                        : "Free draft · Activate when ready to share"}
                    </small>
                    <small>
                      {project.entitlement.aiRemaining} /{" "}
                      {project.entitlement.limits.ai} AI steps left · Original
                      credit window applies
                    </small>
                  </div>
                  <Badge
                    tone={
                      soon(project)
                        ? "amber"
                        : project.entitlement.state === "paid_active"
                          ? "green"
                          : "neutral"
                    }
                  >
                    {soon(project)
                      ? "Expires soon"
                      : project.entitlement.state === "paid_active"
                        ? "Active"
                        : project.entitlement.state.replace("_", " ")}
                  </Badge>
                  <Button kind="secondary" onClick={() => select(project.id)}>
                    <Clock3 size={14} />
                    {project.entitlement.state === "free"
                      ? "Activate"
                      : "Extend"}
                  </Button>
                </div>
              ))
            )}
          </section>
          {purchaseOpen && (
            <div id="project-checkout">
              <Panel
                title={
                  renewal ? "Extend project hosting" : "Activate a project pack"
                }
                actions={
                  <Button
                    kind="text"
                    onClick={() => {
                      setPurchaseOpen(false);
                      setCheckout(null);
                    }}
                  >
                    Close
                  </Button>
                }
              >
                <Field label="Client project">
                  <select
                    value={pid}
                    onChange={(e) => {
                      setPid(e.target.value);
                      setCheckout(null);
                    }}
                  >
                    <option value="">Choose a project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.clientName}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="billing-price">
                  <span>${amount}</span>
                  <div>
                    USD / {renewal ? "extension" : "project"}
                    <small>90 days · no automatic renewal</small>
                  </div>
                </div>
                <p>
                  {renewal
                    ? "Extend hosting without losing remaining days. Renewal does not replenish AI allowance or automatically restore sharing."
                    : "Make, publish, share and export this project’s handbook within the stated limits."}
                </p>
                <dl className="detail-list">
                  <div>
                    <dt>Current hosting deadline</dt>
                    <dd>{formatDate(p?.entitlement.expiresAt || null, tz)}</dd>
                  </div>
                  <div>
                    <dt>Estimated deadline if paid now</dt>
                    <dd>{formatDate(newEnd, tz)}</dd>
                  </div>
                </dl>
                <p className="muted">
                  The final period starts at verified payment time. Applicable
                  taxes are shown by the payment provider at checkout.
                </p>
                <Button
                  disabled={
                    busy ||
                    !p ||
                    ["expired", "revoked"].includes(p.entitlement.state) ||
                    p.lifecycle !== "active"
                  }
                  onClick={() =>
                    void action(async () => {
                      const c = await send("/billing/checkouts", {
                        projectId: pid,
                        product: renewal ? "renewal" : "project",
                      });
                      setCheckout(c);
                      if (c.url) location.assign(c.url);
                    })
                  }
                >
                  <CreditCard size={16} />
                  {busy
                    ? "Working…"
                    : renewal
                      ? "Continue to extension"
                      : "Continue to checkout"}
                </Button>
                {checkout?.local && (
                  <div className="local-checkout">
                    <Badge tone="amber">LOCAL PAYMENT SIMULATION</Badge>
                    <h3>No real payment will be made.</h3>
                    <p>
                      This creates a development entitlement so you can test
                      publishing, invitations, expiry and exports.
                    </p>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await send("/billing/local-confirm", {
                            orderId: checkout.orderId,
                          });
                          setCheckout(null);
                        })
                      }
                    >
                      Simulate verified ${amount} payment
                    </Button>
                  </div>
                )}
                {!session.billingEnabled && !session.localMode && (
                  <p className="muted">
                    Real payments are unavailable until a provider is
                    configured.
                  </p>
                )}
              </Panel>
            </div>
          )}
          <Panel
            title="Orders"
            actions={<small>Your project purchase history</small>}
          >
            {!data ? (
              <Loading />
            ) : !data.orders.length ? (
              <Empty
                title="No orders yet"
                body="Your project purchases and extensions will appear here."
              />
            ) : (
              <div className="billing-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order / project</th>
                      <th>Date</th>
                      <th>Paid</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map((o: any) => (
                      <tr key={o.id}>
                        <td>
                          <strong>{o.id.slice(0, 8).toUpperCase()}</strong>
                          <small>
                            {projects.find((p) => p.id === o.project_id)
                              ?.name || "Project order"}
                          </small>
                          <small>
                            {o.product === "project"
                              ? "Project pack"
                              : "Hosting extension"}
                          </small>
                        </td>
                        <td>
                          {new Intl.DateTimeFormat("en", {
                            dateStyle: "medium",
                            timeZone: tz,
                          }).format(new Date(o.created_at))}
                        </td>
                        <td>
                          <strong>
                            {new Intl.NumberFormat("en", {
                              style: "currency",
                              currency: o.currency,
                            }).format(o.amount / 100)}
                          </strong>
                          <small>
                            {o.currency} · Tax / invoice unavailable
                          </small>
                        </td>
                        <td>
                          <Badge
                            tone={
                              o.status === "paid"
                                ? "green"
                                : o.status === "refunded"
                                  ? "red"
                                  : "neutral"
                            }
                          >
                            {o.status}
                          </Badge>
                        </td>
                        <td>
                          <Link to="/app/help" className="button secondary">
                            Details / support
                          </Link>
                          {session.localMode && o.status === "paid" && (
                            <Button
                              kind="text"
                              disabled={busy}
                              onClick={() =>
                                void action(async () => {
                                  await send("/billing/local-refund", {
                                    orderId: o.id,
                                  });
                                })
                              }
                            >
                              Simulate full refund
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="billing-disclaimer">
              Real invoices and tax details come from the payment provider.
              Missing details are shown as unavailable, never invented.
            </p>
          </Panel>
        </div>
        <aside>
          {p && (
            <Panel title={`${p.name} usage`}>
              <UsageBar
                label="Storage"
                value={p.entitlement.storage / 1048576}
                max={p.entitlement.limits.storage / 1048576}
                unit=" MiB"
              />
              <UsageBar
                label="AI steps remaining"
                value={p.entitlement.aiRemaining}
                max={p.entitlement.limits.ai}
              />
              <UsageBar
                label="New exports"
                value={p.entitlement.exportsUsed}
                max={p.entitlement.limits.exports}
              />
              <p className="muted">
                AI is optional. Generation is metered when a valid result is
                returned, not when it is accepted.
              </p>
            </Panel>
          )}
          <Panel
            title={
              p?.entitlement.state === "free"
                ? "Ready to share?"
                : "Need more time?"
            }
          >
            <div className="extension-price">
              ${p?.entitlement.state === "free" ? 19 : 9}{" "}
              <span>
                {p?.entitlement.state === "free"
                  ? "/ project · 90 days"
                  : "/ 90-day extension"}
              </span>
            </div>
            <p>
              {p?.entitlement.state === "free"
                ? "Activate your project when the handbook is ready to publish and share. No automatic renewal."
                : "Extends the existing project. No additional AI credits and no automatic renewal."}
            </p>
            <Button kind="full" disabled={!p} onClick={() => p && select(p.id)}>
              <Clock3 size={16} />
              {p?.entitlement.state === "free"
                ? "Activate project"
                : "Review extension"}
            </Button>
          </Panel>
          <div className="notice">
            <ShieldCheck size={17} />
            <span>
              At expiry, clients lose online access. Owners have 30 days to read
              and export their last legal published version.
            </span>
          </div>
          <Link to="/refund" className="button text">
            Refund information <ArrowUpRight size={14} />
          </Link>
        </aside>
      </div>
    </>
  );
}
export function SettingsPage({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => Promise<void>;
}) {
  const [settings, setSettings] = useState(session.user!.settings);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="settings-page">
      <PageHeading
        eyebrow="YOUR WORKSPACE"
        title="Settings & account"
        description="Manage the defaults your projects start with and protect your account."
      />
      <ErrorNotice error={error} />
      <Panel title="Workspace defaults">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            void send("/settings", settings, "PATCH")
              .then(async () => {
                await refresh();
                setMessage("Workspace settings saved.");
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <Field label="Workspace name">
            <input
              required
              maxLength={120}
              value={settings.name}
              onChange={(e) =>
                setSettings((v) => ({ ...v, name: e.target.value }))
              }
            />
          </Field>
          <Field label="Support email">
            <input
              type="email"
              value={settings.supportEmail}
              onChange={(e) =>
                setSettings((v) => ({ ...v, supportEmail: e.target.value }))
              }
            />
          </Field>
          <Field label="Display time zone">
            <select
              value={settings.timezone}
              onChange={(e) =>
                setSettings((v) => ({ ...v, timezone: e.target.value }))
              }
            >
              {[
                "UTC",
                "Asia/Shanghai",
                "Asia/Tokyo",
                "America/New_York",
                "America/Los_Angeles",
                "Europe/London",
                "Europe/Berlin",
                "Australia/Sydney",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <label className="check-field">
            <input
              type="checkbox"
              checked={settings.expiryReminders}
              onChange={(e) =>
                setSettings((v) => ({
                  ...v,
                  expiryReminders: e.target.checked,
                }))
              }
            />
            Send optional hosting expiry reminders
          </label>
          <Button type="submit" disabled={busy}>
            Save settings
          </Button>
          {message && (
            <p role="status" className="success-text">
              {message}
            </p>
          )}
        </form>
      </Panel>
      <Panel title="Session & security">
        <dl className="detail-list">
          <div>
            <dt>Verified email</dt>
            <dd>{session.user!.email}</dd>
          </div>
          <div>
            <dt>Interface language</dt>
            <dd>English · Unicode content supported</dd>
          </div>
        </dl>
        <div className="action-row">
          <Link to="/auth?reauth=1" className="button secondary">
            Verify for sensitive actions
          </Link>
          <Button
            kind="secondary"
            onClick={async () => {
              try {
                await send("/auth/logout-others", {});
                setMessage("Other sessions signed out.");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Sign out other sessions
          </Button>
        </div>
      </Panel>
      <Panel title="Your data">
        <p>
          Use the project’s export center to download published content. Project
          deletion is available in its overview after recent email verification.
        </p>
        <p>
          For account-wide export, correction, deletion or a privacy concern,
          submit a request. You will receive a reference number and can check
          its status.
        </p>
        <Link to="/app/help" className="button secondary">
          Submit a data request <ArrowRight size={16} />
        </Link>
      </Panel>
    </div>
  );
}
export function Help({
  session,
  embedded = false,
}: {
  session: Session;
  embedded?: boolean;
}) {
  const [kind, setKind] = useState("help");
  const [email, setEmail] = useState(session.user?.email || "");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (session.user)
      void api("/support")
        .then(setRequests)
        .catch(() => {});
  }, [request]);
  const content = (
    <>
      <PageHeading
        eyebrow="A LITTLE GUIDANCE GOES A LONG WAY"
        title="Help & support"
        description="Prepare a useful handbook, resolve an access issue, or ask about your data."
      />
      <div className="help-grid">
        <div className="help-articles">
          {[
            [
              "Prepare & redact screenshots",
              "Choose static PNG, JPEG or WebP images. Review them locally for passwords, keys, personal data, balances and client secrets. Draw solid redaction boxes. Confirm each screenshot before uploading; the uploaded pixels are flattened and cannot be recovered here.",
            ],
            [
              "Create & publish a handbook",
              "Add the goal, prerequisites, audience and completion criteria for each guide. Write instructions and expected results, then mark each step reviewed. Add support details and a handoff checklist. Run the publishing check, activate your package, and publish a version.",
            ],
            [
              "Invite & verify a client",
              "Enable sharing, invite the client’s email, and choose Viewer, Reviewer or Confirmer. The client verifies the invited email using a one-time code. A forwarded invitation alone does not grant access. Invitations expire after 7 days.",
            ],
            [
              "Questions & version receipt",
              "Feedback and receipt records belong to a specific release. Resolve blocking questions before requesting or recording receipt. A new version does not inherit earlier confirmation. Receipt is not an electronic contract signature.",
            ],
            [
              "Download & offline reading",
              "Export a published version as PDF or a complete offline HTML ZIP. Extract the whole ZIP and open index.html. Online login is required to ask questions or confirm receipt. Disabling downloads cannot prevent screenshots or copies already saved.",
            ],
            [
              "Hosting, expiry & deletion",
              "The trial project price is $19 for 90 days from verified payment. Renewal is $9 for another 90 days; there is no automatic renewal and no extra AI allowance. Clients lose access at expiry. Owners retain a 30-day read and export grace window, followed by content cleanup.",
            ],
            [
              "Report a safety issue",
              "Pause sharing or use a security withdrawal in the version center. A security withdrawal isolates related images and exports. Existing downloaded files cannot be recalled. Rotate any exposed credentials through their original provider.",
            ],
          ].map(([title, text]) => (
            <details key={title}>
              <summary>{title}</summary>
              <p>{text}</p>
            </details>
          ))}
        </div>
        <Panel title="Get help or request your data">
          <ErrorNotice error={error} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              void send("/support", { email, kind, body })
                .then((r) => {
                  setRequest(r);
                  setBody("");
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <Field label="Request type">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="help">General help / link problem</option>
                <option value="privacy">
                  Data export, deletion, or correction
                </option>
                <option value="security">Safety / privacy incident</option>
                <option value="refund">Payment or refund</option>
              </select>
            </Field>
            <Field label="Your email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="What do you need help with?">
              <textarea
                rows={5}
                required
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            <p className="muted">
              Do not send passwords, verification codes, sensitive screenshots,
              or full card details.
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? "Submitting…" : "Submit request"}
            </Button>
          </form>
          {request && (
            <div className="notice" role="status">
              <span>
                Request received. Reference: <strong>{request.id}</strong>.
                Status: open. A response time has not been committed.
              </span>
            </div>
          )}
          {requests.length > 0 && (
            <div className="support-history">
              <h3>Your requests</h3>
              {requests.map((r) => (
                <p key={r.id}>
                  {r.id.slice(0, 8)} · {r.kind} · <Badge>{r.status}</Badge>
                </p>
              ))}
            </div>
          )}
          <p className="muted">Support contact: {session.supportEmail}</p>
        </Panel>
      </div>
    </>
  );
  return embedded ? (
    content
  ) : (
    <div className="public-document">
      <Back to="/">Back to Handlio</Back>
      {content}
    </div>
  );
}
export function Policy({ kind, session }: { kind: string; session: Session }) {
  const title =
    kind === "privacy"
      ? "Privacy & data handling"
      : kind === "refund"
        ? "Refunds & payment support"
        : "Service terms";
  return (
    <div className="public-document policy">
      <Back to="/">Back to Handlio</Back>
      <PageHeading eyebrow="SERVICE INFORMATION" title={title} />
      <div className="notice">
        Development policy baseline. Operator details, jurisdiction, approved
        refund rules and provider agreements must be completed before real paid
        service is enabled.
      </div>
      {kind === "privacy" ? (
        <>
          <h2>What is processed</h2>
          <p>
            Account email, session records, project text, processed screenshots,
            orders, and explicit version receipt records support the handoff
            service. Original screenshots remain in the browser during local
            preparation; only reviewed, flattened images are uploaded. No
            advertising pixels or session recording are enabled.
          </p>
          <h2>Access and sharing</h2>
          <p>
            Projects are private. Invited clients must verify their email.
            Workspace access and project client access are separate. Support
            does not receive automatic access to client content.
          </p>
          <h2>External processing</h2>
          <p>
            Email, payment and optional AI use configured providers. AI requires
            an explicit action and privacy notice before processed images are
            sent. Actual providers, retention rules, processing regions and
            contractual roles must be disclosed before using real client data.
          </p>
          <h2>Retention</h2>
          <p>
            Inactive free drafts enter cleanup after 30 days with a prior
            reminder. Paid content remains for the hosting period plus a 30-day
            owner export window. Exports last 7 days. Deleted content is cleaned
            from primary storage within 7 days. Production backups must be
            configured to expire within 35 further days and honor deletion
            tombstones. Necessary financial records are handled separately
            according to the operator’s applicable obligations.
          </p>
          <h2>Requests</h2>
          <p>
            Ask for export, correction, deletion or incident support through the
            help form. Receipt history does not override applicable data rights.
          </p>
        </>
      ) : kind === "refund" ? (
        <>
          <h2>Ask about a payment</h2>
          <p>
            Provide the order reference through the support form. Do not include
            full card information or security codes. A refund request does not
            itself mean a refund has been approved or completed.
          </p>
          <h2>Verified refund outcomes</h2>
          <p>
            Full refunds revoke the corresponding order’s entitlement. Remaining
            valid orders are recalculated rather than deleting the project
            immediately. Partial refunds and disputes require review. Existing
            downloaded files cannot be recalled.
          </p>
          <h2>Before real sales</h2>
          <p>
            The operator must publish approved refund eligibility, legal
            exceptions, contact details and provider rules for its actual market
            before real checkout is enabled. Local payment simulation makes no
            real charge.
          </p>
        </>
      ) : (
        <>
          <h2>The service</h2>
          <p>
            Handlio turns manually supplied screenshots and instructions into
            client handbooks. Published releases freeze their content. Client
            receipt records refer to an exact version and are not electronic
            contract signatures or a promise that a client has learned the
            material.
          </p>
          <h2>Project hosting</h2>
          <p>
            Trial baseline pricing is USD $19 for 90 days per project and USD $9
            for 90-day renewal, with no automatic renewal. Taxes, if applicable,
            are determined at checkout. Capacity limits are shown on the pricing
            page. Hosting starts at provider-verified payment time.
          </p>
          <h2>Your responsibilities</h2>
          <p>
            Upload only authorized content. Check and redact sensitive material
            before upload, review AI suggestions and verify instructions before
            publishing. Do not store passwords, keys or payment card data in the
            handbook.
          </p>
          <h2>Portability and limits</h2>
          <p>
            Published versions can be exported within the current allowance.
            Clients lose online access at hosting expiry; owners have a limited
            read and export grace window. Download controls cannot prevent
            screenshots or recall files already downloaded.
          </p>
        </>
      )}
      <Link to="/help" className="button">
        Contact support <ArrowUpRight size={15} />
      </Link>
    </div>
  );
}
export function Ops() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api("/ops")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="public-document">
      <Back to="/app/projects">Creator workspace</Back>
      <PageHeading
        eyebrow="METADATA ONLY"
        title="Operations diagnostics"
        description="Task and order states. Client content, screenshots, emails and receipt records are excluded."
      />
      <ErrorNotice error={error} />
      {data &&
        Object.entries(data).map(([kind, rows]) => (
          <Panel key={kind} title={kind}>
            {(rows as any[]).length === 0 ? (
              <p>No records.</p>
            ) : (
              (rows as any[]).map((row) => (
                <div className="request-row" key={row.id}>
                  <span>
                    {row.id.slice(0, 12)} ·{" "}
                    {row.type || row.kind || row.currency || kind}
                  </span>
                  <Badge>{row.state || row.status}</Badge>
                  <small>
                    {row.error ||
                      (row.amount != null
                        ? `${row.amount} minor units`
                        : `${row.attempts || 0} attempts`)}
                  </small>
                </div>
              ))
            )}
          </Panel>
        ))}
      <Link to="/auth?reauth=1" className="button secondary">
        Reverify for operations access
      </Link>
    </div>
  );
}

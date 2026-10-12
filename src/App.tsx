import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  BookOpen,
  Boxes,
  CreditCard,
  Settings,
  LifeBuoy,
  Plus,
  ArrowUpRight,
  ShieldCheck,
  LogOut,
  Search,
  LayoutGrid,
  Menu,
  X,
  ArrowRight,
  CheckCircle2,
  FileText,
  ChevronRight,
  ChevronDown,
  Folder,
  Bell,
  MessageSquare,
  Users,
  Clock3,
  ArrowDownUp,
  MoreHorizontal,
  Eye,
  Download,
  CircleHelp,
} from "lucide-react";
import { api, assetUrl, navigate, send, setCsrf } from "./api";
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
import type { Project, Session } from "./types";
import { Logo, MiniHandbook, Metric } from "./Prototype";
import { ProjectPage } from "./ProjectPage";
import { Reader } from "./Reader";
import { Billing, SettingsPage, Help, Policy, Ops } from "./Misc";
import { Onboarding } from "./Workspace";
import { PaymentPage } from "./Payment";
const defaultSession: Session = {
  user: null,
  localMode: false,
  aiEnabled: false,
  aiNotice: "",
  billingEnabled: false,
  supportEmail: "",
};
export function App() {
  const [route, setRoute] = useState(location.pathname);
  const [session, setSession] = useState<Session>(defaultSession);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function refresh() {
    try {
      const s = await api<Session>("/session");
      setSession(s);
      setCsrf(s.user?.csrf || "");
      setReady(true);
    } catch (e) {
      setError((e as Error).message);
      setReady(true);
    }
  }
  useEffect(() => {
    void refresh();
    const listener = () => setRoute(location.pathname);
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  if (!ready) return <Loading />;
  if (error)
    return (
      <div className="auth-page">
        <ErrorNotice error={error} />
        <Button
          onClick={() => {
            setError(null);
            void refresh();
          }}
        >
          Reconnect
        </Button>
      </div>
    );
  const match = /^\/app\/projects\/([^/]+)(?:\/(.*))?$/.exec(route);
  const publicId = /^\/h\/([^/]+)/.exec(route)?.[1];
  if (publicId) {
    if (route.endsWith("/access") || !session.user)
      return <Auth session={session} publicId={publicId} refresh={refresh} />;
    return <Reader publicId={publicId} session={session} />;
  }
  if (route === "/auth") return <Auth session={session} refresh={refresh} />;
  if (["/terms", "/privacy", "/refund"].includes(route))
    return <Policy kind={route.slice(1)} session={session} />;
  if (route === "/help") return <Help session={session} />;
  if (route === "/pricing") return <Landing pricing session={session} />;
  if (route === "/examples") return <Landing examples session={session} />;
  if (route === "/ops")
    return session.user ? (
      <Ops />
    ) : (
      <Auth session={session} refresh={refresh} />
    );
  if (!route.startsWith("/app")) return <Landing session={session} />;
  if (!session.user?.workspaceId)
    return <Auth session={session} refresh={refresh} />;
  if (!session.user.settings.onboardingComplete || route === "/app/onboarding")
    return <Onboarding session={session} refresh={refresh} />;
  return (
    <Shell session={session} route={route} refresh={refresh}>
      {route.startsWith("/app/payment/") ? (
        <PaymentPage orderId={route.split("/")[3]} session={session} />
      ) : route === "/app/examples" ? (
        <Examples session={session} />
      ) : route === "/app/billing" ? (
        <Billing session={session} />
      ) : route === "/app/settings" ? (
        <SettingsPage session={session} refresh={refresh} />
      ) : route === "/app/help" ? (
        <Help session={session} embedded />
      ) : route === "/app/projects/new" ? (
        <NewProject />
      ) : match ? (
        <ProjectPage
          key={match[1]}
          id={match[1]}
          tab={match[2] || "overview"}
          session={session}
        />
      ) : (
        <Projects session={session} />
      )}
    </Shell>
  );
}
function Brand() {
  return <Logo />;
}
function Shell({
  children,
  session,
  route,
  refresh,
}: {
  children: ReactNode;
  session: Session;
  route: string;
  refresh: () => Promise<void>;
}) {
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState("");
  const [notifications, setNotifications] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const user = session.user!;
  useEffect(() => {
    void api<Project[]>("/projects")
      .then(setProjects)
      .catch(() => {});
    setMobile(false);
    setQuery("");
    setNotifications(false);
  }, [route]);
  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setQuery("");
        setNotifications(false);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);
  const editor = route.includes("/guides");
  const navigation = [
    { label: "Projects", url: "/app/projects" },
    { label: "Examples", url: "/app/examples" },
    { label: "Billing & usage", url: "/app/billing" },
    { label: "Settings", url: "/app/settings" },
    { label: "Help center", url: "/app/help" },
    ...projects.map((p) => ({ label: p.name, url: `/app/projects/${p.id}` })),
  ];
  const pending = projects.filter(
    (p) =>
      p.confirmation &&
      ["pending", "in_progress"].includes(p.confirmation.status),
  );
  const questionProjects = projects.filter((p) => p.openQuestions > 0);
  const project = projects.find((p) => route.includes(p.id));
  const crumb = editor
    ? "Guide editor"
    : project?.name ||
      (route.includes("/billing")
        ? "Billing & usage"
        : route.includes("/settings")
          ? "Settings"
          : route.includes("/examples")
            ? "Examples"
            : route.includes("/help")
              ? "Help center"
              : "Projects");
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Brand />
        <div className="workspace-switch">
          <span className="workspace-avatar">
            {user.settings.logoId ? (
              <img src={assetUrl(user.settings.logoId)} alt="Workspace logo" />
            ) : (
              user.settings.name
                .split(/\s+/)
                .map((v) => v[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()
            )}
          </span>
          <div>
            <strong>{user.settings.name}</strong>
            <small>Personal workspace</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          <Link
            to="/app/projects"
            className={route.includes("/projects") ? "active" : ""}
          >
            <LayoutGrid size={18} />
            Projects<span className="nav-count">{projects.length}</span>
          </Link>
          <Link
            to="/app/examples"
            className={route.includes("/examples") ? "active" : ""}
          >
            <BookOpen size={18} />
            Examples
          </Link>
          <Link
            to="/app/billing"
            className={route.includes("/billing") ? "active" : ""}
          >
            <CreditCard size={18} />
            Billing & usage
          </Link>
        </nav>
        <p className="nav-label manage-label">MANAGE</p>
        <nav>
          <Link
            to="/app/settings"
            className={route.includes("/settings") ? "active" : ""}
          >
            <Settings size={18} />
            Settings
          </Link>
          <Link
            to="/app/help"
            className={route.includes("/help") ? "active" : ""}
          >
            <CircleHelp size={18} />
            Help center
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div>
              <BookOpen size={17} />
              <strong>A clearer handoff</strong>
            </div>
            <p>
              Start with a complete example.
              <br />
              Make it your own.
            </p>
            <Link to="/app/examples">
              Explore examples <ArrowRight size={15} />
            </Link>
          </div>
          <div className="user-line">
            <span className="avatar">
              {user.email
                .split(/[^a-zA-Z]+/)
                .map((v) => v[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
            <Link to="/app/settings">
              <strong>
                {user.settings.displayName || user.email.split("@")[0]}
              </strong>
              <small>Workspace owner</small>
            </Link>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                await send("/auth/logout", {});
                await refresh();
                navigate("/");
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <div className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="topbar-breadcrumb">
            <Folder size={16} />
            <Link to="/app/projects">Workspace</Link>
            <ChevronRight size={13} />
            <span>{crumb}</span>
          </div>
          <div className="topbar-tools">
            <div className="workspace-search">
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="Search workspace"
                placeholder="Search anything…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <div className="search-results">
                  {navigation
                    .filter((n) =>
                      n.label.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((n) => (
                      <Link key={n.url} to={n.url}>
                        <span>{n.label}</span>
                        <ArrowUpRight size={14} />
                      </Link>
                    ))}
                  {!navigation.some((n) =>
                    n.label.toLowerCase().includes(query.toLowerCase()),
                  ) && <p>No matching pages or projects.</p>}
                </div>
              )}
            </div>
            <Badge>
              {session.localMode ? "Local workspace" : "Private workspace"}
            </Badge>
            <div className="notifications-control">
              <button
                className="icon-button"
                aria-label="Notifications"
                aria-expanded={notifications}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={18} />
                {pending.length + questionProjects.length > 0 && <i />}
              </button>
              {notifications && (
                <div className="notifications-panel">
                  <h3>Needs your attention</h3>
                  {questionProjects.map((p) => (
                    <Link
                      key={`q-${p.id}`}
                      to={`/app/projects/${p.id}/handoff`}
                    >
                      <MessageSquare size={16} />
                      <span>
                        {p.openQuestions} open{" "}
                        {p.openQuestions === 1 ? "question" : "questions"}
                        <small>{p.name}</small>
                      </span>
                    </Link>
                  ))}
                  {pending.map((p) => (
                    <Link
                      key={`r-${p.id}`}
                      to={`/app/projects/${p.id}/handoff`}
                    >
                      <Users size={16} />
                      <span>
                        A version receipt is pending<small>{p.name}</small>
                      </span>
                    </Link>
                  ))}
                  {pending.length + questionProjects.length === 0 && (
                    <p>
                      You’re all caught up. No pending handoffs or questions.
                    </p>
                  )}
                </div>
              )}
            </div>
            <Link to="/app/settings" className="avatar" title={user.email}>
              {user.email[0].toUpperCase()}
            </Link>
          </div>
        </div>
        {session.localMode && (
          <div className="local-banner">
            Local development · Email codes and payment simulation are available
            for testing. No real charge is made.
          </div>
        )}
        <main
          className={`workspace-content ${editor ? "editor-workspace" : ""}`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
function Landing({
  session,
  pricing = false,
  examples = false,
}: {
  session: Session;
  pricing?: boolean;
  examples?: boolean;
}) {
  const target = session.user?.workspaceId ? "/app/projects" : "/auth";
  return (
    <div className="marketing">
      <header className="marketing-nav">
        <Brand />
        <nav>
          <Link to="/">Product</Link>
          <Link to="/examples">Examples</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/help">Help center</Link>
        </nav>
        <div className="marketing-nav-actions">
          <Link to={target} className="button text">
            {session.user?.workspaceId ? "Workspace" : "Log in"}
          </Link>
          <Link to={target} className="button">
            {session.user?.workspaceId
              ? "Open workspace"
              : "Start a free draft"}
            <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <main>
        {pricing ? (
          <div className="pricing-page">
            <div className="public-page-heading">
              <p className="eyebrow">SIMPLE, PROJECT-BASED PRICING</p>
              <h1>One project. A clear handoff.</h1>
              <p>
                Create your handbook free. Pay when it is ready to share.
                <br />
                No subscription and no automatic renewal.
              </p>
            </div>
            <div className="price-comparison">
              <section>
                <h3>Free draft</h3>
                <h2>
                  $0<span>Make and preview your handbook</span>
                </h2>
                <p>Start with the complete editing workflow.</p>
                <ul>
                  <li>1 free draft project</li>
                  <li>3 guides · 20 steps · 100 MiB storage</li>
                  <li>10 optional AI steps per workspace</li>
                  <li>Private owner preview</li>
                  <li>No client sharing or formal exports</li>
                  <li>Cleanup after 30 inactive days</li>
                </ul>
                <Link to={target} className="button secondary full">
                  Start a free draft <ArrowRight size={16} />
                </Link>
              </section>
              <section className="featured">
                <Badge tone="green">Ready to hand off</Badge>
                <h3>Project pack</h3>
                <h2>
                  $19<span>USD / project · 90 days</span>
                </h2>
                <p>A complete client-ready deliverable.</p>
                <ul>
                  <li>10 guides · 200 steps · 1 GiB storage</li>
                  <li>300 AI steps, valid for 90 days</li>
                  <li>Up to 50 invited clients</li>
                  <li>Version-specific questions and receipts</li>
                  <li>PDF and complete offline HTML ZIP</li>
                  <li>200 new exports / period · 10 / day</li>
                  <li>30-day owner read and export grace window</li>
                </ul>
                <Link to={target} className="button full">
                  Create your handbook <ArrowRight size={16} />
                </Link>
                <small>
                  Trial pricing. Taxes, if applicable, appear at checkout. Real
                  billing requires provider setup.
                </small>
              </section>
              <section>
                <h3>Hosting extension</h3>
                <h2>
                  $9<span>USD / existing project · 90 more days</span>
                </h2>
                <p>Keep an existing handoff available for longer.</p>
                <ul>
                  <li>Keep remaining hosting days</li>
                  <li>New export allowance when the period starts</li>
                  <li>No additional AI credits</li>
                  <li>No automatic renewal</li>
                  <li>Share again when you’re ready</li>
                </ul>
                <Link
                  to={session.user?.workspaceId ? "/app/billing" : "/auth"}
                  className="button secondary full"
                >
                  Review your hosting <ArrowRight size={16} />
                </Link>
              </section>
            </div>
          </div>
        ) : examples ? (
          <Examples session={session} />
        ) : (
          <>
            <section className="landing-hero">
              <div>
                <Badge tone="green">
                  <span className="status-dot" />
                  Client handoffs, thoughtfully organized
                </Badge>
                <h1>
                  Great work deserves
                  <br />a <em>clear handoff.</em>
                </h1>
                <p className="lead">
                  Turn your screenshots into a client-ready handbook. Share
                  privately, answer questions, and confirm the exact version.
                </p>
                <div className="hero-actions">
                  <Link to={target} className="button large">
                    <ArrowRight size={17} />
                    Create your first handbook
                  </Link>
                  <Link to="/examples" className="button secondary large">
                    <Eye size={17} />
                    Explore an example
                  </Link>
                </div>
                <div className="hero-benefits">
                  <span>✓ No card to start</span>
                  <span>✓ Yours to export</span>
                  <span>✓ AI is optional</span>
                </div>
              </div>
              <MiniHandbook />
            </section>
            <section className="landing-process">
              <div className="section-title-centered">
                <p className="eyebrow">FROM SCREENSHOTS TO HANDOFF</p>
                <h2>A little structure. A much better handoff.</h2>
              </div>
              <div className="grid3">
                {[
                  {
                    title: "Capture what matters",
                    body: "Bring your screenshots. Review sensitive details before uploading.",
                  },
                  {
                    title: "Make the steps clear",
                    body: "Add context, expected results and a simple handoff checklist.",
                  },
                  {
                    title: "Share the right version",
                    body: "Invite your clients, resolve questions and collect a version-specific receipt.",
                  },
                ].map((v, i) => (
                  <article className="howcard" key={v.title}>
                    <span className="stepbubble">{i + 1}</span>
                    <h3>{v.title}</h3>
                    <p>{v.body}</p>
                  </article>
                ))}
              </div>
            </section>
            <div className="home-bottom">
              <article>
                <ShieldCheck size={25} />
                <div>
                  <h3>Made for client work</h3>
                  <p>
                    Private invitations. Separate projects. No anonymous public
                    links.
                  </p>
                </div>
              </article>
              <article>
                <Download size={25} />
                <div>
                  <h3>Hand over a real deliverable</h3>
                  <p>A readable PDF and a complete offline HTML package.</p>
                </div>
              </article>
            </div>
            <p className="marketing-fineprint">
              Illustrative handbook uses a fictional client. Receipt
              confirmation is a workflow record, not a contract acceptance or
              electronic signature.
            </p>
          </>
        )}
      </main>
      <footer className="marketing-footer">
        <Brand />
        <span>Clear guides. Smooth handoffs.</span>
        <div>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/refund">Refunds</Link>
          <Link to="/help">Contact</Link>
        </div>
      </footer>
    </div>
  );
}
function Examples({ session }: { session: Session }) {
  return (
    <div className="examples-page">
      <div className="public-page-heading">
        <p className="eyebrow">A USEFUL STARTING POINT</p>
        <h1>See what a clear handoff looks like.</h1>
        <p>
          Start with a complete structure, then make it your own.
          <br />
          All example content is fictional.
        </p>
      </div>
      <div className="example-grid">
        <article className="example-card">
          <MiniHandbook />
          <div>
            <Badge tone="green">Website handoff</Badge>
            <h2>Website operations handbook</h2>
            <p>
              Getting started, content updates, media management, a handoff
              checklist and support.
            </p>
            <Link
              to={
                session.user?.workspaceId
                  ? "/app/projects/new?template=website"
                  : "/auth"
              }
              className="button"
            >
              Use a website starter <ArrowRight size={16} />
            </Link>
            <a href="/samples/index.html" className="button secondary">
              Open sample handbook
            </a>
          </div>
        </article>
        <article className="example-card">
          <div className="software-example">
            <Boxes size={30} />
            <h3>
              Your everyday workflows,
              <br />
              clearly explained.
            </h3>
            <div>
              <span>01</span>Getting started
            </div>
            <div>
              <span>02</span>Everyday workflows
            </div>
            <div>
              <span>03</span>Administration & support
            </div>
          </div>
          <div>
            <Badge>Software implementation</Badge>
            <h2>Software implementation handoff</h2>
            <p>
              A practical structure for setup, roles, recurring tasks,
              completion criteria and ongoing support.
            </p>
            <Link
              to={
                session.user?.workspaceId
                  ? "/app/projects/new?template=software"
                  : "/auth"
              }
              className="button secondary"
            >
              Use a software starter <ArrowRight size={16} />
            </Link>
          </div>
        </article>
      </div>
      <Panel title="See what leaves the platform">
        <p>
          A fictional Northstar version 2 handbook. These files contain sample
          content only.
        </p>
        <div className="action-row">
          <a
            className="button secondary"
            href="/samples/Northstar_v2_SAMPLE.pdf"
            download
          >
            Sample PDF
          </a>
          <a
            className="button secondary"
            href="/samples/Northstar_v2_OFFLINE_SAMPLE.zip"
            download
          >
            Offline HTML ZIP
          </a>
          <Link
            to={
              session.user?.workspaceId
                ? "/app/projects/new?template=blank"
                : "/auth"
            }
            className="button text"
          >
            Start from blank
          </Link>
        </div>
      </Panel>
      <div className="notice">
        <ShieldCheck size={17} />
        <span>
          Template copies stay independent. No clients, access permissions,
          orders or receipt records are copied.
        </span>
      </div>
    </div>
  );
}
function Auth({
  session,
  publicId,
  refresh,
}: {
  session: Session;
  publicId?: string;
  refresh: () => Promise<void>;
}) {
  const purpose = new URLSearchParams(location.search).get("reauth")
    ? "reauth"
    : publicId
      ? "client"
      : "owner";
  const [email, setEmail] = useState(
    purpose === "reauth" ? session.user?.email || "" : "",
  );
  const [challenge, setChallenge] = useState<any>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () =>
        setCountdown(
          Math.max(0, 60 - Math.floor((Date.now() - sentAt) / 1000)),
        ),
      1000,
    );
    return () => clearInterval(t);
  }, [sentAt]);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (!challenge) {
        setChallenge(
          await send("/auth/challenges", {
            email,
            purpose,
            publicId: publicId || "",
            invite: new URLSearchParams(location.search).get("invite") || "",
          }),
        );
        setSentAt(Date.now());
        setCountdown(60);
      } else {
        await send("/auth/verify", {
          challengeId: challenge.challengeId,
          code,
          purpose,
        });
        await refresh();
        navigate(
          publicId
            ? `/h/${publicId}`
            : purpose === "reauth"
              ? "/app/settings"
              : "/app/projects",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <aside className="auth-brand-panel">
        <Brand />
        <div>
          <p className="eyebrow">CLEAR GUIDES. SMOOTH HANDOFFS.</p>
          <h1>
            Less explaining.
            <br />
            More confidence.
          </h1>
          <p>
            Give your client one thoughtful place for the steps, the answers,
            and the version that matters.
          </p>
          <div className="auth-example">
            <div>
              <strong>Northstar website handoff</strong>
              <Badge tone="green">v2</Badge>
            </div>
            {[
              {
                icon: CheckCircle2,
                title: "Handbook published",
                body: "Clear steps, thoughtfully organized",
              },
              {
                icon: Users,
                title: "Client access verified",
                body: "Private, project-specific invitations",
              },
              {
                icon: CheckCircle2,
                title: "Receipt requested",
                body: "Bound to this exact version",
              },
            ].map((v) => (
              <article key={v.title}>
                <v.icon size={18} />
                <div>
                  <strong>{v.title}</strong>
                  <small>{v.body}</small>
                </div>
              </article>
            ))}
          </div>
        </div>
        <small>Illustrative project · No real client information</small>
      </aside>
      <main className="auth-body">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          <Badge tone="green">
            <ShieldCheck size={14} />
            {publicId
              ? "Private client handoff"
              : purpose === "reauth"
                ? "Secure verification"
                : "Your creator workspace"}
          </Badge>
          <h1>
            {purpose === "reauth"
              ? "Verify this session"
              : challenge
                ? "Check your inbox."
                : publicId
                  ? "Your handoff starts here."
                  : "Welcome to Handlio."}
          </h1>
          <p>
            {challenge
              ? `We sent a six-digit code to ${email}. Enter it below to continue.`
              : publicId
                ? "Verify the email that received your invitation to view your private handbook."
                : "Create an account or sign in with your email. No password to remember."}
          </p>
          <ErrorNotice error={error} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {!challenge ? (
              <Field label="Email address">
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourstudio.com"
                />
              </Field>
            ) : (
              <Field label="Verification code">
                <input
                  className="code-input"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                />
              </Field>
            )}
            {challenge?.devCode && (
              <div className="notice">
                <span>
                  Local development code: <strong>{challenge.devCode}</strong>.
                  No email was sent unless SMTP is configured.
                </span>
              </div>
            )}
            <Button type="submit" disabled={busy} kind="full">
              {busy
                ? "Please wait…"
                : challenge
                  ? "Verify email"
                  : "Send verification code"}
              <ArrowRight size={16} />
            </Button>
          </form>
          {challenge && (
            <Button
              kind="text full"
              disabled={countdown > 0 || busy}
              onClick={() => {
                setChallenge(null);
                setCode("");
              }}
            >
              {countdown > 0
                ? `Request another code in ${countdown}s`
                : "Use another email or request a new code"}
            </Button>
          )}
          <div className="auth-divider">PRIVATE BY DESIGN</div>
          <p className="auth-footnote">
            <ShieldCheck size={15} />
            <span>
              {publicId
                ? "Only verified, invited emails can access this handbook."
                : "Your workspace is private. Clients only see the projects you share with them."}
            </span>
          </p>
          <Link to="/help" className="back">
            Need help accessing a handoff?
          </Link>
        </div>
      </main>
    </div>
  );
}
function Projects({ session }: { session: Session }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [lifecycleFilter, setLifecycleFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [receiptFilter, setReceiptFilter] = useState("all");
  const [storageFilter, setStorageFilter] = useState(false);
  const [sort, setSort] = useState("updated");
  const tz = session.user!.settings.timezone;
  const soon = (p: Project) =>
    p.entitlement.expiresAt != null &&
    p.entitlement.expiresAt > Date.now() &&
    p.entitlement.expiresAt - Date.now() <= 14 * 86400000;
  const pending = (p: Project) =>
    p.confirmation &&
    ["pending", "in_progress"].includes(p.confirmation.status);
  useEffect(() => {
    api<Project[]>("/projects")
      .then(setProjects)
      .catch((e) => setError(e.message));
  }, []);
  const filtered = projects
    ?.filter(
      (p) =>
        (p.name + " " + p.clientName)
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "all" ||
          (filter === "archived" && p.lifecycle === "archived") ||
          (filter === "draft" && !p.currentRelease) ||
          (filter === "published" && !!p.currentRelease) ||
          (filter === "pending" && pending(p)) ||
          (filter === "soon" && soon(p))) &&
        (lifecycleFilter === "all" || p.lifecycle === lifecycleFilter) &&
        (planFilter === "all" ||
          (planFilter === "free"
            ? p.entitlement.state === "free"
            : planFilter === "paid"
              ? p.entitlement.state === "paid_active"
              : p.entitlement.state === "expired_grace")) &&
        (receiptFilter === "all" ||
          (receiptFilter === "none"
            ? !p.confirmation
            : receiptFilter === "confirmed"
              ? p.confirmation?.status === "confirmed"
              : pending(p))) &&
        (!storageFilter ||
          p.entitlement.storage >= p.entitlement.limits.storage * 0.8),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  const expiring = projects?.filter(soon) || [];
  const needs =
    projects?.filter((p) => p.openQuestions > 0 || pending(p) || soon(p)) || [];
  return (
    <>
      <PageHeading
        title="Your next handoff, made clear."
        description="Manage what is published, what needs attention, and what your clients have received."
        actions={
          <Link to="/app/projects/new" className="button">
            <Plus size={17} />
            New project
          </Link>
        }
      />
      <ErrorNotice error={error} />
      {!projects ? (
        <Loading />
      ) : (
        <>
          <div className="workspace-summary">
            <Metric
              label="Active projects"
              value={projects.filter((p) => p.lifecycle === "active").length}
              note={`${projects.filter((p) => p.currentRelease).length} published · ${projects.filter((p) => !p.currentRelease).length} draft`}
              icon={Folder}
            />
            <Metric
              label="Awaiting receipt"
              value={projects.filter(pending).length}
              note="Current version requests only"
              icon={Users}
            />
            <Metric
              label="Open questions"
              value={projects.reduce((n, p) => n + p.openQuestions, 0)}
              note="Questions across your projects"
              icon={MessageSquare}
            />
            <Metric
              label="Expiring soon"
              value={expiring.length}
              note="Within the next 14 days"
              icon={Clock3}
            />
          </div>
          {expiring.length > 0 && (
            <div className="expiry-alert">
              <Clock3 size={18} />
              <div>
                <strong>
                  {expiring[0].name} expires{" "}
                  {new Intl.DateTimeFormat("en", {
                    month: "long",
                    day: "numeric",
                    timeZone: tz,
                  }).format(new Date(expiring[0].entitlement.expiresAt!))}
                  .
                </strong>
                <p>
                  Extend hosting or export your deliverables. Client access
                  stops at expiry.
                </p>
              </div>
              <Link
                to={`/app/billing?project=${expiring[0].id}`}
                className="button secondary"
              >
                <ArrowRight size={15} />
                Review hosting
              </Link>
            </div>
          )}
          <div className="projects-card">
            <details className="advanced-filters">
              <summary>More filters</summary>
              <div className="form-grid">
                <Field label="Project lifecycle">
                  <select
                    value={lifecycleFilter}
                    onChange={(e) => setLifecycleFilter(e.target.value)}
                  >
                    <option value="all">All lifecycles</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </Field>
                <Field label="Project plan">
                  <select
                    value={planFilter}
                    onChange={(e) => setPlanFilter(e.target.value)}
                  >
                    <option value="all">All plans</option>
                    <option value="free">Free draft</option>
                    <option value="paid">Active project pack</option>
                    <option value="grace">Owner export window</option>
                  </select>
                </Field>
                <Field label="Receipt status">
                  <select
                    value={receiptFilter}
                    onChange={(e) => setReceiptFilter(e.target.value)}
                  >
                    <option value="all">All receipt states</option>
                    <option value="none">Not requested</option>
                    <option value="pending">Awaiting receipt</option>
                    <option value="confirmed">Confirmed</option>
                  </select>
                </Field>
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={storageFilter}
                  onChange={(e) => setStorageFilter(e.target.checked)}
                />
                Storage at 80% or above
              </label>
              <Button
                kind="text"
                onClick={() => {
                  setLifecycleFilter("all");
                  setPlanFilter("all");
                  setReceiptFilter("all");
                  setStorageFilter(false);
                  setFilter("all");
                }}
              >
                Reset filters
              </Button>
            </details>
            <div className="list-toolbar">
              <div className="search-input">
                <Search size={16} />
                <input
                  aria-label="Search projects"
                  placeholder="Search projects or clients…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="project-list-controls">
                <select
                  aria-label="Filter projects"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All projects</option>
                  <option value="draft">Drafts</option>
                  <option value="pending">Awaiting receipt</option>
                  <option value="soon">Expiring soon</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
                <Button
                  kind="secondary"
                  onClick={() =>
                    setSort(sort === "updated" ? "name" : "updated")
                  }
                >
                  <ArrowDownUp size={15} />
                  {sort === "updated" ? "Last updated" : "Project name"}
                </Button>
              </div>
            </div>
            {!filtered?.length ? (
              <Empty
                title={
                  search
                    ? "No matching projects"
                    : "Your next great handoff starts here."
                }
                body={
                  search
                    ? "Try a different project or client name."
                    : "Create a project, choose a structure, and turn your instructions into something your client can use."
                }
                icon={<BookOpen size={30} />}
                action={
                  !search ? (
                    <Link to="/app/projects/new" className="button">
                      Create your first project <ArrowRight size={16} />
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <div className="project-table-wrap">
                <table className="projects-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Release</th>
                      <th>Client receipt</th>
                      <th>Questions</th>
                      <th>Hosting ends</th>
                      <th>
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => (
                      <tr key={p.id}>
                        <td>
                          <Link
                            to={`/app/projects/${p.id}`}
                            className="project-cell"
                          >
                            <span className={`project-monogram shade-${i % 3}`}>
                              <BookOpen size={18} />
                            </span>
                            <div>
                              <strong>{p.name}</strong>
                              <small>{p.clientName}</small>
                            </div>
                          </Link>
                        </td>
                        <td>
                          <Badge tone={p.currentRelease ? "green" : "neutral"}>
                            <span className="status-dot" />
                            {p.currentRelease
                              ? `v${p.currentRelease.version} published`
                              : "Draft"}
                          </Badge>
                          {p.lifecycle === "archived" && (
                            <small>Archived</small>
                          )}
                        </td>
                        <td>
                          <span>
                            {p.confirmation
                              ? `${p.confirmation.confirmations.length} of ${p.confirmation.required.length} received`
                              : "Not requested"}
                          </span>
                          <small>
                            {p.currentRelease
                              ? "Current version only"
                              : "No release yet"}
                          </small>
                        </td>
                        <td>
                          <Link
                            to={`/app/projects/${p.id}/handoff`}
                            className={p.openQuestions ? "accent-link" : ""}
                          >
                            {p.openQuestions
                              ? `${p.openQuestions} open`
                              : "No open issues"}
                          </Link>
                        </td>
                        <td>
                          {p.entitlement.expiresAt ? (
                            <>
                              <span className={soon(p) ? "warning-text" : ""}>
                                {new Intl.DateTimeFormat("en", {
                                  dateStyle: "medium",
                                  timeZone: tz,
                                }).format(new Date(p.entitlement.expiresAt))}
                              </span>
                              <small>
                                {soon(p)
                                  ? `${Math.ceil((p.entitlement.expiresAt - Date.now()) / 86400000)} days remaining`
                                  : "Not auto-renewing"}
                              </small>
                            </>
                          ) : (
                            <>
                              <span>Free draft</span>
                              <small>No hosting period yet</small>
                            </>
                          )}
                        </td>
                        <td>
                          <details className="project-actions-menu">
                            <summary aria-label={`Actions for ${p.name}`}>
                              <MoreHorizontal size={18} />
                            </summary>
                            <div>
                              <Link to={`/app/projects/${p.id}`}>
                                Open project
                              </Link>
                              <Link to={`/app/projects/${p.id}/guides`}>
                                Edit guides
                              </Link>
                              <Link to={`/app/projects/${p.id}/exports`}>
                                Export handbook
                              </Link>
                              <Link to={`/app/billing?project=${p.id}`}>
                                Manage hosting
                              </Link>
                            </div>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="project-table-footer">
              <span>
                {filtered?.length || 0}{" "}
                {filtered?.length === 1 ? "project" : "projects"} · Each project
                has its own access and hosting.
              </span>
              <span>
                {filtered?.length
                  ? `1–${filtered.length} of ${filtered.length}`
                  : "No projects to display"}
              </span>
            </div>
          </div>
          <div className="project-list-bottom">
            <Panel
              title="Needs your attention"
              actions={
                <Badge>
                  {needs.length} {needs.length === 1 ? "project" : "projects"}
                </Badge>
              }
            >
              {needs.length === 0 ? (
                <p>
                  You’re all caught up. Pending receipts, questions and hosting
                  reminders will appear here.
                </p>
              ) : (
                needs.slice(0, 4).map((p) => (
                  <Link
                    className="attention-row"
                    key={p.id}
                    to={
                      soon(p)
                        ? `/app/billing?project=${p.id}`
                        : `/app/projects/${p.id}/handoff`
                    }
                  >
                    <span>
                      {p.openQuestions ? (
                        <MessageSquare size={17} />
                      ) : pending(p) ? (
                        <Users size={17} />
                      ) : (
                        <Clock3 size={17} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {p.openQuestions
                          ? `${p.openQuestions} ${p.openQuestions === 1 ? "question needs" : "questions need"} a response`
                          : pending(p)
                            ? "A client receipt is still pending"
                            : "A hosting period is ending soon"}
                      </strong>
                      <small>
                        {p.name}
                        {p.currentRelease
                          ? ` · v${p.currentRelease.version}`
                          : ""}
                      </small>
                    </div>
                    <ChevronRight size={15} />
                  </Link>
                ))
              )}
            </Panel>
            <Panel title="A useful starting point">
              <p>
                A complete website handoff structure, without the blank-page
                feeling.
              </p>
              <div className="starter-preview">
                <FileText size={23} />
                <div>
                  <strong>Website operations handbook</strong>
                  <small>Getting started · Everyday tasks · Support</small>
                </div>
              </div>
              <div className="starter-footer">
                <small>Copies stay independent.</small>
                <Link to="/app/projects/new" className="button secondary">
                  Use a starter <ArrowRight size={15} />
                </Link>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
function NewProject() {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState(() => {
    const value = new URLSearchParams(location.search).get("template");
    return value && ["website", "software", "blank"].includes(value)
      ? value
      : "website";
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const p = await send("/projects", {
        name,
        clientName,
        title: title || `${name} handbook`,
        template,
      });
      navigate(`/app/projects/${p.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="new-project">
      <Back to="/app/projects">All projects</Back>
      <PageHeading
        eyebrow="A FRESH START"
        title="Create a client project"
        description="One project, one handbook. Start with a useful structure and make it your own."
      />
      <ErrorNotice error={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Panel title="The essentials">
          <div className="form-grid">
            <Field label="Project name">
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Website launch"
              />
            </Field>
            <Field label="Client name">
              <input
                required
                maxLength={120}
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Harbor Studio"
              />
            </Field>
          </div>
          <Field label="Handbook title">
            <input
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                name
                  ? `${name} handbook`
                  : "Your client’s guide to their new website"
              }
            />
          </Field>
        </Panel>
        <section className="template-section">
          <h2>Choose a starting point</h2>
          <p>
            Templates provide a structure. You supply the actual instructions.
          </p>
          <div className="template-options">
            {[
              {
                id: "website",
                icon: Boxes,
                title: "Website handoff",
                body: "Getting started, content management, publishing and maintenance.",
              },
              {
                id: "software",
                icon: BookOpen,
                title: "Software implementation",
                body: "Setup, everyday workflows, administration and support.",
              },
              {
                id: "blank",
                icon: FileText,
                title: "A blank canvas",
                body: "Build a focused handbook around your own delivery.",
              },
            ].map((t) => (
              <button
                type="button"
                key={t.id}
                className={`template-option ${template === t.id ? "selected" : ""}`}
                onClick={() => setTemplate(t.id)}
              >
                <t.icon size={25} />
                <strong>{t.title}</strong>
                <p>{t.body}</p>
                <span className="selection-indicator">
                  {template === t.id ? <CheckCircle2 size={19} /> : <span />}
                </span>
              </button>
            ))}
          </div>
        </section>
        <div className="form-footer">
          <span>Free draft · 3 guides · 20 steps</span>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create project"}
            <ArrowRight size={17} />
          </Button>
        </div>
      </form>
    </div>
  );
}

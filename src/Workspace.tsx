import { useEffect, useState } from "react";
import type { Session } from "./types";
import { api, assetUrl, formatDate, navigate, send } from "./api";
import {
  Badge,
  Button,
  ErrorNotice,
  Field,
  Link,
  PageHeading,
  Panel,
} from "./ui";
import { Logo } from "./Prototype";

export const timeZones = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
];
export function WorkspaceForm({
  session,
  refresh,
  onboarding = false,
}: {
  session: Session;
  refresh: () => Promise<void>;
  onboarding?: boolean;
}) {
  const [settings, setSettings] = useState(session.user!.settings);
  const [assets, setAssets] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!onboarding)
      void api("/workspace/assets")
        .then(setAssets)
        .catch((e) => setError(e.message));
  }, []);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await send(
            "/settings",
            { ...settings, onboardingComplete: true },
            "PATCH",
          );
          await refresh();
          setMessage("Workspace settings saved.");
          if (onboarding) navigate("/app/projects");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorNotice error={error} />
      <div className="form-grid">
        <Field label="Your display name">
          <input
            required={onboarding}
            maxLength={120}
            value={settings.displayName}
            onChange={(e) =>
              setSettings({ ...settings, displayName: e.target.value })
            }
            autoComplete="name"
          />
        </Field>
        <Field label="Workspace name">
          <input
            required
            maxLength={120}
            value={settings.name}
            onChange={(e) => setSettings({ ...settings, name: e.target.value })}
          />
        </Field>
        <Field label="Support email">
          <input
            type="email"
            required={onboarding}
            value={settings.supportEmail}
            onChange={(e) =>
              setSettings({ ...settings, supportEmail: e.target.value })
            }
          />
        </Field>
        <Field label="Display time zone">
          <select
            value={settings.timezone}
            onChange={(e) =>
              setSettings({ ...settings, timezone: e.target.value })
            }
          >
            {[...new Set([...timeZones, settings.timezone])].map((zone) => (
              <option key={zone}>{zone}</option>
            ))}
          </select>
        </Field>
      </div>
      {!onboarding && (
        <>
          <Field
            label="Workspace logo"
            hint="Choose a reviewed image from a project’s Screenshots tab. New projects receive their own independent copy."
          >
            <select
              value={settings.logoId || ""}
              onChange={(e) =>
                setSettings({ ...settings, logoId: e.target.value || null })
              }
            >
              <option value="">No workspace logo</option>
              {assets.map((asset) => (
                <option value={asset.id} key={asset.id}>
                  {asset.projectName} · {asset.width} × {asset.height}
                </option>
              ))}
            </select>
          </Field>
          {settings.logoId && (
            <img
              className="workspace-logo-preview"
              src={assetUrl(settings.logoId)}
              alt="Workspace logo preview"
            />
          )}
          <h3>Email notifications</h3>
          {(
            [
              ["questionNotifications", "New client questions"],
              ["receiptNotifications", "Version receipts"],
              ["expiryReminders", "Hosting expiry reminders"],
              ["marketingEmails", "Marketing emails"],
            ] as const
          ).map(([key, label]) => (
            <label className="check-field" key={key}>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) =>
                  setSettings({ ...settings, [key]: e.target.checked })
                }
              />
              {label}
            </label>
          ))}
          <p className="muted">
            Account, security and payment messages are separate from optional
            notifications. Interface language is English; handbook content
            supports Unicode.
          </p>
        </>
      )}
      <Button type="submit" disabled={busy}>
        {busy
          ? "Saving…"
          : onboarding
            ? "Create my workspace"
            : "Save settings"}
      </Button>
      {message && (
        <p role="status" className="success-text">
          {message}
        </p>
      )}
    </form>
  );
}
export function Onboarding({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => Promise<void>;
}) {
  return (
    <div className="onboarding-page">
      <Logo />
      <Panel>
        <PageHeading
          eyebrow="ONE LAST THING"
          title="Make it your workspace."
          description="Your studio details help clients know who is behind the handbook. You can change these later."
        />
        <WorkspaceForm session={session} refresh={refresh} onboarding />
        <p className="muted">
          One creator per workspace. Clients receive project access.
        </p>
      </Panel>
    </div>
  );
}
function deviceName(agent: string) {
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Chrome\//.test(agent)
      ? "Chrome"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  const platform = /Android/.test(agent)
    ? "Android"
    : /iPhone|iPad/.test(agent)
      ? "iOS"
      : /Windows/.test(agent)
        ? "Windows"
        : /Mac/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : "Unknown device";
  return `${browser} · ${platform}`;
}
export function AccountControls({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => Promise<void>;
}) {
  const [devices, setDevices] = useState<any[]>([]);
  const [grants, setGrants] = useState<any[]>([]);
  const [scope, setScope] = useState("metadata");
  const [hours, setHours] = useState(1);
  const [sample, setSample] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const tz = session.user!.settings.timezone;
  async function load() {
    const [devices, grants] = await Promise.all([
      api("/account/sessions"),
      api("/support-grants"),
    ]);
    setDevices(devices);
    setGrants(grants);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 60000);
    return () => clearInterval(timer);
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
    <>
      <ErrorNotice error={error} />
      <Panel title="Account & sessions">
        <p>Verified email: {session.user!.email}</p>
        {devices.map((device) => (
          <div className="request-row" key={device.id}>
            <div>
              <strong>{deviceName(device.agent)}</strong>
              <small>Last active {formatDate(device.last_seen_at, tz)}</small>
              <small>Expires {formatDate(device.expires_at, tz)}</small>
            </div>
            {device.current ? (
              <Badge tone="green">Current session</Badge>
            ) : (
              <Button
                kind="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await send(`/account/sessions/${device.id}`, {}, "DELETE");
                    setMessage("Device signed out.");
                  })
                }
              >
                Sign out device
              </Button>
            )}
          </div>
        ))}
        <div className="action-row">
          <Link to="/auth?reauth=1" className="button secondary">
            Verify for sensitive actions
          </Link>
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await send("/auth/logout-others", {});
                setMessage("Other sessions signed out.");
              })
            }
          >
            Sign out other sessions
          </Button>
        </div>
      </Panel>
      <Panel title="Temporary support access">
        <p>
          Support diagnostics contain metadata only. You can provide a separate
          sanitized text sample for a limited time. This never grants access to
          your handbooks or screenshots.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await send("/support-grants", { scope, hours, sample });
              setConsent(false);
              setSample("");
              setMessage("Temporary support authorization saved.");
            });
          }}
        >
          <div className="form-grid">
            <Field label="Support access scope">
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setConsent(false);
                }}
              >
                <option value="metadata">Metadata only</option>
                <option value="sample">One sanitized sample I provide</option>
              </select>
            </Field>
            <Field label="Support access duration">
              <select
                value={hours}
                onChange={(e) => {
                  setHours(Number(e.target.value));
                  setConsent(false);
                }}
              >
                <option value={1}>1 hour</option>
                <option value={24}>24 hours</option>
              </select>
            </Field>
          </div>
          {scope === "sample" && (
            <Field
              label="Sanitized sample"
              hint="Remove passwords, personal data and client secrets before submitting."
            >
              <textarea
                required
                rows={4}
                maxLength={2000}
                value={sample}
                onChange={(e) => {
                  setSample(e.target.value);
                  setConsent(false);
                }}
              />
            </Field>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I authorize this scope and duration.
          </label>
          <Button type="submit" disabled={busy || !consent}>
            Authorize temporary access
          </Button>
        </form>
        {grants.map((grant) => (
          <div className="request-row" key={grant.id}>
            <div>
              <strong>
                {grant.scope === "sample"
                  ? "Sanitized sample"
                  : "Metadata only"}
              </strong>
              <small>Expires {formatDate(grant.expires_at, tz)}</small>
              <small>Reference {grant.id}</small>
            </div>
            <Badge tone={grant.state === "active" ? "green" : "neutral"}>
              {grant.state}
            </Badge>
            {grant.state === "active" && (
              <Button
                kind="text danger-text"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await send(`/support-grants/${grant.id}`, {}, "DELETE");
                    setMessage("Support access revoked.");
                  })
                }
              >
                Revoke access
              </Button>
            )}
          </div>
        ))}
      </Panel>
      {message && <p role="status">{message}</p>}
      <Panel title="Your data">
        <p>
          Export published content from each project. Delete a project in its
          overview after recent verification. Request account-wide export,
          correction or deletion through support.
        </p>
        <Link to="/app/help" className="button secondary">
          Submit a data request
        </Link>
      </Panel>
    </>
  );
}

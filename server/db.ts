import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
export const dataDir = path.resolve(process.env.DATA_DIR || ".data");
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, "handlio.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, workspace_id TEXT UNIQUE, settings TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, email TEXT NOT NULL, purpose TEXT NOT NULL, scope TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, verified_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, public_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, client_name TEXT NOT NULL, lifecycle TEXT NOT NULL DEFAULT 'active', sharing INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, draft TEXT NOT NULL, current_release_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), hash TEXT NOT NULL, bytes INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), version INTEGER NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, hash TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, changes TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(project_id,version));
CREATE TRIGGER IF NOT EXISTS immutable_release BEFORE UPDATE OF snapshot,hash,version,revision ON releases BEGIN SELECT RAISE(ABORT,'immutable release'); END;
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), email TEXT NOT NULL, role TEXT NOT NULL, min_version INTEGER NOT NULL, download INTEGER NOT NULL, status TEXT NOT NULL, invite_digest TEXT, invite_expires INTEGER, invited_at INTEGER, UNIQUE(project_id,email));
CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, release_id TEXT NOT NULL REFERENCES releases(id), step_id TEXT, author_id TEXT NOT NULL, body TEXT NOT NULL, blocking INTEGER NOT NULL, status TEXT NOT NULL, resolution TEXT, resolved_release_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS replies (id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id), author_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS confirmation_requests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, release_id TEXT NOT NULL REFERENCES releases(id), hash TEXT NOT NULL, required TEXT NOT NULL, checklist TEXT NOT NULL, note TEXT NOT NULL, due_at TEXT, status TEXT NOT NULL, reminded_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS confirmations (id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES confirmation_requests(id), member_id TEXT NOT NULL REFERENCES members(id), hash TEXT NOT NULL, wording TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(request_id,member_id));
CREATE TABLE IF NOT EXISTS validations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor_id TEXT NOT NULL, type TEXT NOT NULL, state TEXT NOT NULL, input TEXT NOT NULL, output TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, lease_at INTEGER, created_at INTEGER NOT NULL, finished_at INTEGER);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT NOT NULL, product TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, provider_transaction TEXT UNIQUE, checkout_url TEXT, created_at INTEGER NOT NULL, paid_at INTEGER, refunded INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, order_id TEXT UNIQUE NOT NULL REFERENCES orders(id), starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ai_expires_at INTEGER, limits TEXT NOT NULL, pricing_version TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, reserved INTEGER NOT NULL, committed INTEGER NOT NULL DEFAULT 0, window_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency (scope TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(scope,key));
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, project_id TEXT, actor_id TEXT NOT NULL, action TEXT NOT NULL, metadata TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, project_id TEXT, event_key TEXT UNIQUE NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reads (member_id TEXT NOT NULL, release_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(member_id,release_id,day));
CREATE TABLE IF NOT EXISTS support_requests (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT NOT NULL, email TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_members_project ON members(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state,created_at);
CREATE INDEX IF NOT EXISTS idx_grants_project ON grants(project_id);
CREATE INDEX IF NOT EXISTS idx_usage_project ON usage(project_id,kind);
CREATE TABLE IF NOT EXISTS mail_deliveries (id TEXT PRIMARY KEY, delivery_key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, provider TEXT NOT NULL, provider_message_id TEXT UNIQUE, state TEXT NOT NULL, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mail_events (id TEXT PRIMARY KEY, provider_message_id TEXT NOT NULL, state TEXT NOT NULL, occurred_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_mail_events_message ON mail_events(provider_message_id,occurred_at);
CREATE TABLE IF NOT EXISTS session_devices (session_digest TEXT PRIMARY KEY REFERENCES sessions(digest) ON DELETE CASCADE, id TEXT UNIQUE NOT NULL, agent TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS support_grants (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), scope TEXT NOT NULL, sample TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_checks (order_id TEXT PRIMARY KEY REFERENCES orders(id), checked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_receipts (order_id TEXT PRIMARY KEY REFERENCES orders(id), tax INTEGER, receipt_url TEXT, invoice_number TEXT);
`);
// SQL is always parameterized. JSON snapshots remain immutable after publication.
export type Row = Record<string, any>;
export const one = (sql: string, ...args: any[]) =>
  db.prepare(sql).get(...args) as Row | undefined;
export const many = (sql: string, ...args: any[]) =>
  db.prepare(sql).all(...args) as Row[];
export const run = (sql: string, ...args: any[]) =>
  db.prepare(sql).run(...args);
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export const id = () => randomUUID();
export const now = () => Date.now();
export const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export function canonical(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function audit(
  actor: string,
  project: string | null,
  action: string,
  metadata: object = {},
) {
  run(
    "INSERT INTO audit VALUES (?,?,?,?,?,?)",
    id(),
    project,
    actor,
    action,
    JSON.stringify(metadata),
    now(),
  );
}
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function requireValue<T>(
  v: T | undefined | null,
  code = "ACCESS_UNAVAILABLE",
  status = 404,
  message = "This resource is unavailable.",
): T {
  if (v == null) throw new AppError(code, status, message);
  return v;
}
export function idem<T>(
  scope: string,
  key: string,
  body: unknown,
  fn: () => T,
): T {
  if (!key || key.length > 120)
    throw new AppError(
      "IDEMPOTENCY_REQUIRED",
      400,
      "A valid request key is required.",
    );
  const digest = hash(canonical(body));
  return tx(() => {
    const old = one(
      "SELECT * FROM idempotency WHERE scope=? AND key=?",
      scope,
      key,
    );
    if (old) {
      if (old.hash !== digest)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "This request key was used with different content.",
        );
      return JSON.parse(old.result);
    }
    const result = fn();
    run(
      "INSERT INTO idempotency VALUES (?,?,?,?)",
      scope,
      key,
      digest,
      JSON.stringify(result),
    );
    return result;
  });
}

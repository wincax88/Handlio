import {
  AppError,
  audit,
  canonical,
  hash,
  id,
  many,
  now,
  one,
  requireValue,
  run,
  type Row,
} from "./db.js";
import {
  LIMITS,
  PRICING,
  draftSchema,
  type Draft,
  type Issue,
} from "../shared/model.js";
export const DAY = 86400000;
export function owner(user: Row, projectId: string) {
  const p = requireValue(
    one(
      "SELECT * FROM projects WHERE id=? AND workspace_id=? AND lifecycle!='deleted'",
      projectId,
      user.workspace_id,
    ),
  );
  if (entitlement(p).state === "expired")
    throw new AppError(
      "ENTITLEMENT_EXPIRED",
      403,
      "The owner export window has ended. Contact support about your data.",
    );
  return p;
}
export function entitlement(p: Row, at = now()) {
  const grants = many(
    "SELECT * FROM grants WHERE project_id=? AND status='active' ORDER BY starts_at",
    p.id,
  );
  const last = grants.at(-1);
  const expires = last?.expires_at || null;
  const disputed = one(
    "SELECT id FROM orders WHERE project_id=? AND status IN ('disputed','review')",
    p.id,
  );
  const hasOrders = one("SELECT id FROM orders WHERE project_id=?", p.id);
  const futureGap =
    last &&
    at < expires &&
    !grants.some((g) => g.starts_at <= at && g.expires_at > at);
  const state =
    disputed || futureGap
      ? "revoked"
      : !last
        ? hasOrders &&
          one(
            "SELECT id FROM orders WHERE project_id=? AND status='refunded'",
            p.id,
          )
          ? "revoked"
          : "free"
        : at < expires
          ? "paid_active"
          : at < expires + PRICING.graceDays * DAY
            ? "expired_grace"
            : "expired";
  const currentGrant =
    grants.find((g) => g.starts_at <= at && g.expires_at > at) || last;
  const limit = currentGrant ? JSON.parse(currentGrant.limits) : LIMITS.free;
  const aiGrant = grants.find((g) => g.ai_expires_at && g.ai_expires_at > at);
  const freeAi =
    one(
      "SELECT COALESCE(SUM(u.reserved+u.committed),0) AS total FROM usage u JOIN projects p ON p.id=u.project_id WHERE p.workspace_id=? AND u.kind='free_ai'",
      p.workspace_id,
    )?.total || 0;
  const aiUsed =
    one(
      "SELECT COALESCE(SUM(reserved+committed),0) AS total FROM usage WHERE project_id=? AND kind='ai'",
      p.id,
    )?.total || 0;
  const window = currentGrant?.starts_at || 0;
  const exportsUsed =
    one(
      "SELECT COALESCE(SUM(reserved+committed),0) AS total FROM usage WHERE project_id=? AND kind='export' AND window_at=?",
      p.id,
      window,
    )?.total || 0;
  const files = new Map<string, number>();
  for (const j of many(
    "SELECT output FROM jobs WHERE project_id=? AND type='export' AND state='succeeded' AND finished_at>?",
    p.id,
    at - 7 * DAY,
  )) {
    if (j.output) {
      const o = JSON.parse(j.output);
      if (o.file) files.set(o.file, o.bytes || 0);
    }
  }
  const storage =
    (one(
      "SELECT COALESCE(SUM(bytes),0) AS total FROM assets WHERE project_id=?",
      p.id,
    )?.total || 0) + [...files.values()].reduce((n, v) => n + v, 0);
  return {
    state,
    expiresAt: expires,
    graceUntil: expires ? expires + 30 * DAY : null,
    limits: limit,
    aiRemaining:
      state === "free"
        ? Math.max(0, 10 - freeAi)
        : aiGrant
          ? Math.max(0, 300 - aiUsed)
          : 0,
    exportsUsed,
    exportsToday:
      one(
        "SELECT COALESCE(SUM(reserved+committed),0) AS total FROM usage WHERE project_id=? AND kind='export' AND created_at>=?",
        p.id,
        new Date(at).setUTCHours(0, 0, 0, 0),
      )?.total || 0,
    storage,
    window,
  };
}
export function editable(p: Row) {
  const e = entitlement(p);
  if (p.lifecycle !== "active" || !["free", "paid_active"].includes(e.state))
    throw new AppError(
      "ENTITLEMENT_EXPIRED",
      403,
      "Editing is unavailable. Restore or renew this project.",
    );
  if (e.state === "free" && now() - p.updated_at >= 30 * DAY)
    throw new AppError(
      "ENTITLEMENT_EXPIRED",
      403,
      "This inactive free draft has expired.",
    );
}
export function paid(p: Row) {
  if (p.lifecycle !== "active" || entitlement(p).state !== "paid_active")
    throw new AppError(
      "PAYMENT_REQUIRED",
      403,
      "An active project package is required.",
    );
}
export function fresh(user: Row) {
  if (now() - user.verified_at > 10 * 60 * 1000)
    throw new AppError(
      "REAUTH_REQUIRED",
      401,
      "Verify your email again before this sensitive action.",
    );
}
export function client(user: Row, p: Row, release?: Row, download = false) {
  if (
    p.lifecycle !== "active" ||
    !p.sharing ||
    entitlement(p).state !== "paid_active"
  )
    throw new AppError(
      "ACCESS_UNAVAILABLE",
      404,
      "This handoff link is no longer available. Please contact the sender.",
    );
  const m = requireValue(
    one(
      "SELECT * FROM members WHERE project_id=? AND email=? AND status='active'",
      p.id,
      user.email,
    ),
  );
  if (
    release &&
    (release.project_id !== p.id ||
      release.status !== "published" ||
      release.version < m.min_version)
  )
    throw new AppError(
      "ACCESS_UNAVAILABLE",
      404,
      "This version is unavailable.",
    );
  if (download && !m.download)
    throw new AppError("ACCESS_UNAVAILABLE", 404, "Downloads are unavailable.");
  return m;
}
export function releaseDto(r: Row) {
  return {
    id: r.id,
    version: r.version,
    hash: r.hash,
    status: r.status,
    summary: r.summary,
    publishedAt: new Date(r.created_at).toISOString(),
    snapshot: JSON.parse(r.snapshot),
    changes: JSON.parse(r.changes),
  };
}
export function projectDto(p: Row) {
  const d = JSON.parse(p.draft) as Draft;
  const r = p.current_release_id
    ? one("SELECT * FROM releases WHERE id=?", p.current_release_id)
    : undefined;
  const requests = many(
    "SELECT * FROM confirmation_requests WHERE project_id=? ORDER BY created_at DESC",
    p.id,
  );
  return {
    id: p.id,
    publicId: p.public_id,
    name: p.name,
    clientName: p.client_name,
    lifecycle: p.lifecycle,
    sharing: !!p.sharing,
    revision: p.revision,
    draft: d,
    currentRelease: r ? releaseDto(r) : null,
    updatedAt: new Date(p.updated_at).toISOString(),
    entitlement: entitlement(p),
    openQuestions:
      one(
        "SELECT COUNT(*) AS n FROM questions WHERE project_id=? AND status='open'",
        p.id,
      )?.n || 0,
    confirmation: requests.find((q) => q.release_id === p.current_release_id)
      ? requestDto(requests.find((q) => q.release_id === p.current_release_id)!)
      : null,
  };
}
export function requestDto(r: Row) {
  const confirmations = many(
    "SELECT id,member_id,created_at,hash,wording FROM confirmations WHERE request_id=?",
    r.id,
  );
  return {
    ...r,
    required: JSON.parse(r.required),
    checklist: JSON.parse(r.checklist),
    confirmations,
  };
}
export function enforceDraft(p: Row, input: unknown) {
  const d = draftSchema.parse(input);
  const e = entitlement(p);
  if (
    d.guides.length > e.limits.guides ||
    d.guides.reduce((n, g) => n + g.steps.length, 0) > e.limits.steps
  )
    throw new AppError(
      "QUOTA_EXCEEDED",
      409,
      "The guide or step limit has been reached.",
    );
  const ids = [
    ...d.guides.map((g) => g.id),
    ...d.guides.flatMap((g) => g.steps.map((s) => s.id)),
    ...d.checklist.map((c) => c.id),
  ];
  if (new Set(ids).size !== ids.length)
    throw new AppError(
      "INVALID_CONTENT",
      400,
      "Guide, step and checklist IDs must be unique.",
    );
  for (const a of [
    d.logoId,
    ...d.guides.flatMap((g) => g.steps.map((s) => s.assetId)),
  ].filter(Boolean)) {
    if (
      !one(
        "SELECT id FROM assets WHERE id=? AND project_id=? AND status='ready'",
        a,
        p.id,
      )
    )
      throw new AppError(
        "ASSET_REVOKED",
        409,
        "Replace unavailable images before saving.",
      );
  }
  for (const c of d.checklist)
    if (c.guideId && !d.guides.some((g) => g.id === c.guideId))
      throw new AppError(
        "INVALID_CONTENT",
        400,
        "A checklist guide is unavailable.",
      );
  return d;
}
export function validate(p: Row, includePayment = true) {
  const d = JSON.parse(p.draft) as Draft;
  const blockers: Issue[] = [];
  const warnings: Issue[] = [];
  if (includePayment && entitlement(p).state !== "paid_active")
    blockers.push({
      code: "PAYMENT_REQUIRED",
      message: "Activate this project package before publishing.",
    });
  if (!d.supportEmail && !d.supportUrl)
    blockers.push({
      code: "SUPPORT_MISSING",
      message: "Add a support email or HTTPS website.",
    });
  if (!d.intro.trim())
    blockers.push({
      code: "INTRO_MISSING",
      message: "Add a project overview.",
    });
  const included = d.guides.filter((g) => g.included);
  if (!included.length)
    blockers.push({
      code: "EMPTY_HANDBOOK",
      message: "Include at least one guide.",
    });
  for (const g of included) {
    if (
      !g.title.trim() ||
      !g.steps.length ||
      !g.goal.trim() ||
      !g.prerequisites.trim() ||
      !g.audience.trim() ||
      !g.completion.trim()
    )
      blockers.push({
        code: "GUIDE_INCOMPLETE",
        message: `Complete the title, goal, prerequisites, audience, completion and steps for “${g.title}”.`,
        guideId: g.id,
      });
    for (const s of g.steps) {
      if (!s.title.trim() || !s.body.trim())
        blockers.push({
          code: "STEP_INCOMPLETE",
          message: "Add a step title and instructions.",
          guideId: g.id,
          stepId: s.id,
        });
      if (s.aiPending || !s.reviewed)
        blockers.push({
          code: "REVIEW_REQUIRED",
          message: "Review this step before publishing.",
          guideId: g.id,
          stepId: s.id,
        });
      if (!s.assetId && !s.textOnly)
        blockers.push({
          code: "SOURCE_MISSING",
          message: "Add a screenshot or mark this as a text-only step.",
          guideId: g.id,
          stepId: s.id,
        });
      if (
        s.assetId &&
        !one(
          "SELECT id FROM assets WHERE id=? AND project_id=? AND status='ready'",
          s.assetId,
          p.id,
        )
      )
        blockers.push({
          code: "ASSET_REVOKED",
          message: "Replace the unavailable screenshot.",
          guideId: g.id,
          stepId: s.id,
        });
      if (s.assetId && !s.alt.trim())
        blockers.push({
          code: "ALT_MISSING",
          message: "Describe this screenshot for accessibility.",
          guideId: g.id,
          stepId: s.id,
        });
      if (!s.expected.trim())
        warnings.push({
          code: "EXPECTED_MISSING",
          message: `Add an expected result to “${s.title}”.`,
          guideId: g.id,
          stepId: s.id,
        });
    }
  }
  if (!d.maintenance.trim())
    warnings.push({
      code: "MAINTENANCE_MISSING",
      message: "Describe the maintenance and support boundaries.",
    });
  return { blockers, warnings, revision: p.revision };
}
export function diff(old: Draft | null, next: Draft) {
  const before = new Map(
    (old?.guides || []).flatMap((g) => g.steps.map((s) => [s.id, s] as const)),
  );
  const after = new Map(
    next.guides.flatMap((g) => g.steps.map((s) => [s.id, s] as const)),
  );
  return {
    added: [...after].filter(([k]) => !before.has(k)).map(([, s]) => s.title),
    removed: [...before].filter(([k]) => !after.has(k)).map(([, s]) => s.title),
    modified: [...after]
      .filter(
        ([k, s]) => before.has(k) && canonical(before.get(k)) !== canonical(s),
      )
      .map(([, s]) => s.title),
  };
}
export function publish(p: Row, revision: number, summary: string) {
  editable(p);
  paid(p);
  if (p.revision !== revision)
    throw new AppError(
      "DRAFT_CONFLICT",
      409,
      "The draft changed. Check the saved version again.",
    );
  const check = validate(p);
  if (check.blockers.length)
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      "Resolve the publishing checks.",
      check,
    );
  const d = JSON.parse(p.draft) as Draft;
  const snapshot = {
    ...d,
    guides: d.guides
      .filter((g) => g.included)
      .map((g) => ({
        ...g,
        steps: g.steps.map((s) => ({ ...s, source: "" })),
      })),
    projectName: p.name,
    clientName: p.client_name,
  };
  const assets = [
    snapshot.logoId,
    ...snapshot.guides.flatMap((g) => g.steps.map((s) => s.assetId)),
  ]
    .filter(Boolean)
    .map((a) => ({
      id: a,
      hash: requireValue(
        one("SELECT hash FROM assets WHERE id=? AND project_id=?", a, p.id),
      ).hash,
    }));
  const manifest = hash(
    canonical({ snapshot, assets, algorithm: "sorted-json-v1" }),
  );
  const rid = id();
  const v =
    (one("SELECT MAX(version) AS n FROM releases WHERE project_id=?", p.id)
      ?.n || 0) + 1;
  const prev = p.current_release_id
    ? one("SELECT snapshot FROM releases WHERE id=?", p.current_release_id)
    : null;
  run(
    "INSERT INTO releases VALUES (?,?,?,?,?,?,?,?,?,?)",
    rid,
    p.id,
    v,
    p.revision,
    JSON.stringify(snapshot),
    manifest,
    "published",
    summary,
    JSON.stringify(diff(prev ? JSON.parse(prev.snapshot) : null, snapshot)),
    now(),
  );
  run(
    "UPDATE confirmation_requests SET status='superseded' WHERE project_id=? AND status IN ('pending','in_progress')",
    p.id,
  );
  run(
    "UPDATE projects SET current_release_id=?,updated_at=? WHERE id=?",
    rid,
    now(),
    p.id,
  );
  audit("worker", p.id, "release_published", {
    releaseId: rid,
    version: v,
    hash: manifest,
  });
  return { releaseId: rid, version: v };
}
export function recalculateGrants(projectId: string) {
  const orders = many(
    "SELECT * FROM orders WHERE project_id=? AND status='paid' AND refunded=0 ORDER BY paid_at,id",
    projectId,
  );
  run("UPDATE grants SET status='revoked' WHERE project_id=?", projectId);
  let end = 0;
  for (const o of orders) {
    const existing = one("SELECT * FROM grants WHERE order_id=?", o.id);
    const start = existing?.starts_at ?? Math.max(end, o.paid_at);
    end = existing?.expires_at ?? start + PRICING.days * DAY;
    run(
      `INSERT INTO grants VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET status='active'`,
      id(),
      projectId,
      o.id,
      start,
      end,
      o.product === "project" ? o.paid_at + 90 * DAY : null,
      JSON.stringify(LIMITS.paid),
      PRICING.version,
      "active",
    );
  }
}

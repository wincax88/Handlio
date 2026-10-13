import type { Express, Request, Response, NextFunction } from "express";
import {
  randomBytes,
  randomInt,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { emailSchema } from "../shared/model.js";
import { workspaceDefaults, workspaceSettings } from "../shared/workspace.js";
import { fresh } from "./domain.js";
import {
  AppError,
  audit,
  hash,
  id,
  now,
  one,
  run,
  tx,
  requireValue,
} from "./db.js";
import { localMode, origin, sendMail } from "./providers.js";
import { billingAvailable } from "./dodo.js";
import { expectedPaymentEnvironment } from "./payment-instance.js";
const secret =
  process.env.SESSION_SECRET || "local-only-development-session-secret-32";
const digest = (code: string, email: string, purpose: string, scope: string) =>
  createHmac("sha256", secret)
    .update(`${email}:${purpose}:${scope}:${code}`)
    .digest("hex");
const secure = process.env.NODE_ENV === "production";
export function installAuth(app: Express) {
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    const token = req.cookies?.handlio_session;
    if (token)
      res.locals.user = one(
        "SELECT u.*,s.csrf,s.verified_at,s.digest AS session_digest FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.expires_at>?",
        hash(token),
        now(),
      );
    if (res.locals.user) {
      run(
        "INSERT OR IGNORE INTO session_devices VALUES (?,?,?,?,?)",
        res.locals.user.session_digest,
        id(),
        (req.get("user-agent") || "Unknown device").slice(0, 300),
        now(),
        now(),
      );
      run(
        "UPDATE session_devices SET last_seen_at=? WHERE session_digest=? AND last_seen_at<?",
        now(),
        res.locals.user.session_digest,
        now() - 60000,
      );
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.path.startsWith("/webhooks/")
    ) {
      const requestOrigin = req.get("origin");
      if (requestOrigin && requestOrigin !== origin)
        return next(
          new AppError("CSRF_REJECTED", 403, "Reload this page and retry."),
        );
      if (res.locals.user && req.get("x-csrf-token") !== res.locals.user.csrf)
        return next(
          new AppError("CSRF_REJECTED", 403, "Reload this page and retry."),
        );
    }
    next();
  });
  const throttle = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: process.env.NODE_ENV === "test" ? 200 : 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      code: "RATE_LIMITED",
      safe_message: "Too many requests. Try again later.",
    },
  });
  app.post("/api/auth/challenges", throttle, async (req, res) => {
    const b = z
      .object({
        email: emailSchema,
        purpose: z.enum(["owner", "client", "reauth"]).default("owner"),
        publicId: z.string().default(""),
        invite: z.string().default(""),
      })
      .parse(req.body);
    const scope = b.purpose === "client" ? b.publicId : "";
    const recent = one(
      "SELECT * FROM challenges WHERE email=? ORDER BY created_at DESC LIMIT 1",
      b.email,
    );
    const count =
      one(
        "SELECT COUNT(*) AS n FROM challenges WHERE email=? AND created_at>?",
        b.email,
        now() - 3600000,
      )?.n || 0;
    if (
      (recent && now() - recent.created_at < 60000) ||
      count >= 5 ||
      (recent && recent.attempts >= 5 && now() - recent.created_at < 15 * 60000)
    )
      throw new AppError(
        "RATE_LIMITED",
        429,
        "Please wait before requesting another code.",
      );
    if (
      b.purpose === "reauth" &&
      (!res.locals.user || res.locals.user.email !== b.email)
    )
      throw new AppError(
        "AUTH_REQUIRED",
        401,
        "Sign in to verify this session.",
      );
    let eligible = true;
    if (b.purpose === "client") {
      const p = one(
        "SELECT * FROM projects WHERE public_id=? AND lifecycle='active'",
        b.publicId,
      );
      const m = p
        ? one(
            "SELECT * FROM members WHERE project_id=? AND email=? AND status='active'",
            p.id,
            b.email,
          )
        : null;
      eligible = !!(
        m &&
        (!m.invite_digest ||
          (b.invite &&
            hash(b.invite) === m.invite_digest &&
            m.invite_expires > now()))
      );
    }
    const code = String(randomInt(100000, 1000000));
    const challengeId = id();
    tx(() => {
      run("UPDATE challenges SET consumed=1 WHERE email=?", b.email);
      run(
        "INSERT INTO challenges (id,email,purpose,scope,digest,created_at,expires_at,consumed) VALUES (?,?,?,?,?,?,?,?)",
        challengeId,
        b.email,
        b.purpose,
        scope,
        digest(code, b.email, b.purpose, scope),
        now(),
        now() + 600000,
        eligible ? 0 : 1,
      );
    });
    if (eligible)
      await sendMail(
        b.email,
        "Your Handlio verification code",
        `Your verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
        { kind: "auth", key: `auth/${challengeId}` },
      );
    res.json({
      challengeId,
      message: "If this email can access Handlio, a code has been sent.",
      ...(localMode && eligible ? { devCode: code } : {}),
    });
  });
  app.post("/api/auth/verify", throttle, (req, res) => {
    const b = z
      .object({
        challengeId: z.string(),
        code: z.string().regex(/^\d{6}$/),
        purpose: z.enum(["owner", "client", "reauth"]),
      })
      .parse(req.body);
    const c = one("SELECT * FROM challenges WHERE id=?", b.challengeId);
    if (
      !c ||
      c.consumed ||
      c.expires_at <= now() ||
      c.attempts >= 5 ||
      c.purpose !== b.purpose
    )
      throw new AppError(
        "CODE_INVALID",
        400,
        "This code is invalid or expired. Request a new code.",
      );
    run("UPDATE challenges SET attempts=attempts+1 WHERE id=?", c.id);
    if (
      !timingSafeEqual(
        Buffer.from(c.digest),
        Buffer.from(digest(b.code, c.email, c.purpose, c.scope)),
      )
    )
      throw new AppError(
        "CODE_INVALID",
        400,
        "This code is invalid or expired.",
      );
    tx(() => {
      run("UPDATE challenges SET consumed=1 WHERE id=?", c.id);
      let u = one("SELECT * FROM users WHERE email=?", c.email);
      if (!u) {
        const uid = id();
        run(
          "INSERT INTO users VALUES (?,?,?,?)",
          uid,
          c.email,
          b.purpose === "owner" ? id() : null,
          JSON.stringify(workspaceDefaults),
        );
        u = one("SELECT * FROM users WHERE id=?", uid);
      }
      const user = requireValue(u);
      if (b.purpose === "owner" && !user.workspace_id)
        run("UPDATE users SET workspace_id=? WHERE id=?", id(), user.id);
      if (b.purpose === "client") {
        const p = requireValue(
          one("SELECT id FROM projects WHERE public_id=?", c.scope),
        );
        run(
          "UPDATE members SET invite_digest=NULL,invite_expires=NULL WHERE project_id=? AND email=?",
          p.id,
          c.email,
        );
      }
      if (b.purpose === "reauth") {
        if (!res.locals.user || res.locals.user.id !== user.id)
          throw new AppError(
            "AUTH_REQUIRED",
            401,
            "Verify the signed-in email.",
          );
        run(
          "UPDATE sessions SET verified_at=? WHERE digest=?",
          now(),
          res.locals.user.session_digest,
        );
      } else {
        const token = randomBytes(32).toString("hex");
        const csrf = randomBytes(24).toString("hex");
        run(
          "INSERT INTO sessions VALUES (?,?,?,?,?)",
          hash(token),
          user.id,
          csrf,
          now(),
          now() + 12 * 3600000,
        );
        res.cookie("handlio_session", token, {
          httpOnly: true,
          secure,
          sameSite: "lax",
          maxAge: 12 * 3600000,
          path: "/",
        });
      }
      audit(user.id, null, "email_verified", { purpose: b.purpose });
    });
    res.json({ ok: true });
  });
  app.get("/api/session", (req, res) => {
    const u = res.locals.user;
    res.json({
      user: u
        ? {
            id: u.id,
            email: u.email,
            workspaceId: u.workspace_id,
            settings: workspaceSettings(u.settings),
            csrf: u.csrf,
            verifiedAt: u.verified_at,
          }
        : null,
      localMode,
      aiEnabled: !!process.env.AI_ADAPTER_URL,
      aiNotice: process.env.AI_PRIVACY_NOTICE || "",
      billingEnabled: billingAvailable(),
      paymentEnvironment: expectedPaymentEnvironment(),
      supportEmail: process.env.SUPPORT_EMAIL || "support@example.com",
    });
  });
  app.post("/api/auth/logout", (req, res) => {
    if (res.locals.user)
      run(
        "DELETE FROM sessions WHERE digest=?",
        res.locals.user.session_digest,
      );
    res.clearCookie("handlio_session", { path: "/" });
    res.json({ ok: true });
  });
  app.post("/api/auth/logout-others", authenticated, (req, res) => {
    fresh(res.locals.user);
    run(
      "DELETE FROM sessions WHERE user_id=? AND digest!=?",
      res.locals.user.id,
      res.locals.user.session_digest,
    );
    audit(res.locals.user.id, null, "other_sessions_revoked");
    res.json({ ok: true });
  });
}
export function authenticated(req: Request, res: Response, next: NextFunction) {
  if (!res.locals.user)
    return next(
      new AppError("AUTH_REQUIRED", 401, "Verify your email to continue."),
    );
  next();
}

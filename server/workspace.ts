import type { Express } from "express";
import { z } from "zod";
import { authenticated } from "./auth.js";
import {
  AppError,
  audit,
  id,
  many,
  now,
  one,
  requireValue,
  run,
  tx,
} from "./db.js";
import { fresh } from "./domain.js";

export function installWorkspace(app: Express) {
  app.get("/api/workspace/assets", authenticated, (req, res) => {
    res.json(
      many(
        "SELECT a.id,a.width,a.height,p.name AS projectName FROM assets a JOIN projects p ON p.id=a.project_id WHERE p.workspace_id=? AND p.lifecycle!='deleted' AND a.status='ready' ORDER BY a.created_at DESC LIMIT 100",
        res.locals.user.workspace_id,
      ),
    );
  });
  app.get("/api/account/sessions", authenticated, (req, res) => {
    res.json(
      many(
        "SELECT d.id,d.agent,d.created_at,d.last_seen_at,s.expires_at,s.digest FROM session_devices d JOIN sessions s ON s.digest=d.session_digest WHERE s.user_id=? AND s.expires_at>? ORDER BY d.last_seen_at DESC",
        res.locals.user.id,
        now(),
      ).map(({ digest, ...device }) => ({
        ...device,
        current: digest === res.locals.user.session_digest,
      })),
    );
  });
  app.delete("/api/account/sessions/:id", authenticated, (req, res) => {
    fresh(res.locals.user);
    const device = requireValue(
      one(
        "SELECT d.session_digest FROM session_devices d JOIN sessions s ON s.digest=d.session_digest WHERE d.id=? AND s.user_id=?",
        String(req.params.id),
        res.locals.user.id,
      ),
    );
    run("DELETE FROM sessions WHERE digest=?", device.session_digest);
    audit(res.locals.user.id, null, "session_revoked", {
      deviceId: String(req.params.id),
    });
    if (device.session_digest === res.locals.user.session_digest)
      res.clearCookie("handlio_session", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/support-grants", authenticated, (req, res) => {
    res.json(
      many(
        "SELECT id,scope,expires_at,revoked_at,created_at FROM support_grants WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
        res.locals.user.id,
      ).map((grant) => ({
        ...grant,
        state: grant.revoked_at
          ? "revoked"
          : grant.expires_at <= now()
            ? "expired"
            : "active",
      })),
    );
  });
  app.post("/api/support-grants", authenticated, (req, res) => {
    fresh(res.locals.user);
    const b = z
      .object({
        scope: z.enum(["metadata", "sample"]),
        hours: z.union([z.literal(1), z.literal(24)]),
        sample: z.string().trim().max(2000).default(""),
      })
      .parse(req.body);
    if (b.scope === "sample" && !b.sample)
      throw new AppError(
        "INVALID_INPUT",
        400,
        "Provide the sanitized sample you want support to read.",
      );
    const grantId = id(),
      expiresAt = now() + b.hours * 3600000;
    tx(() => {
      run(
        "UPDATE support_grants SET revoked_at=?,sample='' WHERE user_id=? AND revoked_at IS NULL",
        now(),
        res.locals.user.id,
      );
      run(
        "INSERT INTO support_grants VALUES (?,?,?,?,?,?,?)",
        grantId,
        res.locals.user.id,
        b.scope,
        b.scope === "sample" ? b.sample : "",
        expiresAt,
        null,
        now(),
      );
      audit(res.locals.user.id, null, "support_access_granted", {
        grantId,
        scope: b.scope,
        expiresAt,
      });
    });
    res.status(201).json({ id: grantId, expiresAt });
  });
  app.delete("/api/support-grants/:id", authenticated, (req, res) => {
    const grant = requireValue(
      one(
        "SELECT id FROM support_grants WHERE id=? AND user_id=?",
        String(req.params.id),
        res.locals.user.id,
      ),
    );
    run(
      "UPDATE support_grants SET revoked_at=COALESCE(revoked_at,?),sample='' WHERE id=?",
      now(),
      grant.id,
    );
    audit(res.locals.user.id, null, "support_access_revoked", {
      grantId: grant.id,
    });
    res.json({ ok: true });
  });
}

import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { copyFileSync, unlinkSync } from "node:fs";
import { imageSlot, sanitizeImage } from "./image.js";
import {
  AppError,
  audit,
  dataDir,
  hash,
  id,
  idem,
  many,
  now,
  one,
  requireValue,
  run,
  tx,
  type Row,
} from "./db.js";
import {
  client,
  DAY,
  editable,
  enforceDraft,
  entitlement,
  fresh,
  owner,
  paid,
  projectDto,
  releaseDto,
  requestDto,
  validate,
} from "./domain.js";
import { authenticated } from "./auth.js";
import {
  createDraft,
  emailSchema,
  type Draft,
  type Role,
} from "../shared/model.js";
import { notify, origin } from "./providers.js";
import { settingsSchema, workspaceSettings } from "../shared/workspace.js";
import { relatedAssets } from "./annotations.js";
const param = (r: Request, key = "id") => String(r.params[key]);
const key = (r: Request) =>
  String(r.get("idempotency-key") || r.body?.idempotencyKey || "");
const me = (r: Response) => r.locals.user as Row;
const loadRelease = (rid: string) =>
  requireValue(one("SELECT * FROM releases WHERE id=?", rid));
function accessRelease(user: Row, r: Row, download = false) {
  const p = requireValue(
    one(
      "SELECT * FROM projects WHERE id=? AND lifecycle!='deleted'",
      r.project_id,
    ),
  );
  if (user.workspace_id === p.workspace_id) {
    if (r.status === "security_revoked")
      throw new AppError(
        "ACCESS_UNAVAILABLE",
        404,
        "This version was withdrawn for safety.",
      );
    return { p, m: null };
  }
  return { p, m: client(user, p, r, download) };
}
function invalidateMember(p: Row, memberId: string) {
  for (const request of many(
    "SELECT * FROM confirmation_requests WHERE project_id=? AND status IN ('pending','in_progress')",
    p.id,
  ))
    if (JSON.parse(request.required).includes(memberId))
      run(
        "UPDATE confirmation_requests SET status='withdrawn' WHERE id=?",
        request.id,
      );
}
export function installRoutes(app: Express) {
  app.get("/api/projects", authenticated, (req, res) =>
    res.json(
      many(
        "SELECT * FROM projects WHERE workspace_id=? AND lifecycle!='deleted' ORDER BY updated_at DESC",
        me(res).workspace_id,
      )
        .filter((p) => entitlement(p).state !== "expired")
        .map(projectDto),
    ),
  );
  app.post("/api/projects", authenticated, (req, res) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(120),
        clientName: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(160),
        template: z.enum(["website", "software", "blank"]),
      })
      .parse(req.body);
    const u = me(res);
    if (!u.workspace_id)
      throw new AppError(
        "ACCESS_UNAVAILABLE",
        403,
        "Sign in as a creator to create a workspace.",
      );
    const result = idem(`${u.id}:create-project`, key(req), b, () => {
      const projects = many(
        "SELECT * FROM projects WHERE workspace_id=? AND lifecycle!='deleted'",
        u.workspace_id,
      );
      if (projects.some((p) => entitlement(p).state === "free"))
        throw new AppError(
          "QUOTA_EXCEEDED",
          409,
          "Your workspace can have one free draft. Activate or delete the existing draft first.",
        );
      const pid = id();
      const d = createDraft(b.template, b.title, id);
      const settings = JSON.parse(u.settings);
      d.supportEmail = settings.supportEmail || "";
      run(
        "INSERT INTO projects (id,workspace_id,public_id,name,client_name,draft,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        pid,
        u.workspace_id,
        randomBytes(24).toString("hex"),
        b.name,
        b.clientName,
        JSON.stringify(d),
        now(),
        now(),
      );
      audit(u.id, pid, "project_created", { template: b.template });
      if (settings.logoId) {
        const logo = one(
          "SELECT a.* FROM assets a JOIN projects p ON p.id=a.project_id WHERE a.id=? AND p.workspace_id=? AND p.lifecycle!='deleted' AND a.status='ready'",
          settings.logoId,
          u.workspace_id,
        );
        if (logo) {
          const logoId = id();
          copyFileSync(
            path.join(dataDir, `${logo.id}.png`),
            path.join(dataDir, `${logoId}.png`),
          );
          run(
            "INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)",
            logoId,
            pid,
            logo.hash,
            logo.bytes,
            logo.width,
            logo.height,
            "ready",
            now(),
          );
          d.logoId = logoId;
          run("UPDATE projects SET draft=? WHERE id=?", JSON.stringify(d), pid);
        }
      }
      return { id: pid };
    });
    res.status(201).json(result);
  });
  app.get("/api/projects/:id", authenticated, (req, res) =>
    res.json(projectDto(owner(me(res), param(req)))),
  );
  app.get(
    "/api/projects/public/:publicId/preview",
    authenticated,
    (req, res) => {
      const p = requireValue(
        one(
          "SELECT * FROM projects WHERE public_id=? AND workspace_id=? AND lifecycle!='deleted'",
          param(req, "publicId"),
          me(res).workspace_id,
        ),
      );
      owner(me(res), p.id);
      const r = loadRelease(
        String(req.query.release || p.current_release_id || ""),
      );
      if (r.project_id !== p.id || r.status === "security_revoked")
        throw new AppError("ACCESS_UNAVAILABLE", 404, "Version unavailable.");
      res.json({
        projectId: p.id,
        release: releaseDto(r),
        currentVersion: loadRelease(p.current_release_id).version,
        versions: many(
          "SELECT id,version,summary FROM releases WHERE project_id=? AND status!='security_revoked' ORDER BY version DESC",
          p.id,
        ),
        requests: [],
        questions: [],
        member: { role: "Owner", download: true },
      });
    },
  );
  app.patch("/api/projects/:id/draft", authenticated, (req, res) => {
    const p = owner(me(res), param(req));
    editable(p);
    const b = z
      .object({ baseRevision: z.number().int(), draft: z.unknown() })
      .parse(req.body);
    const d = enforceDraft(p, b.draft);
    tx(() => {
      const changed = run(
        "UPDATE projects SET draft=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
        JSON.stringify(d),
        now(),
        p.id,
        b.baseRevision,
      );
      if (changed.changes !== 1)
        throw new AppError(
          "DRAFT_CONFLICT",
          409,
          "Another window saved a newer draft. Reload and merge your changes.",
          {
            serverRevision: one(
              "SELECT revision FROM projects WHERE id=?",
              p.id,
            )?.revision,
          },
        );
      audit(me(res).id, p.id, "guide_edited", { revision: b.baseRevision + 1 });
    });
    res.json({ revision: b.baseRevision + 1 });
  });
  app.patch("/api/projects/:id", authenticated, (req, res) => {
    const p = owner(me(res), param(req));
    const b = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        clientName: z.string().trim().min(1).max(120).optional(),
        lifecycle: z.enum(["active", "archived"]).optional(),
        sharing: z.boolean().optional(),
      })
      .parse(req.body);
    if (b.name || b.clientName) editable(p);
    if (b.sharing) {
      paid(p);
      if (
        !p.current_release_id ||
        loadRelease(p.current_release_id).status !== "published"
      )
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "Publish a valid version before sharing.",
        );
    }
    tx(() => {
      run(
        "UPDATE projects SET name=?,client_name=?,lifecycle=?,sharing=?,revision=revision+1,updated_at=? WHERE id=?",
        b.name ?? p.name,
        b.clientName ?? p.client_name,
        b.lifecycle ?? p.lifecycle,
        b.lifecycle ? 0 : b.sharing == null ? p.sharing : Number(b.sharing),
        now(),
        p.id,
      );
      if (b.lifecycle === "archived" || b.sharing === false)
        run(
          "UPDATE confirmation_requests SET status='withdrawn' WHERE project_id=? AND status IN ('pending','in_progress')",
          p.id,
        );
      audit(me(res).id, p.id, "project_updated", b);
    });
    res.json(projectDto(owner(me(res), p.id)));
  });
  app.delete("/api/projects/:id", authenticated, (req, res) => {
    const previous = one(
      "SELECT lifecycle FROM projects WHERE id=? AND workspace_id=?",
      param(req),
      me(res).workspace_id,
    );
    if (previous?.lifecycle === "deleted") {
      res.json({ ok: true });
      return;
    }
    const p = owner(me(res), param(req));
    fresh(me(res));
    if (req.body.name !== p.name)
      throw new AppError(
        "NAME_MISMATCH",
        400,
        "Enter the exact project name to delete it.",
      );
    tx(() => {
      run(
        "UPDATE projects SET lifecycle='deleted',sharing=0,deleted_at=? WHERE id=?",
        now(),
        p.id,
      );
      run(
        "UPDATE jobs SET state='canceled' WHERE project_id=? AND state IN ('queued','running')",
        p.id,
      );
      run("UPDATE usage SET reserved=0 WHERE project_id=?", p.id);
      run("UPDATE members SET status='removed' WHERE project_id=?", p.id);
      run(
        "UPDATE confirmation_requests SET status='withdrawn' WHERE project_id=? AND status IN ('pending','in_progress')",
        p.id,
      );
      audit(me(res).id, p.id, "project_deleted");
    });
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/copy", authenticated, (req, res) => {
    const source = owner(me(res), param(req));
    editable(source);
    const b = z
      .object({
        name: z.string().trim().min(1).max(120),
        clientName: z.string().trim().min(1).max(120),
        reviewed: z.literal(true),
        assetIds: z.array(z.string()).max(21).default([]),
      })
      .parse(req.body);
    const copiedFiles: string[] = [];
    let result;
    try {
      result = idem(`${me(res).id}:copy:${source.id}`, key(req), b, () => {
        if (
          many(
            "SELECT * FROM projects WHERE workspace_id=? AND lifecycle!='deleted'",
            source.workspace_id,
          ).some((p) => entitlement(p).state === "free")
        )
          throw new AppError(
            "QUOTA_EXCEEDED",
            409,
            "Activate or delete the current free draft first.",
          );
        const d = JSON.parse(source.draft) as Draft;
        const originalAssets = new Set(
          [
            d.logoId,
            ...d.guides.flatMap((g) => g.steps.map((s) => s.assetId)),
          ].filter(Boolean),
        );
        const selectedAssets = [...new Set(b.assetIds)].map((aid) => {
          if (!originalAssets.has(aid))
            throw new AppError(
              "ASSET_UNAVAILABLE",
              400,
              "Choose only screenshots referenced in this source draft.",
            );
          return requireValue(
            one(
              "SELECT * FROM assets WHERE id=? AND project_id=? AND status='ready'",
              aid,
              source.id,
            ),
            "ASSET_UNAVAILABLE",
            400,
            "The selected image is unavailable.",
          );
        });
        if (selectedAssets.reduce((n, a) => n + a.bytes, 0) > 100 * 1024 * 1024)
          throw new AppError(
            "QUOTA_EXCEEDED",
            409,
            "Selected images exceed free draft storage.",
          );
        const assetMap = new Map(selectedAssets.map((a) => [a.id, id()]));
        d.supportEmail = "";
        d.supportUrl = "";
        d.logoId = d.logoId ? assetMap.get(d.logoId) || null : null;
        d.guides.forEach((g) => {
          g.id = id();
          g.steps.forEach((s) => {
            s.id = id();
            s.assetId = s.assetId ? assetMap.get(s.assetId) || null : null;
            s.reviewed = false;
            s.textOnly = false;
            s.aiPending = false;
          });
        });
        d.checklist.forEach((c) => {
          c.id = id();
          c.done = false;
          c.guideId = null;
        });
        if (
          d.guides.length > 3 ||
          d.guides.reduce((n, g) => n + g.steps.length, 0) > 20
        )
          throw new AppError(
            "QUOTA_EXCEEDED",
            409,
            "The source structure exceeds free draft limits.",
          );
        const pid = id();
        run(
          "INSERT INTO projects (id,workspace_id,public_id,name,client_name,draft,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
          pid,
          source.workspace_id,
          randomBytes(24).toString("hex"),
          b.name,
          b.clientName,
          JSON.stringify(d),
          now(),
          now(),
        );
        for (const a of selectedAssets) {
          const newId = assetMap.get(a.id)!;
          copyFileSync(
            path.join(dataDir, `${a.id}.png`),
            path.join(dataDir, `${newId}.png`),
          );
          copiedFiles.push(path.join(dataDir, `${newId}.png`));
          run(
            "INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)",
            newId,
            pid,
            a.hash,
            a.bytes,
            a.width,
            a.height,
            "ready",
            now(),
          );
          run(
            "INSERT INTO asset_quality SELECT ?,result FROM asset_quality WHERE asset_id=?",
            newId,
            a.id,
          );
        }
        audit(me(res).id, pid, "project_copied", { sourceId: source.id });
        return { id: pid };
      });
    } catch (error) {
      for (const file of copiedFiles) {
        try {
          unlinkSync(file);
        } catch {}
      }
      throw error;
    }
    res.json(result);
  });
  app.get("/api/projects/:id/assets", authenticated, (req, res) => {
    const p = owner(me(res), param(req));
    res.json(
      many(
        "SELECT id,hash,bytes,width,height,status FROM assets WHERE project_id=?",
        p.id,
      ),
    );
  });
  app.post(
    "/api/projects/:id/assets",
    authenticated,
    (req, res, next) => {
      try {
        editable(owner(me(res), param(req)));
        next();
      } catch (e) {
        next(e);
      }
    },
    imageSlot,
    express.raw({
      type: ["image/png", "image/jpeg", "image/webp"],
      limit: "20mb",
    }),
    async (req, res) => {
      const p = owner(me(res), param(req));
      editable(p);
      if (req.get("x-sanitized") !== "true" || !Buffer.isBuffer(req.body))
        throw new AppError(
          "SANITIZATION_REQUIRED",
          400,
          "Review and flatten this image before uploading.",
        );
      const buffer = req.body as Buffer;
      const isPng = buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isJpeg =
        buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
      const isWebp =
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";
      if (!isPng && !isJpeg && !isWebp)
        throw new AppError(
          "FORMAT_UNSUPPORTED",
          400,
          "Use a static PNG, JPEG or WebP image.",
        );
      if (isPng) {
        for (let offset = 8; offset + 12 <= buffer.length;) {
          const len = buffer.readUInt32BE(offset);
          if (buffer.toString("ascii", offset + 4, offset + 8) === "acTL")
            throw new AppError(
              "FORMAT_UNSUPPORTED",
              400,
              "Animated images are not supported.",
            );
          offset += len + 12;
        }
      }
      const uploadKey = key(req);
      const digest = hash(buffer);
      const old = one(
        "SELECT * FROM idempotency WHERE scope=? AND key=?",
        `${me(res).id}:upload:${p.id}`,
        uploadKey,
      );
      if (old) {
        if (old.hash !== digest)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "This upload key has different content.",
          );
        res.json(JSON.parse(old.result));
        return;
      }
      if (!uploadKey)
        throw new AppError(
          "IDEMPOTENCY_REQUIRED",
          400,
          "An upload key is required.",
        );
      const taskId = `${p.id}:${uploadKey}`;
      tx(() => {
        const e = entitlement(p);
        const reserved =
          one(
            "SELECT COALESCE(SUM(reserved),0) AS n FROM usage WHERE project_id=? AND kind='upload'",
            p.id,
          )?.n || 0;
        if (e.storage + reserved + buffer.length > e.limits.storage)
          throw new AppError(
            "QUOTA_EXCEEDED",
            409,
            "There is not enough image storage.",
          );
        if (one("SELECT task_id FROM usage WHERE task_id=?", taskId))
          throw new AppError(
            "UPLOAD_PENDING",
            409,
            "This image is already processing.",
          );
        run(
          "INSERT INTO usage VALUES (?,?,?,?,?,?,?,?)",
          id(),
          p.id,
          taskId,
          "upload",
          buffer.length,
          0,
          0,
          now(),
        );
      });
      let aid: string | null = null;
      try {
        const processed = await sanitizeImage(buffer);
        const safe = processed.safe;
        const meta = { width: processed.width, height: processed.height };
        aid = id();
        await writeFile(path.join(dataDir, `${aid}.png`), safe);
        const result = tx(() => {
          const current = owner(me(res), p.id);
          editable(current);
          const e = entitlement(current);
          const other =
            one(
              "SELECT COALESCE(SUM(reserved),0) AS n FROM usage WHERE project_id=? AND kind='upload' AND task_id!=?",
              p.id,
              taskId,
            )?.n || 0;
          if (e.storage + other + safe.length > e.limits.storage)
            throw new AppError(
              "QUOTA_EXCEEDED",
              409,
              "The processed image exceeds storage limits.",
            );
          run(
            "INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)",
            aid,
            p.id,
            hash(safe),
            safe.length,
            meta.width,
            meta.height,
            "ready",
            now(),
          );
          const result = {
            id: aid,
            width: meta.width,
            height: meta.height,
            bytes: safe.length,
          };
          run(
            "INSERT OR REPLACE INTO asset_quality VALUES (?,?)",
            aid,
            JSON.stringify(processed.quality),
          );
          run(
            "INSERT INTO idempotency VALUES (?,?,?,?)",
            `${me(res).id}:upload:${p.id}`,
            uploadKey,
            digest,
            JSON.stringify(result),
          );
          run("DELETE FROM usage WHERE task_id=?", taskId);
          audit(me(res).id, p.id, "asset_sanitized_uploaded", {
            assetId: aid,
            bytes: safe.length,
          });
          return result;
        });
        res.json(result);
      } catch (e) {
        run("DELETE FROM usage WHERE task_id=?", taskId);
        if (aid) await unlink(path.join(dataDir, `${aid}.png`)).catch(() => {});
        if (e instanceof AppError) throw e;
        throw new AppError(
          "IMAGE_INVALID",
          400,
          "This image could not be decoded. Try exporting it as a new PNG.",
          process.env.NODE_ENV === "test"
            ? { diagnostic: (e as Error).message }
            : undefined,
        );
      }
    },
  );
  app.get("/api/assets/:id", authenticated, async (req, res) => {
    const a = requireValue(
      one("SELECT * FROM assets WHERE id=? AND status='ready'", param(req)),
    );
    const p = requireValue(
      one(
        "SELECT * FROM projects WHERE id=? AND lifecycle!='deleted'",
        a.project_id,
      ),
    );
    const u = me(res);
    if (u.workspace_id === p.workspace_id) owner(u, p.id);
    else {
      const r = loadRelease(
        String(req.query.release || p.current_release_id || ""),
      );
      client(u, p, r);
      const d = JSON.parse(r.snapshot) as Draft;
      if (
        d.logoId !== a.id &&
        !d.guides.some((g) => g.steps.some((s) => s.assetId === a.id))
      )
        throw new AppError(
          "ACCESS_UNAVAILABLE",
          404,
          "This image is unavailable.",
        );
    }
    res.type("png").send(await readFile(path.join(dataDir, `${a.id}.png`)));
  });
  app.post("/api/projects/:id/validate", authenticated, (req, res) => {
    const p = owner(me(res), param(req));
    editable(p);
    const result = validate(p);
    const vid = id();
    run(
      "INSERT INTO validations VALUES (?,?,?,?,?)",
      vid,
      p.id,
      p.revision,
      JSON.stringify(result),
      now(),
    );
    res.json({ ...result, id: vid });
  });
  app.get("/api/projects/:id/releases", authenticated, (req, res) => {
    const p = owner(me(res), param(req));
    res.json(
      many(
        "SELECT * FROM releases WHERE project_id=? ORDER BY version DESC",
        p.id,
      ).map(releaseDto),
    );
  });
  app.post("/api/projects/:id/releases", authenticated, (req, res) => {
    const p = owner(me(res), param(req));
    editable(p);
    paid(p);
    const b = z
      .object({
        draftRevision: z.number().int(),
        validationId: z.string(),
        summary: z.string().trim().min(1).max(1000),
        warningReason: z.string().max(1000).default(""),
      })
      .parse(req.body);
    const result = idem(`${me(res).id}:publish:${p.id}`, key(req), b, () => {
      const v = requireValue(
        one(
          "SELECT * FROM validations WHERE id=? AND project_id=?",
          b.validationId,
          p.id,
        ),
        "VALIDATION_FAILED",
        422,
        "Check the draft before publishing.",
      );
      if (
        v.revision !== p.revision ||
        b.draftRevision !== p.revision ||
        now() - v.created_at > 15 * 60000
      )
        throw new AppError(
          "DRAFT_CONFLICT",
          409,
          "The publishing check is stale. Run it again.",
        );
      const check = validate(p);
      if (check.blockers.length)
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "Resolve all blocking checks.",
          check,
        );
      if (check.warnings.length && !b.warningReason.trim())
        throw new AppError(
          "WARNING_ACK_REQUIRED",
          422,
          "Explain why you are accepting the warnings.",
        );
      const jid = id();
      run(
        "INSERT INTO jobs (id,project_id,actor_id,type,state,input,created_at) VALUES (?,?,?,?,?,?,?)",
        jid,
        p.id,
        me(res).id,
        "publish",
        "queued",
        JSON.stringify({ ...b, revision: p.revision }),
        now(),
      );
      audit(me(res).id, p.id, "publish_requested", {
        jobId: jid,
        warningReason: b.warningReason,
      });
      return { jobId: jid };
    });
    res.status(202).json(result);
  });
  app.post("/api/releases/:id/restore", authenticated, (req, res) => {
    const r = loadRelease(param(req));
    const p = owner(me(res), r.project_id);
    editable(p);
    if (r.status === "security_revoked")
      throw new AppError(
        "ASSET_REVOKED",
        409,
        "Security-withdrawn content cannot be restored.",
      );
    const d = enforceDraft(p, JSON.parse(r.snapshot));
    tx(() => {
      run(
        "UPDATE projects SET draft=?,revision=revision+1,updated_at=? WHERE id=?",
        JSON.stringify(d),
        now(),
        p.id,
      );
      audit(me(res).id, p.id, "draft_restored", { releaseId: r.id });
    });
    res.json(projectDto(owner(me(res), p.id)));
  });
  app.post("/api/releases/:id/withdraw", authenticated, (req, res) => {
    const r = loadRelease(param(req));
    const p = owner(me(res), r.project_id);
    fresh(me(res));
    const b = z
      .object({
        reason: z.string().trim().min(1).max(1000),
        security: z.boolean(),
      })
      .parse(req.body);
    tx(() => {
      const affected = [r.id];
      if (b.security) {
        const d = JSON.parse(r.snapshot) as Draft;
        const assets = relatedAssets(
          p.id,
          [
            d.logoId,
            ...d.guides.flatMap((g) => g.steps.map((s) => s.assetId)),
          ].filter(Boolean) as string[],
        );
        for (const a of assets)
          run(
            "UPDATE assets SET status='revoked' WHERE id=? AND project_id=?",
            a,
            p.id,
          );
        for (const other of many(
          "SELECT * FROM releases WHERE project_id=?",
          p.id,
        )) {
          const s = JSON.parse(other.snapshot) as Draft;
          if (
            [
              s.logoId,
              ...s.guides.flatMap((g) => g.steps.map((st) => st.assetId)),
            ].some((a) => a && assets.includes(a))
          )
            affected.push(other.id);
        }
        run(
          "UPDATE jobs SET state='canceled' WHERE project_id=? AND state IN ('queued','running')",
          p.id,
        );
        run("UPDATE usage SET reserved=0 WHERE project_id=?", p.id);
      }
      for (const rid of new Set(affected)) {
        run(
          "UPDATE releases SET status=? WHERE id=?",
          b.security ? "security_revoked" : "withdrawn",
          rid,
        );
        run(
          "UPDATE confirmation_requests SET status='withdrawn' WHERE release_id=? AND status IN ('pending','in_progress')",
          rid,
        );
      }
      if (affected.includes(p.current_release_id))
        run("UPDATE projects SET sharing=0 WHERE id=?", p.id);
      if (b.security) {
        const incidentId = id();
        run(
          "INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?,?,?)",
          incidentId,
          p.id,
          r.id,
          me(res).id,
          b.reason,
          JSON.stringify([...new Set(affected)]),
          "open",
          null,
          now(),
          null,
        );
        for (const member of many(
          "SELECT email,min_version FROM members WHERE project_id=? AND status='active'",
          p.id,
        )) {
          const visibleAffected = affected.some(
            (rid) =>
              (one("SELECT version FROM releases WHERE id=?", rid)?.version ||
                0) >= member.min_version,
          );
          if (visibleAffected)
            notify(
              p.id,
              `security-incident:${incidentId}:${member.email}`,
              member.email,
              "A shared handbook was withdrawn for safety",
              "The project sender withdrew affected online handbook content for safety review. Online access is paused. Copies already downloaded cannot be recalled. Contact the sender using your existing contact details; do not share passwords or personal information in replies.",
            );
        }
      }
      audit(
        me(res).id,
        p.id,
        b.security ? "security_withdrawn" : "release_withdrawn",
        { reason: b.reason, affected },
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/projects/:id/handoff", authenticated, (req, res) => {
    const p = owner(me(res), param(req));
    res.json({
      members: many(
        "SELECT id,email,role,min_version,download,status,invited_at FROM members WHERE project_id=?",
        p.id,
      ),
      questions: many(
        "SELECT q.*,r.version AS version FROM questions q JOIN releases r ON r.id=q.release_id WHERE q.project_id=? ORDER BY q.created_at DESC",
        p.id,
      ).map((q) => ({
        ...q,
        replies: many(
          "SELECT * FROM replies WHERE question_id=? ORDER BY created_at",
          q.id,
        ),
      })),
      requests: many(
        "SELECT * FROM confirmation_requests WHERE project_id=? ORDER BY created_at DESC",
        p.id,
      ).map(requestDto),
      notifications: many(
        "SELECT id,subject,state,attempts,created_at FROM notifications WHERE project_id=? ORDER BY created_at DESC LIMIT 30",
        p.id,
      ),
    });
  });
  app.post("/api/projects/:id/invites", authenticated, (req, res) => {
    const p = owner(me(res), param(req));
    paid(p);
    const b = z
      .object({
        email: emailSchema.optional(),
        emails: z.array(emailSchema).min(1).max(10).optional(),
        role: z.enum(["Viewer", "Reviewer", "Confirmer"]),
        download: z.boolean(),
      })
      .refine(
        (v) => !!v.email !== !!v.emails,
        "Provide one email or a batch of 1–10 emails.",
      )
      .parse(req.body);
    const emails = [...new Set(b.emails || [b.email!])];
    if (!p.sharing || !p.current_release_id)
      throw new AppError(
        "SHARING_PAUSED",
        409,
        "Publish a version and enable sharing first.",
      );
    if (emails.includes(me(res).email))
      throw new AppError(
        "INVALID_MEMBER",
        400,
        "Invite a client email rather than your own creator email.",
      );
    const result = idem(`${me(res).id}:invite:${p.id}`, key(req), b, () => {
      const invitations = emails.map((email) => {
        const token = randomBytes(32).toString("hex");
        const old = one(
          "SELECT * FROM members WHERE project_id=? AND email=?",
          p.id,
          email,
        );
        if (old && now() - (old.invited_at || 0) < 60000)
          throw new AppError(
            "RATE_LIMITED",
            429,
            "Wait one minute before resending this invitation.",
          );
        if (
          (!old || old.status !== "active") &&
          (one(
            "SELECT COUNT(*) AS n FROM members WHERE project_id=? AND status='active'",
            p.id,
          )?.n || 0) >= 50
        )
          throw new AppError(
            "QUOTA_EXCEEDED",
            409,
            "This project has reached 50 active clients.",
          );
        const mid = old?.id || id();
        const version = loadRelease(p.current_release_id).version;
        if (old && old.role !== b.role) invalidateMember(p, mid);
        run(
          `INSERT INTO members VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,email) DO UPDATE SET role=excluded.role,download=excluded.download,status='active',invite_digest=excluded.invite_digest,invite_expires=excluded.invite_expires,invited_at=excluded.invited_at,min_version=CASE WHEN members.status='removed' THEN excluded.min_version ELSE members.min_version END`,
          mid,
          p.id,
          email,
          b.role,
          version,
          Number(b.download),
          "active",
          hash(token),
          now() + 7 * DAY,
          now(),
        );
        const url = `${origin}/h/${p.public_id}/access?invite=${token}`;
        notify(
          p.id,
          `invite:${mid}:${now()}`,
          email,
          "You have a client handoff invitation",
          `You have been invited to review version v${version}. Verify your invited email at ${url}. This invitation expires in 7 days.`,
        );
        audit(me(res).id, p.id, "client_invited", {
          memberId: mid,
          role: b.role,
        });
        return {
          id: mid,
          email,
          ...(process.env.NODE_ENV !== "production"
            ? { localInviteUrl: url }
            : {}),
        };
      });
      return b.emails ? { invitations } : invitations[0];
    });
    res.json(result);
  });
  app.patch("/api/projects/:id/members/:mid", authenticated, (req, res) => {
    const p = owner(me(res), param(req));
    const m = requireValue(
      one(
        "SELECT * FROM members WHERE id=? AND project_id=?",
        param(req, "mid"),
        p.id,
      ),
    );
    const b = z
      .object({
        role: z.enum(["Viewer", "Reviewer", "Confirmer"]),
        download: z.boolean(),
        status: z.enum(["active", "removed"]),
      })
      .parse(req.body);
    tx(() => {
      if (b.role !== m.role || b.status === "removed")
        invalidateMember(p, m.id);
      run(
        "UPDATE members SET role=?,download=?,status=?,invite_digest=NULL WHERE id=?",
        b.role,
        Number(b.download),
        b.status,
        m.id,
      );
      audit(me(res).id, p.id, "member_updated", { memberId: m.id, ...b });
    });
    res.json({ ok: true });
  });
  app.get("/api/client/handbooks/:publicId", authenticated, (req, res) => {
    const p = requireValue(
      one(
        "SELECT * FROM projects WHERE public_id=? AND lifecycle='active'",
        param(req, "publicId"),
      ),
    );
    const rid = String(req.query.release || p.current_release_id || "");
    const r = loadRelease(rid);
    const m = client(me(res), p, r);
    const requests = many(
      "SELECT * FROM confirmation_requests WHERE release_id=? ORDER BY created_at DESC",
      r.id,
    ).map(requestDto);
    const questions = many(
      "SELECT id,release_id,step_id,body,blocking,status,resolution,resolved_release_id,created_at,author_id FROM questions WHERE release_id=? ORDER BY created_at DESC",
      r.id,
    ).map((q) => ({
      ...q,
      isMine: q.author_id === me(res).id,
      author_id: undefined,
      replies: many(
        "SELECT id,body,created_at FROM replies WHERE question_id=? ORDER BY created_at",
        q.id,
      ),
    }));
    res.json({
      release: releaseDto(r),
      currentVersion: loadRelease(p.current_release_id).version,
      versions: many(
        "SELECT id,version,summary,created_at FROM releases WHERE project_id=? AND status='published' AND version>=? ORDER BY version DESC",
        p.id,
        m.min_version,
      ),
      member: {
        id: m.id,
        role: m.role,
        download: !!m.download,
        email: me(res).email,
      },
      requests: requests.map((q) => ({
        ...q,
        requiredCount: q.required.length,
        required: undefined,
        confirmations: q.confirmations.filter((c: Row) => c.member_id === m.id),
        isRequired: q.required.includes(m.id),
      })),
      questions,
      publicId: p.public_id,
    });
  });
  app.post("/api/releases/:id/read", authenticated, (req, res) => {
    const r = loadRelease(param(req));
    const { p, m } = accessRelease(me(res), r);
    if (m)
      run(
        "INSERT OR IGNORE INTO reads VALUES (?,?,?)",
        m.id,
        r.id,
        new Date(now()).toISOString().slice(0, 10),
      );
    res.json({ ok: true });
  });
  app.post("/api/releases/:id/questions", authenticated, (req, res) => {
    const r = loadRelease(param(req));
    const { p, m } = accessRelease(me(res), r);
    if (m && m.role === "Viewer")
      throw new AppError("ACCESS_UNAVAILABLE", 404, "Feedback is unavailable.");
    const b = z
      .object({
        body: z.string().trim().min(1).max(2000),
        stepId: z.string().nullable(),
        blocking: z.boolean(),
      })
      .parse(req.body);
    if (
      b.stepId &&
      !(JSON.parse(r.snapshot) as Draft).guides.some((g) =>
        g.steps.some((s) => s.id === b.stepId),
      )
    )
      throw new AppError(
        "ACCESS_UNAVAILABLE",
        404,
        "This step is unavailable.",
      );
    const result = idem(`${me(res).id}:question:${r.id}`, key(req), b, () => {
      const qid = id();
      run(
        "INSERT INTO questions (id,project_id,release_id,step_id,author_id,body,blocking,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        qid,
        p.id,
        r.id,
        b.stepId,
        me(res).id,
        b.body,
        Number(b.blocking),
        "open",
        now(),
      );
      // A later blocking question does not erase an already recorded receipt.
      // Resolve it and create a new request if another receipt is needed.
      const u = one(
        "SELECT email FROM users WHERE workspace_id=?",
        p.workspace_id,
      );
      if (u)
        notify(
          p.id,
          `question:${qid}`,
          u.email,
          `New question on v${r.version}`,
          `A client submitted a question. Review it at ${origin}/app/projects/${p.id}/handoff.`,
        );
      audit(me(res).id, p.id, "question_created", {
        releaseId: r.id,
        blocking: b.blocking,
      });
      return { id: qid };
    });
    res.json(result);
  });
  app.post("/api/questions/:id/replies", authenticated, (req, res) => {
    const q = requireValue(
      one("SELECT * FROM questions WHERE id=?", param(req)),
    );
    const r = loadRelease(q.release_id);
    const { p, m } = accessRelease(me(res), r);
    if (m && (m.role === "Viewer" || q.author_id !== me(res).id))
      throw new AppError("ACCESS_UNAVAILABLE", 404, "Reply is unavailable.");
    const b = z
      .object({ body: z.string().trim().min(1).max(2000) })
      .parse(req.body);
    const replyId = id();
    run(
      "INSERT INTO replies VALUES (?,?,?,?,?)",
      replyId,
      q.id,
      me(res).id,
      b.body,
      now(),
    );
    const author = one("SELECT email FROM users WHERE id=?", q.author_id);
    const creator = one(
      "SELECT email FROM users WHERE workspace_id=?",
      p.workspace_id,
    );
    const recipient = m ? creator : author;
    if (recipient && recipient.email !== me(res).email)
      notify(
        p.id,
        `reply:${replyId}`,
        recipient.email,
        `Reply on version v${r.version}`,
        `Review the reply at ${origin}/h/${p.public_id}?release=${r.id}.`,
      );
    res.json({ ok: true });
  });
  app.patch("/api/questions/:id", authenticated, (req, res) => {
    const q = requireValue(
      one("SELECT * FROM questions WHERE id=?", param(req)),
    );
    const p = requireValue(
      one("SELECT * FROM projects WHERE id=?", q.project_id),
    );
    const b = z
      .object({
        status: z.enum(["resolved", "withdrawn"]),
        resolution: z.string().max(2000).default(""),
        resolvedReleaseId: z.string().nullable().default(null),
      })
      .parse(req.body);
    if (b.status === "resolved") {
      owner(me(res), p.id);
      if (!b.resolution.trim())
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "Describe the resolution.",
        );
      if (
        b.resolvedReleaseId &&
        loadRelease(b.resolvedReleaseId).project_id !== p.id
      )
        throw new AppError("ACCESS_UNAVAILABLE", 404, "Version unavailable.");
    } else {
      accessRelease(me(res), loadRelease(q.release_id));
      if (q.author_id !== me(res).id)
        throw new AppError("ACCESS_UNAVAILABLE", 404, "Question unavailable.");
    }
    run(
      "UPDATE questions SET status=?,resolution=?,resolved_release_id=? WHERE id=?",
      b.status,
      b.resolution,
      b.resolvedReleaseId,
      q.id,
    );
    res.json({ ok: true });
  });
  app.post(
    "/api/releases/:id/confirmation-requests",
    authenticated,
    (req, res) => {
      const r = loadRelease(param(req));
      const p = owner(me(res), r.project_id);
      paid(p);
      const b = z
        .object({
          memberIds: z.array(z.string()).min(1).max(3),
          note: z.string().max(1000),
          dueAt: z.string().max(40).nullable(),
        })
        .parse(req.body);
      const result = idem(`${me(res).id}:request:${r.id}`, key(req), b, () => {
        if (
          r.status !== "published" ||
          p.current_release_id !== r.id ||
          !p.sharing
        )
          throw new AppError(
            "VERSION_CHANGED",
            409,
            "Request confirmation of the current shared version.",
          );
        if (new Set(b.memberIds).size !== b.memberIds.length)
          throw new AppError(
            "INVALID_MEMBER",
            400,
            "Choose distinct confirmers.",
          );
        for (const mid of b.memberIds)
          if (
            !one(
              "SELECT id FROM members WHERE id=? AND project_id=? AND role='Confirmer' AND status='active'",
              mid,
              p.id,
            )
          )
            throw new AppError(
              "INVALID_MEMBER",
              400,
              "Select active confirmers from this project.",
            );
        const d = JSON.parse(r.snapshot) as Draft;
        if (
          !d.checklist.some((c) => c.required) ||
          d.checklist.some((c) => c.required && !c.done)
        )
          throw new AppError(
            "CHECKLIST_INCOMPLETE",
            422,
            "Complete every required checklist item first.",
          );
        if (
          one(
            "SELECT id FROM questions WHERE release_id=? AND blocking=1 AND status='open'",
            r.id,
          )
        )
          throw new AppError(
            "BLOCKING_QUESTION",
            409,
            "Resolve all blocking questions first.",
          );
        run(
          "UPDATE confirmation_requests SET status='withdrawn' WHERE release_id=? AND status IN ('pending','in_progress')",
          r.id,
        );
        const qid = id();
        run(
          "INSERT INTO confirmation_requests (id,project_id,release_id,hash,required,checklist,note,due_at,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          qid,
          p.id,
          r.id,
          r.hash,
          JSON.stringify(b.memberIds),
          JSON.stringify(d.checklist),
          b.note,
          b.dueAt,
          "pending",
          now(),
        );
        for (const mid of b.memberIds) {
          const m = requireValue(
            one("SELECT email FROM members WHERE id=?", mid),
          );
          notify(
            p.id,
            `confirm-request:${qid}:${mid}`,
            m.email,
            `Receipt requested for version v${r.version}`,
            `Review and confirm receipt of this specific version at ${origin}/h/${p.public_id}. This is a receipt record, not an electronic contract signature.`,
          );
        }
        return { id: qid };
      });
      res.json(result);
    },
  );
  app.post(
    "/api/confirmation-requests/:id/confirm",
    authenticated,
    (req, res) => {
      const b = z
        .object({
          releaseId: z.string(),
          manifestHash: z.string(),
          acknowledgement: z.literal(true),
          wordingVersion: z.literal("receipt-v1"),
        })
        .parse(req.body);
      const q = requireValue(
        one("SELECT * FROM confirmation_requests WHERE id=?", param(req)),
      );
      const r = loadRelease(q.release_id);
      const p = requireValue(
        one("SELECT * FROM projects WHERE id=?", q.project_id),
      );
      const m = client(me(res), p, r);
      if (m.role !== "Confirmer" || !JSON.parse(q.required).includes(m.id))
        throw new AppError(
          "ACCESS_UNAVAILABLE",
          404,
          "This confirmation request is unavailable.",
        );
      const result = idem(`${me(res).id}:confirm:${q.id}`, key(req), b, () => {
        const current = requireValue(
          one("SELECT * FROM confirmation_requests WHERE id=?", q.id),
        );
        const pr = requireValue(one("SELECT * FROM projects WHERE id=?", p.id));
        client(me(res), pr, r);
        if (
          !["pending", "in_progress", "confirmed"].includes(current.status) ||
          pr.current_release_id !== b.releaseId ||
          current.release_id !== b.releaseId ||
          current.hash !== b.manifestHash
        )
          throw new AppError(
            "VERSION_CHANGED",
            409,
            "The version changed. Read the current version before confirming.",
          );
        if (
          one(
            "SELECT id FROM questions WHERE release_id=? AND blocking=1 AND status='open'",
            r.id,
          )
        )
          throw new AppError(
            "BLOCKING_QUESTION",
            409,
            "An open question blocks confirmation.",
          );
        run(
          "INSERT OR IGNORE INTO confirmations VALUES (?,?,?,?,?,?)",
          id(),
          q.id,
          m.id,
          r.hash,
          b.wordingVersion,
          now(),
        );
        const required = JSON.parse(q.required);
        const n =
          one(
            "SELECT COUNT(*) AS n FROM confirmations WHERE request_id=?",
            q.id,
          )?.n || 0;
        run(
          "UPDATE confirmation_requests SET status=? WHERE id=?",
          n === required.length ? "confirmed" : "in_progress",
          q.id,
        );
        audit(me(res).id, p.id, "handoff_confirmed", {
          requestId: q.id,
          releaseId: r.id,
          hash: r.hash,
          memberId: m.id,
        });
        const creator = one(
          "SELECT email FROM users WHERE workspace_id=?",
          p.workspace_id,
        );
        const receipt = requireValue(
          one(
            "SELECT id FROM confirmations WHERE request_id=? AND member_id=?",
            q.id,
            m.id,
          ),
        );
        if (creator)
          notify(
            p.id,
            `receipt:${receipt.id}`,
            creator.email,
            `Receipt recorded for version v${r.version}`,
            `Review the version receipt at ${origin}/app/projects/${p.id}/handoff.`,
          );
        return { ok: true };
      });
      res.json(result);
    },
  );
  app.post(
    "/api/confirmation-requests/:id/remind",
    authenticated,
    (req, res) => {
      const q = requireValue(
        one("SELECT * FROM confirmation_requests WHERE id=?", param(req)),
      );
      const p = owner(me(res), q.project_id);
      paid(p);
      if (!p.sharing || !["pending", "in_progress"].includes(q.status))
        throw new AppError(
          "VERSION_CHANGED",
          409,
          "This request no longer needs a reminder.",
        );
      if (q.reminded_at && now() - q.reminded_at < DAY)
        throw new AppError(
          "RATE_LIMITED",
          429,
          "You can remind clients once every 24 hours.",
        );
      tx(() => {
        for (const mid of JSON.parse(q.required)) {
          if (
            one(
              "SELECT id FROM confirmations WHERE request_id=? AND member_id=?",
              q.id,
              mid,
            )
          )
            continue;
          const m = one(
            "SELECT email FROM members WHERE id=? AND status='active'",
            mid,
          );
          if (m)
            notify(
              p.id,
              `reminder:${q.id}:${mid}:${new Date().toISOString().slice(0, 10)}`,
              m.email,
              "A handoff is waiting for your review",
              `Review the requested version at ${origin}/h/${p.public_id}.`,
            );
        }
        run(
          "UPDATE confirmation_requests SET reminded_at=? WHERE id=?",
          now(),
          q.id,
        );
      });
      res.json({ ok: true });
    },
  );
  app.get("/api/jobs/:id", authenticated, (req, res) => {
    const j = requireValue(one("SELECT * FROM jobs WHERE id=?", param(req)));
    const p = requireValue(
      one(
        "SELECT * FROM projects WHERE id=? AND lifecycle!='deleted'",
        j.project_id,
      ),
    );
    if (me(res).workspace_id !== p.workspace_id) {
      if (j.type !== "export" || j.actor_id !== me(res).id)
        throw new AppError("ACCESS_UNAVAILABLE", 404, "Task unavailable.");
      const input = JSON.parse(j.input);
      client(me(res), p, loadRelease(input.releaseId), true);
    }
    res.json({
      ...j,
      input: undefined,
      output: j.output ? JSON.parse(j.output) : null,
    });
  });
  app.get("/api/settings", authenticated, (req, res) =>
    res.json(workspaceSettings(me(res).settings)),
  );
  app.patch("/api/settings", authenticated, (req, res) => {
    const b = settingsSchema.parse({
      ...workspaceSettings(me(res).settings),
      ...req.body,
    });
    if (b.logoId)
      requireValue(
        one(
          "SELECT a.id FROM assets a JOIN projects p ON p.id=a.project_id WHERE a.id=? AND p.workspace_id=? AND p.lifecycle!='deleted' AND a.status='ready'",
          b.logoId,
          me(res).workspace_id,
        ),
        "ASSET_UNAVAILABLE",
        400,
        "Choose a reviewed image from your workspace.",
      );
    run(
      "UPDATE users SET settings=? WHERE id=?",
      JSON.stringify(b),
      me(res).id,
    );
    res.json(b);
  });
  app.post("/api/support", async (req, res) => {
    const b = z
      .object({
        email: emailSchema,
        kind: z.enum(["help", "privacy", "security", "refund"]),
        body: z.string().trim().min(1).max(2000),
      })
      .parse(req.body);
    const sid = id();
    run(
      "INSERT INTO support_requests VALUES (?,?,?,?,?,?,?)",
      sid,
      me(res)?.id || null,
      b.kind,
      b.email,
      b.body,
      "open",
      now(),
    );
    res.json({ id: sid, status: "open" });
  });
  app.get("/api/support", authenticated, (req, res) =>
    res.json(
      many(
        "SELECT id,kind,status,created_at FROM support_requests WHERE user_id=?",
        me(res).id,
      ),
    ),
  );
}
export { accessRelease, loadRelease };

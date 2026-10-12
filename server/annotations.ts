import type { Express } from "express";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { authenticated } from "./auth.js";
import {
  AppError,
  audit,
  canonical,
  dataDir,
  hash,
  id,
  many,
  now,
  one,
  requireValue,
  run,
  tx,
} from "./db.js";
import { editable, entitlement, owner } from "./domain.js";
import { imageSlot, sanitizeImage } from "./image.js";
import { annotationSvg, annotationsSchema } from "../shared/annotations.js";
export function relatedAssets(projectId: string, assetIds: string[]) {
  const related = new Set(assetIds);
  const recipes = many(
    "SELECT l.asset_id,l.base_asset_id FROM asset_layers l JOIN assets a ON a.id=l.asset_id WHERE a.project_id=?",
    projectId,
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const recipe of recipes)
      if (related.has(recipe.asset_id) || related.has(recipe.base_asset_id)) {
        if (!related.has(recipe.asset_id) || !related.has(recipe.base_asset_id))
          changed = true;
        related.add(recipe.asset_id);
        related.add(recipe.base_asset_id);
      }
  }
  return [...related];
}
export function installAnnotations(app: Express) {
  app.get(
    "/api/projects/:id/assets/:assetId/edit",
    authenticated,
    (req, res) => {
      const p = owner(res.locals.user, String(req.params.id));
      const asset = requireValue(
        one(
          "SELECT * FROM assets WHERE id=? AND project_id=? AND status='ready'",
          String(req.params.assetId),
          p.id,
        ),
      );
      const recipe = one(
        "SELECT * FROM asset_layers WHERE asset_id=?",
        asset.id,
      );
      const baseId = recipe?.base_asset_id || asset.id;
      requireValue(
        one(
          "SELECT id FROM assets WHERE id=? AND project_id=? AND status='ready'",
          baseId,
          p.id,
        ),
      );
      res.json({
        baseId,
        shapes: recipe ? JSON.parse(recipe.shapes) : [],
        width: asset.width,
        height: asset.height,
      });
    },
  );
  app.post(
    "/api/projects/:id/assets/:baseId/annotations",
    authenticated,
    imageSlot,
    async (req, res) => {
      const p = owner(res.locals.user, String(req.params.id));
      editable(p);
      const base = requireValue(
        one(
          "SELECT * FROM assets WHERE id=? AND project_id=? AND status='ready'",
          String(req.params.baseId),
          p.id,
        ),
      );
      const shapes = annotationsSchema.parse(req.body.shapes);
      const requestKey = String(req.get("idempotency-key") || "");
      if (!requestKey || requestKey.length > 120)
        throw new AppError(
          "IDEMPOTENCY_REQUIRED",
          400,
          "A valid request key is required.",
        );
      const scope = `${res.locals.user.id}:layers:${base.id}`,
        digest = hash(canonical(shapes));
      const previous = one(
        "SELECT * FROM idempotency WHERE scope=? AND key=?",
        scope,
        requestKey,
      );
      if (previous) {
        if (previous.hash !== digest)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "This key was used with other annotations.",
          );
        res.json(JSON.parse(previous.result));
        return;
      }
      const aid = id();
      let written = false;
      try {
        const image = await sanitizeImage(
          await readFile(path.join(dataDir, `${base.id}.png`)),
          annotationSvg(base.width, base.height, shapes),
        );
        await writeFile(path.join(dataDir, `${aid}.png`), image.safe);
        written = true;
        const result = tx(() => {
          const current = owner(res.locals.user, p.id);
          editable(current);
          requireValue(
            one(
              "SELECT id FROM assets WHERE id=? AND project_id=? AND status='ready'",
              base.id,
              p.id,
            ),
          );
          const concurrent = one(
            "SELECT * FROM idempotency WHERE scope=? AND key=?",
            scope,
            requestKey,
          );
          if (concurrent) {
            if (concurrent.hash !== digest)
              throw new AppError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "This key was used with other annotations.",
              );
            return JSON.parse(concurrent.result);
          }
          const e = entitlement(current),
            reserved =
              one(
                "SELECT COALESCE(SUM(reserved),0) AS n FROM usage WHERE project_id=? AND kind='upload'",
                p.id,
              )?.n || 0;
          if (
            image.safe.length > 20 * 1048576 ||
            e.storage + reserved + image.safe.length > e.limits.storage
          )
            throw new AppError(
              "QUOTA_EXCEEDED",
              409,
              "There is not enough storage for this annotated image.",
            );
          run(
            "INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)",
            aid,
            p.id,
            hash(image.safe),
            image.safe.length,
            image.width,
            image.height,
            "ready",
            now(),
          );
          run(
            "INSERT INTO asset_layers VALUES (?,?,?,?)",
            aid,
            base.id,
            JSON.stringify(shapes),
            "svg-v1",
          );
          run(
            "INSERT INTO asset_quality VALUES (?,?)",
            aid,
            JSON.stringify(image.quality),
          );
          const output = { id: aid, baseId: base.id };
          run(
            "INSERT INTO idempotency VALUES (?,?,?,?)",
            scope,
            requestKey,
            digest,
            JSON.stringify(output),
          );
          audit(res.locals.user.id, p.id, "annotations_saved", {
            assetId: aid,
            count: shapes.length,
          });
          return output;
        });
        if (result.id !== aid)
          await unlink(path.join(dataDir, `${aid}.png`)).catch(() => {});
        res.status(201).json(result);
      } catch (error) {
        if (written)
          await unlink(path.join(dataDir, `${aid}.png`)).catch(() => {});
        throw error;
      }
    },
  );
}

import type { Express } from "express";
import { z } from "zod";
import { authenticated } from "./auth.js";
import { audit, many, now, one, requireValue, run } from "./db.js";
import { fresh, owner } from "./domain.js";
export function installIncidents(app: Express) {
  app.get("/api/projects/:id/incidents", authenticated, (req, res) => {
    const p = owner(res.locals.user, String(req.params.id));
    res.json(
      many(
        "SELECT * FROM incidents WHERE project_id=? ORDER BY created_at DESC",
        p.id,
      ).map((i) => ({
        ...i,
        affected: JSON.parse(i.affected),
        notified: many(
          "SELECT state FROM notifications WHERE project_id=? AND event_key LIKE ?",
          p.id,
          `security-incident:${i.id}:%`,
        ),
      })),
    );
  });
  app.patch(
    "/api/projects/:id/incidents/:incidentId",
    authenticated,
    (req, res) => {
      const p = owner(res.locals.user, String(req.params.id));
      fresh(res.locals.user);
      const incident = requireValue(
        one(
          "SELECT * FROM incidents WHERE id=? AND project_id=?",
          String(req.params.incidentId),
          p.id,
        ),
      );
      const b = z
        .object({
          status: z.enum(["investigating", "closed"]),
          resolution: z.string().trim().min(5).max(2000),
          checklist: z.literal(true),
        })
        .parse(req.body);
      run(
        "UPDATE incidents SET status=?,resolution=?,closed_at=? WHERE id=?",
        b.status,
        b.resolution,
        b.status === "closed" ? now() : null,
        incident.id,
      );
      audit(res.locals.user.id, p.id, "incident_status_changed", {
        incidentId: incident.id,
        status: b.status,
      });
      res.json({ ok: true });
    },
  );
}

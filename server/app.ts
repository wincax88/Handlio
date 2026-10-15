import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import path from "node:path";
import { existsSync } from "node:fs";
import { AppError } from "./db.js";
import { installAuth } from "./auth.js";
import { installRoutes } from "./routes.js";
import { installBilling } from "./billing.js";
import { installJobs } from "./jobs.js";
import { installOps } from "./ops.js";
import { installMailWebhook } from "./mail-webhook.js";
import { installWorkspace } from "./workspace.js";
import { installAnnotations } from "./annotations.js";
import { installIncidents } from "./incidents.js";
import { installResources } from "./resources.js";
import { installLinkChecks } from "./link-checks.js";
import { installServiceInformation } from "./service-information.js";
import { installSeo } from "./seo.js";
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Trust only explicitly configured proxy addresses, never all forwarded headers.
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader("X-Request-ID", res.locals.requestId);
    if (req.path === "/api" || req.path.startsWith("/api/"))
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });
  app.use(
    "/api/webhooks/billing",
    express.raw({ type: "application/json", limit: "1mb" }),
  );
  app.use(
    "/api/webhooks/dodo",
    express.raw({ type: "application/json", limit: "1mb" }),
  );
  app.use(
    "/api/webhooks/resend",
    express.raw({ type: "application/json", limit: "256kb" }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  // Probes must stay available even when an API client hits its rate limit.
  app.get("/api/health", (req, res) =>
    res.json({ ok: true, version: "0.1.0" }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      // Browser regression shares a loopback IP across independent accounts.
      limit: process.env.NODE_ENV === "test" ? 1000 : 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: {
        code: "RATE_LIMITED",
        safe_message: "Too many requests. Wait one minute and try again.",
      },
    }),
  );
  installAuth(app);
  installRoutes(app);
  installWorkspace(app);
  installAnnotations(app);
  installIncidents(app);
  installResources(app);
  installLinkChecks(app);
  installServiceInformation(app);
  installBilling(app);
  installMailWebhook(app);
  installJobs(app);
  installOps(app);
  app.use("/api", (req, res) =>
    res.status(404).json({
      code: "ACCESS_UNAVAILABLE",
      safe_message: "This endpoint is unavailable.",
      request_id: res.locals.requestId,
    }),
  );
  const dist = path.resolve("dist");
  if (existsSync(dist)) {
    installSeo(app, dist);
  }
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) return next(err);
      const validation = err instanceof ZodError;
      const known = err instanceof AppError;
      const status = known
        ? err.status
        : validation
          ? 400
          : err.type === "entity.too.large"
            ? 413
            : 500;
      res.status(status).json({
        code: known
          ? err.code
          : validation
            ? "INVALID_INPUT"
            : status === 413
              ? "FILE_TOO_LARGE"
              : "SERVER_ERROR",
        safe_message: known
          ? err.message
          : validation
            ? "Check the highlighted fields and try again."
            : status === 413
              ? "This file is too large."
              : "Something went wrong. Keep your changes and retry.",
        request_id: res.locals.requestId,
        details: known
          ? err.details
          : validation
            ? err.issues.map((v) => ({
                field: v.path.join("."),
                message: v.message,
              }))
            : undefined,
      });
      if (status === 500)
        console.error(
          "request_failed",
          res.locals.requestId,
          err instanceof Error ? err.name : "unknown",
        );
    },
  );
  return app;
}

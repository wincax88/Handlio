import type { Request, Response, NextFunction } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError, now, one, run, tx } from "./db.js";

export const DEVICE_RISK_LIMITS = {
  challenges: 20,
  verifications: 60,
  failures: 10,
  window: 3600000,
  cooldown: 15 * 60000,
};
const cookieName = "handlio_device";
export function deviceRiskGate(
  kind: "challenges" | "verifications",
  secret: string,
  secure: boolean,
) {
  const sign = (value: string) =>
    createHmac("sha256", secret).update(`auth-device:${value}`).digest("hex");
  return (req: Request, res: Response, next: NextFunction) => {
    const supplied = String(req.cookies?.[cookieName] || "");
    const match = /^([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(supplied);
    const valid =
      match &&
      timingSafeEqual(
        Buffer.from(sign(match[1]), "hex"),
        Buffer.from(match[2], "hex"),
      );
    const token = valid ? match[1] : randomBytes(24).toString("hex");
    if (!valid)
      res.cookie(cookieName, `${token}.${sign(token)}`, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/api/auth",
        maxAge: 30 * 86400000,
      });
    const device = sign(`counter:${token}`);
    res.locals.authDevice = device;
    const retryAt = tx(() => {
      run(
        "INSERT OR IGNORE INTO auth_device_risk VALUES (?,?,0,0,0,0,?)",
        device,
        now(),
        now(),
      );
      let risk = one(
        "SELECT * FROM auth_device_risk WHERE device_digest=?",
        device,
      )!;
      if (risk.blocked_until > now()) return risk.blocked_until;
      if (now() - risk.window_started_at >= DEVICE_RISK_LIMITS.window) {
        run(
          "UPDATE auth_device_risk SET window_started_at=?,challenges=0,verifications=0,failures=0,blocked_until=0 WHERE device_digest=?",
          now(),
          device,
        );
        risk = one(
          "SELECT * FROM auth_device_risk WHERE device_digest=?",
          device,
        )!;
      }
      if (risk.blocked_until)
        run(
          "UPDATE auth_device_risk SET failures=0,blocked_until=0 WHERE device_digest=?",
          device,
        );
      if (risk[kind] >= DEVICE_RISK_LIMITS[kind])
        return risk.window_started_at + DEVICE_RISK_LIMITS.window;
      // The column is selected by this module, never supplied by the request.
      run(
        `UPDATE auth_device_risk SET ${kind}=${kind}+1,updated_at=? WHERE device_digest=?`,
        now(),
        device,
      );
      return 0;
    });
    if (retryAt) {
      const seconds = Math.max(1, Math.ceil((retryAt - now()) / 1000));
      res.setHeader("Retry-After", String(seconds));
      return next(
        new AppError(
          "RATE_LIMITED",
          429,
          `Too many verification attempts from this browser. Try again in ${seconds} seconds.`,
        ),
      );
    }
    next();
  };
}
export function recordDeviceFailure(device: string) {
  run(
    "UPDATE auth_device_risk SET failures=failures+1,blocked_until=CASE WHEN failures+1>=? THEN ? ELSE blocked_until END,updated_at=? WHERE device_digest=?",
    DEVICE_RISK_LIMITS.failures,
    now() + DEVICE_RISK_LIMITS.cooldown,
    now(),
    device,
  );
}

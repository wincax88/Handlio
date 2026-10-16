import "dotenv/config";
import { createApp } from "./app.js";
import { maintenance, processJobs } from "./jobs.js";
import { validateMailConfiguration } from "./mail.js";
import {
  createEncryptedBackup,
  pruneEncryptedBackups,
} from "./backup-store.js";
import { now, one, run } from "./db.js";
import path from "node:path";
import { validatePaymentInstance } from "./payment-instance.js";
import { reconcilePendingOrders } from "./billing-recovery.js";
if (process.env.NODE_ENV === "production") {
  if (
    !process.env.APP_ORIGIN?.startsWith("https://") ||
    (process.env.SESSION_SECRET?.length || 0) < 32
  )
    throw new Error(
      "Production requires HTTPS APP_ORIGIN and a random SESSION_SECRET.",
    );
}
validateMailConfiguration(process.env);
validatePaymentInstance();
const app = createApp();
const port = Number(process.env.PORT || 3001);
const server = app.listen(
  port,
  process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
  () => console.log(`Handlio API listening on http://127.0.0.1:${port}`),
);
const jobs = setInterval(() => void processJobs(), 1000);
const reconcile = () =>
  void reconcilePendingOrders().catch(() =>
    run(
      "INSERT INTO worker_state VALUES ('billing_reconciliation',NULL,?,'RECONCILIATION_FAILED') ON CONFLICT(name) DO UPDATE SET last_error_at=excluded.last_error_at,error_code=excluded.error_code",
      now(),
    ),
  );
const reconciliation = setInterval(reconcile, 60000);
reconcile();
const upkeep = setInterval(
  () =>
    void maintenance().catch(() =>
      run(
        "INSERT INTO worker_state VALUES ('maintenance',NULL,?,'MAINTENANCE_FAILED') ON CONFLICT(name) DO UPDATE SET last_error_at=excluded.last_error_at,error_code=excluded.error_code",
        now(),
      ),
    ),
  60000,
);
const backups = setInterval(() => {
  if (
    !process.env.BACKUP_KEY ||
    !process.env.BACKUP_DIRECTORY ||
    (one("SELECT last_success_at FROM worker_state WHERE name='backup'")
      ?.last_success_at || 0) >
      now() - 86400000
  )
    return;
  void createEncryptedBackup()
    .then((result) => pruneEncryptedBackups(path.dirname(result.file)))
    .catch(() => console.error("backup_failed: inspect operations metadata"));
}, 60000);
void maintenance();
const close = () => {
  clearInterval(jobs);
  clearInterval(reconciliation);
  clearInterval(upkeep);
  clearInterval(backups);
  server.close(() => process.exit(0));
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

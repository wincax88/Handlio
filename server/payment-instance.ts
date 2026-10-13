import { dataDir, one, run, tx } from "./db.js";

// Hosted sandbox keeps production authentication/TLS, but owns a separate database and volume.
export function expectedPaymentEnvironment() {
  if (process.env.NODE_ENV !== "production") return "sandbox";
  return process.env.PAYMENTS_SANDBOX_INSTANCE === "1" &&
    one("SELECT kind FROM billing_instance WHERE singleton=1")?.kind ===
      "sandbox"
    ? "sandbox"
    : "production";
}

export function validatePaymentInstance(
  config: Record<string, string | undefined> = process.env,
  directory = dataDir,
) {
  const sandbox = config.PAYMENTS_SANDBOX_INSTANCE === "1";
  if (
    sandbox &&
    (config.NODE_ENV !== "production" ||
      directory !== "/app/sandbox-data" ||
      !config.APP_ORIGIN?.startsWith("https://") ||
      config.DODO_PAYMENTS_ENVIRONMENT !== "test_mode")
  )
    throw new Error(
      "Hosted payment sandbox requires production authentication, HTTPS, test_mode and its own /app/sandbox-data volume.",
    );
  const kind = sandbox
    ? "sandbox"
    : config.NODE_ENV === "production"
      ? "live"
      : "development";
  tx(() => {
    const previous = one("SELECT kind FROM billing_instance WHERE singleton=1");
    if (previous && previous.kind !== kind)
      throw new Error(
        "Payment instance does not match this database. Use a separate data volume.",
      );
    if (
      !previous &&
      sandbox &&
      (one("SELECT id FROM users LIMIT 1") ||
        one("SELECT id FROM projects LIMIT 1") ||
        one("SELECT id FROM orders LIMIT 1"))
    )
      throw new Error(
        "An existing database cannot be converted to a payment sandbox.",
      );
    run("INSERT OR IGNORE INTO billing_instance VALUES (1,?)", kind);
  });
}

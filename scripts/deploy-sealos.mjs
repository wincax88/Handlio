import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const sandbox = env.PAYMENTS_SANDBOX_INSTANCE === "1";
const appName = sandbox ? "handlio-sandbox" : "handlio";
const runtimeName = sandbox ? "handlio-runtime-sandbox" : "handlio-runtime";
const registrySecretName = sandbox
  ? "handlio-registry-sandbox"
  : "handlio-registry";
const namespace = env.SEALOS_NAMESPACE;
const image = env.DEPLOY_IMAGE;
const origin = new URL(env.APP_ORIGIN || "https://invalid.local");
if (
  sandbox &&
  (!env.PRODUCTION_APP_ORIGIN ||
    origin.origin === new URL(env.PRODUCTION_APP_ORIGIN).origin)
)
  throw new Error(
    "The payment sandbox must have an HTTPS origin distinct from the production application.",
  );
if (!namespace || !/^[a-z0-9-]+$/.test(namespace))
  throw new Error("SEALOS_NAMESPACE is required.");
if (
  origin.protocol !== "https:" ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password ||
  origin.hostname === "invalid.local"
) {
  throw new Error(
    "APP_ORIGIN must be an HTTPS origin without a path or credentials.",
  );
}
if (!image || !/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(image))
  throw new Error("A GHCR image digest is required.");
const provider = env.MAIL_PROVIDER || "smtp";
if (!["resend", "smtp"].includes(provider))
  throw new Error("Production MAIL_PROVIDER must be resend or smtp.");
const required = [
  "SESSION_SECRET",
  "MAIL_FROM",
  ...(provider === "resend"
    ? ["RESEND_API_KEY", "MAIL_AUTH_FROM"]
    : ["SMTP_HOST"]),
];
const missing = required.filter((key) => !env[key]);
if (missing.length)
  throw new Error(
    `Configure GitHub Actions secrets before deployment: ${missing.join(", ")}`,
  );
if (env.SESSION_SECRET.length < 32)
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
if (env.BILLING_PROVIDER === "dodo") {
  const dodoMissing = [
    "DODO_PAYMENTS_API_KEY",
    "DODO_PAYMENTS_WEBHOOK_KEY",
    "DODO_PROJECT_PRODUCT_ID",
    "DODO_RENEWAL_PRODUCT_ID",
  ].filter((key) => !env[key]);
  if (dodoMissing.length)
    throw new Error(
      `Configure Dodo Payments before enabling billing: ${dodoMissing.join(", ")}`,
    );
  if (env.DODO_PAYMENTS_ENVIRONMENT !== (sandbox ? "test_mode" : "live_mode"))
    throw new Error(
      "Dodo mode must match the isolated deployment: live_mode for production, test_mode for payment sandbox.",
    );
}
if (sandbox && env.BILLING_PROVIDER !== "dodo")
  throw new Error(
    "The isolated payment sandbox requires BILLING_PROVIDER=dodo.",
  );
if (!/^[0-9]+$/.test(env.SMTP_PORT || "587"))
  throw new Error("SMTP_PORT must be numeric.");
if (!env.SEALOS_TLS_SECRET || !/^[a-z0-9.-]+$/.test(env.SEALOS_TLS_SECRET))
  throw new Error("SEALOS_TLS_SECRET is required.");

// Check long-lived cluster pull access before replacing a working deployment.
// The workflow's temporary GITHUB_TOKEN does not prove anonymous/PAT pull access.
const [registryName, imageDigest] = image.slice("ghcr.io/".length).split("@");
const tokenUrl = new URL("https://ghcr.io/token");
tokenUrl.searchParams.set("service", "ghcr.io");
tokenUrl.searchParams.set("scope", `repository:${registryName}:pull`);
const pullHeaders = {};
if (env.GHCR_READ_TOKEN) {
  if (!env.GHCR_USERNAME)
    throw new Error("GHCR_USERNAME is required for private images.");
  pullHeaders.Authorization = `Basic ${Buffer.from(`${env.GHCR_USERNAME}:${env.GHCR_READ_TOKEN}`).toString("base64")}`;
}
const tokenResponse = await fetch(tokenUrl, {
  headers: pullHeaders,
  signal: AbortSignal.timeout(20000),
});
if (!tokenResponse.ok)
  throw new Error(
    "GHCR pull access denied. Make the package public or configure a valid GHCR_READ_TOKEN with read:packages.",
  );
const pullToken = (await tokenResponse.json()).token;
if (!pullToken) throw new Error("GHCR did not return a pull token.");
const manifestResponse = await fetch(
  `https://ghcr.io/v2/${registryName}/manifests/${imageDigest}`,
  {
    method: "HEAD",
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${pullToken}`,
      Accept:
        "application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json",
    },
  },
);
if (!manifestResponse.ok)
  throw new Error(
    "Published digest is not accessible with the configured cluster pull credentials.",
  );

const work = mkdtempSync(path.join(tmpdir(), "handlio-deploy-"));
function kubectl(args, options = {}) {
  const result = spawnSync(
    "kubectl",
    ["--request-timeout=30s", "-n", namespace, ...args],
    {
      encoding: "utf8",
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(`kubectl ${args[0]} failed.`);
  return result.stdout?.trim();
}
try {
  // Refuse a namespace mismatch rather than deploying into a surprising target.
  const contextNamespace = kubectl(
    [
      "config",
      "view",
      "--minify",
      "-o",
      "jsonpath={.contexts[0].context.namespace}",
    ],
    { capture: true },
  );
  if (contextNamespace !== namespace)
    throw new Error(
      "Kubeconfig context namespace differs from SEALOS_NAMESPACE.",
    );
  if (sandbox) {
    const ingresses = JSON.parse(
      kubectl(["get", "ingress", "-o", "json"], { capture: true }),
    );
    if (
      ingresses.items.some(
        (item) =>
          item.metadata.name !== appName &&
          item.spec.rules?.some((rule) => rule.host === origin.hostname),
      )
    )
      throw new Error(
        "The sandbox origin is already used by another application ingress.",
      );
    const existing = kubectl(
      ["get", "deployment", appName, "--ignore-not-found", "-o", "json"],
      { capture: true },
    );
    if (
      existing &&
      !JSON.parse(existing).spec.template.spec.volumes.some(
        (v) => v.persistentVolumeClaim?.claimName === "handlio-data-sandbox",
      )
    )
      throw new Error(
        "Refuse sandbox deployment without its independent data volume.",
      );
  }
  const runtime = {
    SESSION_SECRET: sandbox
      ? createHmac("sha256", env.SESSION_SECRET)
          .update("handlio-payment-sandbox")
          .digest("hex")
      : env.SESSION_SECRET,
    APP_ORIGIN: origin.origin,
    MAIL_PROVIDER: provider,
    SMTP_PORT: env.SMTP_PORT || "587",
    MAIL_FROM: env.MAIL_FROM,
  };
  for (const key of [
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "MAIL_AUTH_FROM",
    "MAIL_REPLY_TO",
    "SUPPORT_EMAIL",
    "OPS_EMAILS",
    "BILLING_ADAPTER_URL",
    "BILLING_ADAPTER_TOKEN",
    "BILLING_WEBHOOK_SECRET",
    "BILLING_PROVIDER",
    "DODO_PAYMENTS_ENVIRONMENT",
    "DODO_PAYMENTS_API_KEY",
    "DODO_PAYMENTS_WEBHOOK_KEY",
    "DODO_PROJECT_PRODUCT_ID",
    "DODO_RENEWAL_PRODUCT_ID",
    "AI_ADAPTER_URL",
    "AI_ADAPTER_TOKEN",
    "AI_PRIVACY_NOTICE",
    "AI_MAX_STEP_COST_USD",
    "AI_DAILY_BUDGET_USD",
    "BACKUP_KEY",
    "BACKUP_DIRECTORY",
    "OPERATOR_NAME",
    "OPERATOR_REGION",
    "DATA_HOSTING_REGION",
  ]) {
    if (
      sandbox &&
      (key.startsWith("AI_") ||
        key.startsWith("BACKUP_") ||
        key.startsWith("BILLING_ADAPTER") ||
        key === "BILLING_WEBHOOK_SECRET")
    )
      continue;
    if (env[key]) runtime[key] = env[key];
  }
  if (sandbox) runtime.PAYMENTS_SANDBOX_INSTANCE = "1";
  const secretPath = path.join(work, "runtime.json");
  writeFileSync(
    secretPath,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Secret",
      type: "Opaque",
      metadata: { name: runtimeName, namespace },
      stringData: runtime,
    }),
    { mode: 0o600 },
  );

  copyFileSync(
    path.join(root, "deploy/sealos/resources.yaml"),
    path.join(work, "resources.yaml"),
  );
  const [newName, digest] = image.split("@");
  const patches = [
    {
      target: { kind: "Ingress", name: "handlio" },
      patch: JSON.stringify([
        { op: "replace", path: "/spec/rules/0/host", value: origin.hostname },
        { op: "replace", path: "/spec/tls/0/hosts/0", value: origin.hostname },
        {
          op: "replace",
          path: "/spec/tls/0/secretName",
          value: env.SEALOS_TLS_SECRET,
        },
      ]),
    },
  ];
  if (sandbox) {
    patches.push({
      target: { kind: "Deployment", name: "handlio" },
      patch: JSON.stringify([
        {
          op: "replace",
          path: "/spec/template/spec/containers/0/envFrom/0/secretRef/name",
          value: runtimeName,
        },
        {
          op: "replace",
          path: "/spec/template/spec/containers/0/env/2/value",
          value: "/app/sandbox-data",
        },
        {
          op: "replace",
          path: "/spec/template/spec/containers/0/volumeMounts/0/mountPath",
          value: "/app/sandbox-data",
        },
      ]),
    });
    patches.push({
      target: { kind: "PersistentVolumeClaim", name: "handlio-data" },
      patch: JSON.stringify([
        {
          op: "replace",
          path: "/spec/resources/requests/storage",
          value: "1Gi",
        },
      ]),
    });
  }
  if (env.GHCR_READ_TOKEN) {
    if (!env.GHCR_USERNAME)
      throw new Error("GHCR_USERNAME is required for private images.");
    const auth = Buffer.from(
      `${env.GHCR_USERNAME}:${env.GHCR_READ_TOKEN}`,
    ).toString("base64");
    const registryPath = path.join(work, "registry.json");
    writeFileSync(
      registryPath,
      JSON.stringify({
        apiVersion: "v1",
        kind: "Secret",
        type: "kubernetes.io/dockerconfigjson",
        metadata: { name: registrySecretName, namespace },
        stringData: {
          ".dockerconfigjson": JSON.stringify({
            auths: { "ghcr.io": { auth } },
          }),
        },
      }),
      { mode: 0o600 },
    );
    kubectl([
      "apply",
      "--server-side",
      "--field-manager=handlio-actions",
      "-f",
      registryPath,
    ]);
    patches.push({
      target: { kind: "Deployment", name: "handlio" },
      patch: JSON.stringify([
        {
          op: "add",
          path: "/spec/template/spec/imagePullSecrets",
          value: [{ name: registrySecretName }],
        },
      ]),
    });
  }
  // Re-running a job keeps its run ID; include the attempt so changed secrets reload.
  patches.push({
    target: { kind: "Deployment", name: "handlio" },
    patch: JSON.stringify([
      {
        op: "add",
        path: "/spec/template/metadata/annotations",
        value: {
          "handlio.io/deployment-run": env.GITHUB_RUN_ID
            ? `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || "1"}`
            : `${Date.now()}`,
        },
      },
    ]),
  });
  writeFileSync(
    path.join(work, "kustomization.yaml"),
    JSON.stringify({
      apiVersion: "kustomize.config.k8s.io/v1beta1",
      kind: "Kustomization",
      namespace,
      ...(sandbox
        ? {
            nameSuffix: "-sandbox",
            commonLabels: {
              app: "handlio-sandbox",
              "cloud.sealos.io/app-deploy-manager": "handlio-sandbox",
            },
          }
        : {}),
      resources: ["resources.yaml"],
      images: [{ name: "ghcr.io/wincax88/handlio", newName, digest }],
      patches,
    }),
  );
  kubectl(["apply", "--dry-run=server", "-k", work]);
  // Server-side apply avoids copying secret values into last-applied annotations.
  kubectl([
    "apply",
    "--server-side",
    "--field-manager=handlio-actions",
    "-f",
    secretPath,
  ]);
  kubectl(["apply", "-k", work]);
  kubectl([
    "rollout",
    "status",
    `deployment/${appName}`,
    "--timeout=600s",
    "--request-timeout=0",
  ]);
  let healthy = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch(`${origin.origin}/api/health`, {
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      const health = await response.json();
      if (response.ok && health.ok === true && health.version === "0.1.0") {
        healthy = true;
        break;
      }
    } catch {
      /* Wait briefly for ingress propagation; never disable TLS checks. */
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!healthy)
    throw new Error(
      "Public HTTPS health check failed; inspect the ingress and deployment.",
    );
  console.log(`Deployment verified: ${origin.origin}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

import DodoPayments from "dodopayments";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const testWebhookUrl =
  "https://handlio-test-fd5llv5c.cloud.sealos.io/api/webhooks/dodo";
export const requiredEvents = [
  "payment.succeeded",
  "payment.failed",
  "refund.succeeded",
  "dispute.opened",
  "dispute.won",
  "dispute.lost",
  "dispute.cancelled",
];
const signingBytes = (value: string) =>
  Buffer.from(value.trim().replace(/^whsec_/, ""), "base64");
const sameKey = (a: string, b: string) =>
  timingSafeEqual(
    createHash("sha256").update(signingBytes(a)).digest(),
    createHash("sha256").update(signingBytes(b)).digest(),
  );

export async function verifyDodoWebhook(
  sdk: Pick<DodoPayments, "webhooks">,
  configuredSecret: string,
  request: typeof fetch = fetch,
) {
  if (!configuredSecret || signingBytes(configuredSecret).length === 0)
    throw new Error("Missing or invalid DODO_PAYMENTS_WEBHOOK_KEY.");
  let found = false,
    active = false,
    matching:
      Awaited<ReturnType<DodoPayments["webhooks"]["retrieve"]>> | undefined;
  let scanned = 0;
  for await (const endpoint of sdk.webhooks.list()) {
    if (++scanned > 100) throw new Error("Endpoint search limit exceeded.");
    if (endpoint.url.replace(/\/$/, "") !== testWebhookUrl) continue;
    found = true;
    if (endpoint.disabled) continue;
    active = true;
    const key = await sdk.webhooks.retrieveSecret(endpoint.id);
    if (sameKey(key.secret, configuredSecret)) {
      matching = endpoint;
      break;
    }
  }
  if (!found)
    throw new Error(
      "No Dodo TEST MODE endpoint matches the Sealos test webhook URL.",
    );
  if (!active) throw new Error("The Dodo test webhook endpoint is disabled.");
  if (!matching)
    throw new Error(
      "GitHub DODO_PAYMENTS_WEBHOOK_KEY does not match the current Dodo endpoint Signing secret.",
    );
  const filters = matching.filter_types;
  const missing = filters?.length
    ? requiredEvents.filter((type) => !filters.includes(type))
    : [];
  if (missing.length)
    throw new Error(`Missing webhook subscriptions: ${missing.join(", ")}`);
  const sessionResponse = await request(
    "https://handlio-test-fd5llv5c.cloud.sealos.io/api/session",
    { signal: AbortSignal.timeout(15000), redirect: "error" },
  );
  const session = await sessionResponse.json();
  if (
    !sessionResponse.ok ||
    session.paymentEnvironment !== "sandbox" ||
    !session.billingEnabled ||
    session.localMode
  )
    throw new Error(
      "The target must be the authenticated hosted sandbox instance.",
    );

  // This verified but deliberately unrelated event is ignored by the billing handler.
  // It does not enter the payment queue, create a checkout, or change an order/grant.
  const timestamp = String(Math.floor(Date.now() / 1000));
  const eventId = `handlio-config-check-${randomUUID()}`;
  const body = JSON.stringify({
    business_id: "handlio-test-verification",
    type: "handlio.verification",
    timestamp: new Date().toISOString(),
    data: {},
  });
  const signature = createHmac("sha256", signingBytes(configuredSecret))
    .update(`${eventId}.${timestamp}.${body}`)
    .digest("base64");
  const response = await request(testWebhookUrl, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      "content-type": "application/json",
      "webhook-id": eventId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body,
  });
  const result = await response.json();
  if (response.status !== 200 || result.received !== true)
    throw new Error(
      "Signed webhook verification failed. Refresh the sandbox deployment after updating the Signing secret.",
    );
  return {
    endpointEnabled: true,
    subscriptionsVerified: true,
    signingKeyMatches: true,
    signedRequestStatus: response.status,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  if (process.env.DODO_PAYMENTS_ENVIRONMENT !== "test_mode")
    throw new Error("Verification is restricted to Dodo test_mode.");
  const sdk = new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY,
    environment: "test_mode",
    timeout: 15000,
    maxRetries: 0,
  });
  try {
    console.log(
      JSON.stringify(
        await verifyDodoWebhook(
          sdk,
          process.env.DODO_PAYMENTS_WEBHOOK_KEY || "",
        ),
      ),
    );
    console.log(
      "Dodo endpoint configuration and real signed delivery verified. No payment state was changed.",
    );
  } catch (error) {
    console.error(
      error instanceof Error && error.constructor === Error
        ? error.message
        : "Dodo API verification unavailable. Check Test Mode API permissions and connectivity.",
    );
    process.exitCode = 1;
  }
}

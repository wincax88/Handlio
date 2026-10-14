import { expect, test, vi } from "vitest";
import DodoPayments from "dodopayments";
import {
  requiredEvents,
  testWebhookUrl,
  verifyDodoWebhook,
} from "../scripts/verify-dodo-webhook";
const secret = `whsec_${Buffer.from("fake-signing-key-for-unit-tests-only").toString("base64")}`;
const otherSecret = `whsec_${Buffer.from("different-fake-unit-test-signing-key").toString("base64")}`;
const endpoint = () => ({
  id: "whk_test",
  url: testWebhookUrl,
  disabled: false,
  filter_types: [...requiredEvents],
});
function client(rows: any[], returnedSecret = secret) {
  return {
    webhooks: {
      list: () =>
        (async function* () {
          yield* rows;
        })(),
      retrieveSecret: vi.fn(async () => ({ secret: returnedSecret })),
    },
  } as unknown as Pick<DodoPayments, "webhooks">;
}
function requester(context = "sandbox", callbackStatus = 200) {
  return vi.fn(async (_url: any, options?: RequestInit) => {
    if (options?.method !== "POST")
      return new Response(
        JSON.stringify({
          paymentEnvironment: context,
          billingEnabled: true,
          localMode: false,
        }),
        { status: 200 },
      );
    const verifier = new DodoPayments({
      bearerToken: "unit-test-key",
      environment: "test_mode",
      webhookKey: secret,
    });
    const decoded = verifier.webhooks.unwrap(String(options.body), {
      headers: options.headers as Record<string, string>,
    });
    expect(decoded).toMatchObject({ type: "handlio.verification", data: {} });
    expect((decoded as any).data.payment_id).toBeUndefined();
    return new Response(JSON.stringify({ received: callbackStatus === 200 }), {
      status: callbackStatus,
    });
  }) as unknown as typeof fetch;
}
test("checks the current endpoint and key, then delivers an ignored signed event accepted by the official SDK", async () => {
  const http = requester();
  const result = await verifyDodoWebhook(client([endpoint()]), secret, http);
  expect(result).toEqual({
    endpointEnabled: true,
    subscriptionsVerified: true,
    signingKeyMatches: true,
    signedRequestStatus: 200,
  });
  expect(http).toHaveBeenLastCalledWith(
    testWebhookUrl,
    expect.objectContaining({ method: "POST", redirect: "error" }),
  );
});
test("rejects absent endpoints without sending any probe", async () => {
  const http = requester();
  await expect(verifyDodoWebhook(client([]), secret, http)).rejects.toThrow(
    "No Dodo TEST MODE endpoint",
  );
  expect(http).not.toHaveBeenCalled();
});
test("rejects disabled endpoints without fetching a key or sending a probe", async () => {
  const sdk = client([{ ...endpoint(), disabled: true }]),
    http = requester();
  await expect(verifyDodoWebhook(sdk, secret, http)).rejects.toThrow(
    "disabled",
  );
  expect(sdk.webhooks.retrieveSecret).not.toHaveBeenCalled();
  expect(http).not.toHaveBeenCalled();
});
test("rejects a different signing key without disclosing either key", async () => {
  const http = requester();
  await expect(
    verifyDodoWebhook(client([endpoint()], otherSecret), secret, http),
  ).rejects.toThrow("does not match");
  expect(http).not.toHaveBeenCalled();
});
test("requires refund and dispute subscriptions", async () => {
  const http = requester();
  await expect(
    verifyDodoWebhook(
      client([{ ...endpoint(), filter_types: ["payment.succeeded"] }]),
      secret,
      http,
    ),
  ).rejects.toThrow("Missing webhook subscriptions");
  expect(http).not.toHaveBeenCalled();
});
test("refuses to send a signed probe to an instance reporting production billing", async () => {
  const http = requester("production");
  await expect(
    verifyDodoWebhook(client([endpoint()]), secret, http),
  ).rejects.toThrow("hosted sandbox");
  expect(http).toHaveBeenCalledTimes(1);
});
test("reports stale deployed keys when the signed delivery is rejected", async () => {
  await expect(
    verifyDodoWebhook(client([endpoint()]), secret, requester("sandbox", 401)),
  ).rejects.toThrow("Refresh the sandbox deployment");
});
test("accepts an endpoint subscribed to all events and normalizes the optional trailing slash", async () => {
  await expect(
    verifyDodoWebhook(
      client([{ ...endpoint(), url: `${testWebhookUrl}/`, filter_types: [] }]),
      secret,
      requester(),
    ),
  ).resolves.toMatchObject({ signingKeyMatches: true });
});

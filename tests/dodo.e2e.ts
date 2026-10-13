import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("hosted checkout return stays pending until server verification and shows a test invoice", async ({
  page,
  browserName,
}) => {
  await page.goto("/auth");
  await page
    .getByLabel("Email address")
    .fill(`dodo-ui-${browserName}-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page
    .getByLabel("Verification code")
    .fill((await page.locator(".notice strong").textContent())!);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make it your workspace." }),
  ).toBeVisible();
  await page.getByLabel("Your display name").fill("Alex Morgan");
  await page
    .getByLabel("Workspace name", { exact: true })
    .fill("Dodo Test Studio");
  await page
    .getByLabel("Support email", { exact: true })
    .fill("support@example.test");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next handoff, made clear." }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  const created = await page.request.post("/api/projects", {
    headers: {
      "X-CSRF-Token": session.user.csrf,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      name: "Dodo demo",
      clientName: "Demo Client",
      title: "Demo Handbook",
      template: "blank",
    },
  });
  expect(created.ok()).toBe(true);
  const projectId = (await created.json()).id;
  const project = await (
    await page.request.get(`/api/projects/${projectId}`)
  ).json();
  // Browser contract test: the native SDK and signatures are exercised separately in dodo.test.ts.
  const orderId = "dodo-ui-order",
    checkoutUrl = "https://test.checkout.dodopayments.com/session/cks_ui";
  await page.route("**/api/session", async (route) =>
    route.fulfill({
      json: {
        ...session,
        localMode: false,
        paymentEnvironment: "sandbox",
        billingEnabled: true,
      },
    }),
  );
  await page.route("**/api/billing", async (route) =>
    route.fulfill({
      json: {
        pricing: { project: 1900, renewal: 900, currency: "USD" },
        orders: [],
        grants: [],
        provider: { name: "Dodo Payments", mode: "test", configured: true },
      },
    }),
  );
  let requestBody: any;
  await page.route("**/api/billing/checkouts", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({ json: { orderId, url: checkoutUrl } });
  });
  await page.route(`${checkoutUrl}**`, async (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Dodo test checkout</h1>",
    }),
  );
  let verified = false;
  const detail = () => ({
    id: orderId,
    project_id: projectId,
    projectName: "Dodo demo",
    product: "project",
    amount: 1900,
    currency: "USD",
    status: verified ? "paid" : "pending",
    entitlement: verified
      ? {
          ...project.entitlement,
          state: "paid_active",
          expiresAt: Date.now() + 90 * 86400000,
        }
      : project.entitlement,
    paid_at: verified ? Date.now() : null,
    provider: { name: "Dodo Payments", mode: "test" },
    chargedTotal: verified ? 2090 : null,
    receipt: verified
      ? {
          tax: 190,
          invoice_number: "INV-TEST-UI",
          receipt_url: "https://receipts.example.test/invoice.pdf",
        }
      : null,
  });
  await page.route(`**/api/billing/orders/${orderId}`, async (route) =>
    route.fulfill({ json: detail() }),
  );
  await page.route(`**/api/billing/orders/${orderId}/check`, async (route) =>
    route.fulfill({ json: { status: "pending" } }),
  );
  await page.goto(`/app/billing?project=${projectId}`);
  await expect(
    page.getByText(/Dodo Payments test mode · Test payments/),
  ).toBeVisible();
  await expect(page.locator(".local-banner")).toContainText("Test workspace");
  await page
    .getByRole("button", { name: "Continue to checkout", exact: true })
    .click();
  await expect(page).toHaveURL(checkoutUrl);
  expect(requestBody).toEqual({ projectId, product: "project" });
  await page.goto(
    `http://localhost:5183/app/payment/${orderId}?status=succeeded&payment_id=untrusted`,
  );
  await expect(
    page.getByRole("heading", { name: "One more check before access." }),
  ).toBeVisible();
  await expect(page.getByText(/Dodo Payments test order/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue to publish checks" }),
  ).toHaveCount(0);
  verified = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your project pack is active." }),
  ).toBeVisible();
  await expect(page.getByText("$20.90", { exact: true })).toBeVisible();
  await expect(page.getByText("$1.90", { exact: true })).toBeVisible();
  await expect(page.getByText("INV-TEST-UI", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Provider receipt" }),
  ).toHaveAttribute("href", "https://receipts.example.test/invoice.pdf");
  await expect(page.getByText(/Local development order/)).toHaveCount(0);
  mkdirSync(".work/screenshots", { recursive: true });
  await page.screenshot({
    path: `.work/screenshots/dodo-payment-${browserName}.png`,
    fullPage: true,
  });
});

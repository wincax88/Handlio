import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
test("creator workflow, immutable release, client receipt and responsive reading", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  mkdirSync(".work/screenshots", { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("app-runtime-error:", e.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      console.error("app-console-error:", message.text());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Great work deserves/ }),
  ).toBeVisible();
  await page.screenshot({
    path: ".work/screenshots/landing.png",
    fullPage: true,
  });
  const email = `ui-${Date.now()}@example.test`;
  await page.getByRole("link", { name: "Start a free draft" }).click();
  await page.screenshot({ path: ".work/screenshots/auth.png", fullPage: true });
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send verification code" }).click();
  const code = await page.locator(".notice strong").textContent();
  await page.getByLabel("Verification code").fill(code!);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your next handoff, made clear." }),
  ).toBeVisible();
  await page.screenshot({
    path: ".work/screenshots/projects-empty.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Create your first project" }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Northstar website handoff");
  await page.getByLabel("Client name", { exact: true }).fill("Harbor Demo");
  await page
    .getByLabel("Handbook title", { exact: true })
    .fill("Your website, in good hands.");
  await page.getByRole("button", { name: /A blank canvas/ }).click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Northstar website handoff",
      exact: true,
    }),
  ).toBeVisible();
  const pid = /projects\/([^/]+)/.exec(page.url())![1];
  await page.screenshot({
    path: ".work/screenshots/overview.png",
    fullPage: true,
  });
  const session = await (await page.request.get("/api/session")).json();
  const headers = {
    "X-CSRF-Token": session.user.csrf,
    "Idempotency-Key": crypto.randomUUID(),
  };
  let project = await (await page.request.get(`/api/projects/${pid}`)).json();
  const draft = project.draft;
  draft.intro =
    "Everything you need to manage your new website. Start here to update content, preview changes, and know when to ask for help.";
  draft.supportEmail = "support@example.test";
  draft.maintenance =
    "Content updates are included. New features and structural changes require a separate project.";
  const guide = draft.guides[0];
  guide.title = "Managing your website content";
  guide.goal = "Update a page and review your changes before they go live.";
  guide.prerequisites =
    "You already have content-editor access. Never share your password in this manual.";
  guide.audience = "Website content editors";
  guide.completion = "Your updated page is visible in the preview.";
  guide.steps = [
    {
      id: crypto.randomUUID(),
      title: "Open the content editor",
      body: "Open the content list in your authorized website admin. Select the page you want to update.",
      expected: "The selected page is open in the editor.",
      warning: "Keep a copy of important text before making large changes.",
      source: "Owner-only note",
      alt: "",
      assetId: null,
      reviewed: true,
      textOnly: true,
      aiPending: false,
    },
    {
      id: crypto.randomUUID(),
      title: "Preview your update",
      body: "After editing, choose Preview. Check the title, body copy, and any image captions before publishing.",
      expected: "A preview shows the latest saved changes.",
      warning: "",
      source: "",
      alt: "",
      assetId: null,
      reviewed: true,
      textOnly: true,
      aiPending: false,
    },
  ];
  draft.checklist.forEach((c: any) => (c.done = true));
  expect(
    (
      await page.request.patch(`/api/projects/${pid}/draft`, {
        headers,
        data: { baseRevision: project.revision, draft },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("link", { name: "Guides", exact: true }).click();
  await expect(page.getByLabel("Step title")).toHaveValue(
    "Open the content editor",
  );
  await page
    .getByLabel("Instruction", { exact: true })
    .fill(
      "Open the content list in your authorized website admin. Select the page you want to update.",
    );
  await page.screenshot({
    path: ".work/screenshots/editor.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Back to project", exact: true })
    .click();
  await page.getByRole("link", { name: "Handbook", exact: true }).click();
  await page.getByRole("button", { name: "Run publishing check" }).click();
  await page.screenshot({
    path: ".work/screenshots/handbook.png",
    fullPage: true,
  });
  await expect(
    page.getByText("Activate this project package before publishing.", {
      exact: true,
    }),
  ).toBeVisible();
  const co = await (
    await page.request.post("/api/billing/checkouts", {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { projectId: pid, product: "project" },
    })
  ).json();
  expect(
    (
      await page.request.post("/api/billing/local-confirm", {
        headers,
        data: { orderId: co.orderId },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("link", { name: "Versions", exact: true }).click();
  await page
    .getByLabel("What changed?")
    .fill("Initial client website handoff.");
  await page.getByRole("button", { name: "Check saved draft" }).click();
  await expect(
    page.getByText("All publishing checks passed", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await expect(
    page.getByText("Current · published", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("link", { name: "Handoff", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable sharing", exact: true })
    .click();
  await expect(page.getByText("Client access is enabled")).toBeVisible();
  const clientEmail = `client-${Date.now()}@example.test`;
  await page.getByLabel("Client email", { exact: true }).fill(clientEmail);
  await page.getByRole("button", { name: "Send private invitation" }).click();
  await expect(
    page.getByText(clientEmail, { exact: true }).first(),
  ).toBeVisible();
  const inviteUrl = await page
    .getByRole("link", { name: /Open in a separate browser session/ })
    .getAttribute("href");
  await page.getByLabel(clientEmail, { exact: true }).check();
  await page.getByRole("button", { name: "Request receipt of v1" }).click();
  await expect(page.getByText("0 / 1 required confirmations")).toBeVisible();
  await page.screenshot({
    path: ".work/screenshots/handoff.png",
    fullPage: true,
  });
  project = await (await page.request.get(`/api/projects/${pid}`)).json();
  const clientContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
  });
  const client = await clientContext.newPage();
  await client.goto(inviteUrl!);
  await client.getByLabel("Email address").fill(clientEmail);
  await client.getByRole("button", { name: "Send verification code" }).click();
  const clientCode = await client.locator(".notice strong").textContent();
  await client.getByLabel("Verification code").fill(clientCode!);
  await client
    .getByRole("button", { name: "Verify email", exact: true })
    .click();
  await expect(
    client.getByRole("heading", { name: "Your website, in good hands." }),
  ).toBeVisible();
  expect(
    await client.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await client.screenshot({
    path: ".work/screenshots/reader-mobile.png",
    fullPage: true,
  });
  await client
    .locator("#client-feedback")
    .getByRole("button", { name: "Ask a question", exact: true })
    .click();
  await client
    .getByLabel("Your question", { exact: true })
    .fill("Can I preview before publishing?");
  await client
    .getByRole("button", { name: "Submit question", exact: true })
    .click();
  await expect(
    client.getByText("Your question is attached to this version.", {
      exact: true,
    }),
  ).toBeVisible();
  await client.getByRole("checkbox", { name: /I reviewed version v1/ }).check();
  await client
    .getByRole("button", { name: "Confirm receipt of version v1", exact: true })
    .click();
  await expect(
    client.getByRole("heading", { name: "You confirmed receipt of v1" }),
  ).toBeVisible();
  await client.setViewportSize({ width: 1200, height: 950 });
  await client.keyboard.press("Control+Home");
  await client.screenshot({
    path: ".work/screenshots/reader-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByText("1 / 1 required confirmations")).toBeVisible();
  await page.getByRole("link", { name: "Exports", exact: true }).click();
  await page.getByRole("button", { name: /Offline HTML ZIP/ }).click();
  await page
    .getByRole("button", { name: "Generate export", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const downloadUrl = await page
    .getByRole("link", { name: "Download", exact: true })
    .getAttribute("href");
  expect(downloadUrl).toMatch(/^\/api\/jobs\/[^/]+\/download$/);
  const download = await page.request.get(downloadUrl!, { timeout: 15000 });
  expect(download.ok()).toBe(true);
  expect((await download.body()).subarray(0, 2).toString()).toBe("PK");
  await clientContext.close();
  await page
    .getByRole("link", { name: "Billing & usage", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Billing & usage", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".work/screenshots/billing.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

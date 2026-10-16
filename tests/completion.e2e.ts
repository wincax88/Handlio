import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
async function signIn(
  page: Page,
  email = `completion-ui-${Date.now()}@example.test`,
) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page
    .getByLabel("Verification code")
    .fill((await page.locator(".notice strong").textContent())!);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make it your workspace." }),
  ).toBeVisible();
  await page.getByLabel("Your display name").fill("Alex Morgan");
  await page.getByLabel("Workspace name", { exact: true }).fill("Pine Studio");
  await page
    .getByLabel("Support email", { exact: true })
    .fill("support@example.test");
  await page.getByLabel("Display time zone").selectOption("Asia/Shanghai");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next handoff, made clear." }),
  ).toBeVisible();
}
async function readyProject(page: Page, existingProjectId?: string) {
  const session = (await (await page.request.get("/api/session")).json()).user;
  async function call(url: string, data: any, method = "POST") {
    const response = await page.request.fetch(`/api${url}`, {
      method,
      headers: {
        "X-CSRF-Token": session.csrf,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const created = existingProjectId
    ? { id: existingProjectId }
    : await call("/projects", {
        name: "Northstar completion",
        clientName: "Northstar Studio",
        title: "Northstar operations",
        template: "blank",
      });
  const get = async () =>
    (await page.request.get(`/api/projects/${created.id}`)).json();
  let project = await get();
  const draft = project.draft;
  Object.assign(draft, {
    intro: "A fictional operations handbook.",
    supportEmail: "support@example.test",
    maintenance: "Contact the studio before changing the website structure.",
  });
  Object.assign(draft.guides[0], {
    title: "Update content",
    goal: "Review an update",
    prerequisites: "Editor access",
    audience: "Content editors",
    completion: "The preview is correct",
    steps: [
      {
        id: "step-preview",
        title: "Preview before publishing",
        body: "Open Preview before publishing.",
        expected: "The updated content appears in preview.",
        warning: "",
        source: "",
        alt: "",
        assetId: null,
        textOnly: true,
        reviewed: true,
        aiPending: false,
      },
    ],
  });
  draft.checklist.forEach((item: any) => (item.done = true));
  await call(
    `/projects/${created.id}/draft`,
    { baseRevision: project.revision, draft },
    "PATCH",
  );
  const order = await call("/billing/checkouts", {
    projectId: created.id,
    product: "project",
  });
  await call("/billing/local-confirm", { orderId: order.orderId });
  async function publish(summary: string) {
    const check = await call(`/projects/${created.id}/validate`, {});
    await call(`/projects/${created.id}/releases`, {
      draftRevision: check.revision,
      validationId: check.id,
      summary,
      warningReason: "",
    });
    await expect
      .poll(async () => (await get()).currentRelease?.summary)
      .toBe(summary);
    return (await get()).currentRelease;
  }
  const release = await publish("Initial fictional handoff");
  await call(`/projects/${created.id}`, { sharing: true }, "PATCH");
  return {
    id: created.id,
    get,
    call,
    publish,
    release,
    orderId: order.orderId,
  };
}
test("DeepSeek suggestions require consent and stay pending review after acceptance", async ({
  page,
}) => {
  await signIn(page);
  const project = await readyProject(page);
  const session = (await (await page.request.get("/api/session")).json()).user;
  const sharp = (await import("sharp")).default;
  const image = await sharp({
    create: { width: 64, height: 32, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const uploaded = await page.request.post(
    `/api/projects/${project.id}/assets`,
    {
      headers: {
        "X-CSRF-Token": session.csrf,
        "Idempotency-Key": crypto.randomUUID(),
        "X-Sanitized": "true",
        "Content-Type": "image/png",
      },
      data: image,
    },
  );
  expect(uploaded.ok()).toBe(true);
  const current = await project.get();
  current.draft.guides[0].steps[0].assetId = (await uploaded.json()).id;
  current.draft.guides[0].steps[0].textOnly = false;
  await project.call(
    `/projects/${project.id}/draft`,
    { draft: current.draft, baseRevision: current.revision },
    "PATCH",
  );
  await page.route("**/api/session", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...(await response.json()),
        aiEnabled: true,
        aiProvider: "deepseek",
        aiNotice: "Selected screenshots are sent to DeepSeek.",
      },
    });
  });
  await page.route(`**/api/projects/${project.id}/ai-jobs`, async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      stepIds: ["step-preview"],
      consent: true,
    });
    await route.fulfill({
      status: 202,
      json: { jobId: "fictional-deepseek-ui-job" },
    });
  });
  await page.route("**/api/jobs/fictional-deepseek-ui-job", (route) =>
    route.fulfill({
      json: {
        state: "succeeded",
        output: {
          suggestions: [
            {
              sourceStepId: "step-preview",
              title: "Inspect the preview",
              body: "Open Preview and check the page.",
              expected: "Review the displayed page.",
              missing: ["Saving is not shown in this screenshot."],
            },
          ],
        },
      },
    }),
  );
  await page.goto(`/app/projects/${project.id}/guides`);
  await expect(
    page.getByRole("heading", { name: "Draft with DeepSeek" }),
  ).toBeVisible();
  const generate = page.getByRole("button", {
    name: "Generate suggestion",
    exact: true,
  });
  await expect(generate).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: /I agree to send this processed screenshot/,
    })
    .check();
  await generate.click();
  await expect(
    page.getByText("Needs review: Saving is not shown in this screenshot."),
  ).toBeVisible();
  expect((await project.get()).draft.guides[0].steps[0].title).toBe(
    "Preview before publishing",
  );
  await page
    .getByRole("button", { name: "Accept for review", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Step title", exact: true }),
  ).toHaveValue("Inspect the preview");
  await expect(
    page.getByRole("checkbox", { name: /I’ve checked this step/ }),
  ).not.toBeChecked();
  await expect
    .poll(async () => (await project.get()).draft.guides[0].steps[0].aiPending)
    .toBe(true);
  await page.getByRole("checkbox", { name: /I’ve checked this step/ }).check();
  await expect
    .poll(async () => (await project.get()).draft.guides[0].steps[0].aiPending)
    .toBe(false);
});

test("project language, time zone and fixed chapter titles and order persist in exact releases", async ({
  page,
  browserName,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("same key"))
      errors.push(message.text());
  });
  await signIn(page);
  await page.goto("/app/projects/new");
  await expect(
    page.getByLabel("Project time zone", { exact: true }),
  ).toHaveValue("Asia/Shanghai");
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Locale chapters");
  await page
    .getByLabel("Client name", { exact: true })
    .fill("Fictional client");
  await page.getByRole("button", { name: /A blank canvas/ }).click();
  await page
    .getByLabel("Project content language", { exact: true })
    .fill("zh-CN");
  await page
    .getByLabel("Project time zone", { exact: true })
    .fill("America/New_York");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/app\/projects\/new$/);
  await expect(page).toHaveURL(/\/app\/projects\/[^/]+$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const project = await readyProject(page, id);
  const original = project.release;
  await page.goto(`/app/projects/${id}/handbook`);
  await page
    .getByLabel("Project time zone", { exact: true })
    .fill("Invalid/Zone");
  await page
    .getByRole("button", { name: "Apply language & time zone", exact: true })
    .click();
  await expect(
    page.getByText(
      "Enter a valid language tag and time zone before applying.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel("Project content language", { exact: true }).fill("fr");
  await page
    .getByLabel("Project time zone", { exact: true })
    .fill("Europe/Paris");
  await page
    .getByRole("button", { name: "Apply language & time zone", exact: true })
    .click();
  for (const [label, title] of [
    ["Rename Project overview", "Project context"],
    ["Rename Handoff checklist", "Delivery checklist"],
    ["Rename Support & maintenance", "Help & care"],
  ]) {
    await page.getByRole("textbox", { name: label, exact: true }).fill(title);
    await page
      .getByRole("textbox", { name: label, exact: true })
      .press("Enter");
  }
  for (let i = 0; i < 2; i++)
    await page
      .getByRole("button", { name: "Move Help & care up", exact: true })
      .click();
  for (let i = 0; i < 2; i++)
    await page
      .getByRole("button", { name: "Move Project context down", exact: true })
      .click();
  const expected = [
    "support",
    `guide:${original.snapshot.guides[0].id}`,
    "overview",
    "checklist",
  ];
  await expect
    .poll(async () => (await project.get()).draft.sectionOrder)
    .toEqual(expected);
  expect((await project.get()).currentRelease.hash).toBe(original.hash);
  expect((await project.get()).currentRelease.snapshot.timezone).toBe(
    "America/New_York",
  );
  await page.reload();
  await expect(
    page.getByLabel("Project time zone", { exact: true }),
  ).toHaveValue("Europe/Paris");
  await expect(
    page.getByRole("textbox", { name: "Rename Project overview", exact: true }),
  ).toHaveValue("Project context");
  await page.screenshot({
    path: `.work/screenshots/project-chapters-${browserName}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".manual")).toHaveAttribute("lang", "fr");
  await expect(page.locator(".manual-guide h2")).toHaveText([
    "Help & care",
    "Update content",
    "Project context",
    "Delivery checklist",
  ]);
  const released = await project.publish(
    "Updated project language and chapters",
  );
  const p = await project.get();
  await page.goto(`/h/${p.publicId}`);
  await expect(page.locator(".manual")).toHaveAttribute("lang", "fr");
  await expect(page.locator(".reader-outline nav a")).toHaveText([
    "Help & care",
    "01Update content",
    "Project context",
    "Delivery checklist",
  ]);
  expect(released.snapshot.sectionOrder).toEqual(expected);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto(`/h/${p.publicId}?release=${original.id}`);
  await expect(page.locator(".manual")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator(".manual-guide h2")).toHaveText([
    "Project overview",
    "Update content",
    "Handoff checklist",
    "Support & maintenance",
  ]);
  expect(errors).toEqual([]);
});

test("public examples, onboarding, account preferences and temporary support authorization", async ({
  page,
}) => {
  mkdirSync(".work/screenshots", { recursive: true });
  await page.goto("/examples");
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Sample PDF", exact: true }).click();
  expect((await pdfDownload).suggestedFilename()).toBe(
    "Northstar_v2_SAMPLE.pdf",
  );
  await page.getByRole("link", { name: "Open sample handbook" }).click();
  await expect(
    page.getByRole("heading", { name: "Your website, clearly handed over." }),
  ).toBeVisible();
  await page.goto("/help");
  await page.getByLabel("Search help").fill("nonsense-no-match");
  await expect(page.getByText("0 matching help articles")).toBeVisible();
  await page.getByLabel("Search help").fill("redact");
  await expect(page.getByText("1 matching help articles")).toBeVisible();
  await signIn(page);
  await page.goto("/app/settings");
  await page
    .getByRole("checkbox", { name: "New client questions", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.getByText("Workspace settings saved.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "New client questions", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByText("Current session", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Support access scope").selectOption("sample");
  await page
    .getByLabel("Sanitized sample", { exact: true })
    .fill("A fictional sanitized workflow for support.");
  await page
    .getByRole("checkbox", { name: "I authorize this scope and duration." })
    .check();
  await page
    .getByRole("button", { name: "Authorize temporary access" })
    .click();
  await expect(page.getByText("active", { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".work/screenshots/settings-complete.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByText("revoked", { exact: true })).toBeVisible();
});
test("preview, field comparison, conflict merge, batch invites, client replies and version-change recovery", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  mkdirSync(".work/screenshots", { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const project = await readyProject(page);
  await page.goto(`/app/projects/${project.id}/handbook?preview=1`);
  await page.getByRole("button", { name: "Mobile", exact: true }).click();
  expect(
    (await page.locator(".draft-preview .manual").boundingBox())!.width,
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".work/screenshots/preview-mobile.png",
    fullPage: true,
  });
  await page.goto(`/app/projects/${project.id}/guides`);
  let releasePatch!: () => void;
  const held = new Promise<void>((resolve) => (releasePatch = resolve));
  let capturedPatch!: () => void;
  const captured = new Promise<void>((resolve) => (capturedPatch = resolve));
  await page.route(`**/api/projects/${project.id}/draft`, async (route) => {
    if (route.request().method() === "PATCH") {
      capturedPatch();
      await held;
    }
    await route.continue();
  });
  await page
    .getByLabel("Instruction", { exact: true })
    .fill("My local preview instruction.");
  await captured;
  const serverProject = await project.get();
  serverProject.draft.guides[0].steps[0].body =
    "Newer server preview instruction.";
  serverProject.draft.intro = "Updated by another tab.";
  await project.call(
    `/projects/${project.id}/draft`,
    { baseRevision: serverProject.revision, draft: serverProject.draft },
    "PATCH",
  );
  releasePatch();
  await expect(
    page.getByText("Content conflict", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Resolve save state" }).click();
  await page.getByRole("button", { name: "Compare server draft" }).click();
  await expect(
    page.getByText("Newer server preview instruction.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(/Merged draft\/.*\/body/)
    .fill("Merged preview instruction.");
  await page.getByRole("button", { name: "Save merged draft" }).click();
  await expect
    .poll(async () => (await project.get()).draft.guides[0].steps[0].body)
    .toBe("Merged preview instruction.");
  await expect
    .poll(async () => (await project.get()).draft.intro)
    .toBe("Updated by another tab.");
  await page.goto(`/app/projects/${project.id}/guides`);
  await page.getByRole("checkbox", { name: /I.ve checked this step/ }).check();
  await expect(page.locator(".editor-commandbar .save-state")).toHaveText(
    "Saved",
  );
  await project.publish("Clarified preview instruction");
  await page.goto(`/app/projects/${project.id}/releases`);
  await page.getByLabel("Compare from").selectOption(project.release.id);
  await page
    .getByLabel("Compare to")
    .selectOption((await project.get()).currentRelease.id);
  const bodyChange = page
    .locator(".change-detail")
    .filter({ has: page.locator("summary", { hasText: "/ body" }) });
  await bodyChange.locator("summary").click();
  await expect(bodyChange.locator("mark")).toContainText(
    "Merged preview instruction",
  );
  await page.screenshot({
    path: ".work/screenshots/version-comparison.png",
    fullPage: true,
  });
  await page.goto(`/app/projects/${project.id}/handoff`);
  const clientEmail = `batch-client-${Date.now()}@example.test`,
    secondEmail = `batch-other-${Date.now()}@example.test`;
  await page
    .getByLabel("Client email", { exact: true })
    .fill(`${clientEmail}\n${secondEmail}\n${clientEmail}`);
  await page.getByRole("button", { name: "Send private invitation" }).click();
  await expect(page.getByText("2 invitations queued.")).toBeVisible();
  const inviteLinks = page.getByRole("link", {
    name: "Open local invitation",
    exact: true,
  });
  const url = await inviteLinks.first().getAttribute("href");
  await page.getByLabel(clientEmail, { exact: true }).check();
  await page.getByRole("button", { name: "Request receipt of v2" }).click();
  const clientContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
  });
  const client = await clientContext.newPage();
  await client.goto(url!);
  await client.getByLabel("Email address").fill(clientEmail);
  await client.getByRole("button", { name: "Send verification code" }).click();
  await client
    .getByLabel("Verification code")
    .fill((await client.locator(".notice strong").textContent())!);
  await client
    .getByRole("button", { name: "Verify email", exact: true })
    .click();
  await client
    .locator("#client-feedback")
    .getByRole("button", { name: "Ask a question" })
    .click();
  await client
    .getByLabel("Your question")
    .fill("Can I review the preview first?");
  await client
    .getByRole("button", { name: "Submit question", exact: true })
    .click();
  await client
    .getByLabel("Reply to my question")
    .fill("I found the preview button.");
  await client.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(
    client.getByText("I found the preview button.", { exact: true }),
  ).toBeVisible();
  await client.getByRole("checkbox", { name: /I reviewed version v2/ }).check();
  await project.publish("Third version requires its own receipt");
  await client
    .getByRole("button", { name: "Confirm receipt of version v2", exact: true })
    .click();
  await expect(
    client.getByRole("heading", {
      name: "There is a newer version to review.",
    }),
  ).toBeVisible();
  await client
    .getByRole("button", { name: "Open the current version" })
    .click();
  await expect(
    client.getByRole("heading", { name: "Northstar operations" }),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel(clientEmail, { exact: true }).check();
  await page.getByRole("button", { name: "Request receipt of v3" }).click();
  await client.reload();
  await client.getByRole("checkbox", { name: /I reviewed version v3/ }).check();
  await client
    .getByRole("button", { name: "Confirm receipt of version v3", exact: true })
    .click();
  await expect(
    client.getByText("Receipt reference", { exact: true }),
  ).toBeVisible();
  await expect(
    client.locator(".receipt-record").getByText(clientEmail, { exact: true }),
  ).toHaveCount(2);
  expect(
    await client.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await client.screenshot({
    path: ".work/screenshots/receipt-mobile.png",
    fullPage: true,
  });
  await page.goto(`/app/payment/${project.orderId}`);
  await expect(
    page.getByRole("heading", { name: "Your project pack is active." }),
  ).toBeVisible();
  await page.screenshot({
    path: ".work/screenshots/payment-success.png",
    fullPage: true,
  });
  await page.goto(`/app/billing?project=${project.id}`);
  await expect(
    page.getByRole("button", { name: "Continue to extension", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I understand this extends hosting only/ })
    .check();
  await expect(
    page.getByRole("button", { name: "Continue to extension", exact: true }),
  ).toBeEnabled();
  await clientContext.close();
  expect(errors).toEqual([]);
});
test("operations inspects only metadata or explicit samples and audits provider checks", async ({
  page,
  browserName,
}) => {
  test.setTimeout(60000);
  await signIn(page, `ops-${browserName}@example.test`);
  const project = await readyProject(page);
  const grant = await project.call("/support-grants", {
    scope: "sample",
    hours: 1,
    sample: "Authorized fictional sample only.",
  });
  await page.goto("/ops");
  await expect(
    page.getByRole("heading", { name: "Operations diagnostics", exact: true }),
  ).toBeVisible();
  const orders = page.locator(".panel").filter({
    has: page.getByRole("heading", { name: "orders", exact: true }),
  });
  await orders
    .locator(".request-row")
    .filter({ hasText: project.orderId })
    .getByRole("button", { name: "Inspect", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Verify provider status", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Reason for repair")
    .fill("Check the original order after a support request.");
  await page
    .getByRole("button", { name: "Verify provider status", exact: true })
    .click();
  await expect(
    page.getByText("Provider verification result: paid · Local order only", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  const grants = page.locator(".panel").filter({
    has: page.getByRole("heading", { name: "grants", exact: true }),
  });
  await grants
    .locator(".request-row")
    .filter({ hasText: grant.id })
    .getByRole("button", { name: "Review authorized scope" })
    .click();
  await expect(page.locator(".support-sample")).toHaveText(
    "Authorized fictional sample only.",
  );
  await page.screenshot({
    path: ".work/screenshots/operations-complete.png",
    fullPage: true,
  });
  await project.call(`/support-grants/${grant.id}`, {}, "DELETE");
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(
    grants
      .locator(".request-row")
      .filter({ hasText: grant.id })
      .getByRole("button", { name: "Review authorized scope" }),
  ).toBeDisabled();

  // Exercise the repair UI with metadata fixtures. Authorization, durable
  // queuing and provider verification are covered by the server tests.
  const webhook = {
    id: `dodo:test_mode:repair-${browserName}`,
    status: "dead",
    attempts: 5,
    total_attempts: 5,
    created_at: Date.now(),
    retry_available_at: null as number | null,
  };
  let repairReason = "";
  await page.route("**/api/ops", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.webhooks.push(webhook);
    await route.fulfill({ response, json: data });
  });
  await page.route(`**/api/ops/webhooks/${webhook.id}`, async (route) => {
    await route.fulfill({ json: webhook });
  });
  await page.route(`**/api/ops/webhooks/${webhook.id}/retry`, async (route) => {
    repairReason = route.request().postDataJSON().reason;
    webhook.status = "queued";
    webhook.attempts = 0;
    webhook.retry_available_at = Date.now() + 15 * 60000;
    await route.fulfill({ status: 202, json: webhook });
  });
  await page.getByRole("button", { name: "Refresh status" }).click();
  const webhooks = page.locator(".panel").filter({
    has: page.getByRole("heading", { name: "webhooks", exact: true }),
  });
  await webhooks
    .locator(".request-row")
    .filter({ hasText: webhook.id })
    .getByRole("button", { name: "Inspect", exact: true })
    .click();
  const retry = page.getByRole("button", {
    name: "Retry payment event",
    exact: true,
  });
  await expect(retry).toBeDisabled();
  await page
    .getByLabel("Reason for repair")
    .fill("Provider recovered after a verified outage.");
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(
    page.getByText(
      "Payment event queued for provider verification. Entitlements change only after verification succeeds.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(repairReason).toBe("Provider recovered after a verified outage.");
  await webhooks
    .locator(".request-row")
    .filter({ hasText: webhook.id })
    .getByRole("button", { name: "Inspect", exact: true })
    .click();
  await page
    .getByLabel("Reason for repair")
    .fill("Do not queue the same event twice.");
  await expect(retry).toBeDisabled();
  await page.screenshot({
    path: ".work/screenshots/payment-webhook-repair.png",
    fullPage: true,
  });
});

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
async function readyProject(page: Page) {
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
  const created = await call("/projects", {
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
});

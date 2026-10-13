import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
async function setup(page: Page) {
  await page.goto("/auth");
  await page
    .getByLabel("Email address")
    .fill(`resources-ui-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page
    .getByLabel("Verification code")
    .fill((await page.locator(".notice strong").textContent())!);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await page.getByLabel("Your display name").fill("Alex");
  await page
    .getByLabel("Support email", { exact: true })
    .fill("support@example.test");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page.getByRole("link", { name: "Create your first project" }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Layered handbook");
  await page
    .getByLabel("Client name", { exact: true })
    .fill("Fictional client");
  await page.getByRole("button", { name: /A blank canvas/ }).click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Layered handbook", exact: true }),
  ).toBeVisible();
  return /projects\/([^/]+)/.exec(page.url())![1];
}
test("editable layers, guarded navigation, glossary, independent image copy and resource controls", async ({
  page,
}) => {
  test.setTimeout(150000);
  mkdirSync(".work/screenshots", { recursive: true });
  const pid = await setup(page);
  await page.getByRole("link", { name: "Screenshots", exact: true }).click();
  const bytes = await sharp({
    create: { width: 800, height: 480, channels: 3, background: "#f8f5eb" },
  })
    .png()
    .toBuffer();
  await page.locator("input[type=file]").setInputFiles({
    name: "Fictional screenshot.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await expect(page.locator("canvas")).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Guides", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${pid}/assets`));
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => history.back());
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${pid}/assets`));
  let bounds = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width * 0.3,
    bounds.y + bounds.height * 0.2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.7,
    bounds.y + bounds.height * 0.45,
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  await page.mouse.move(
    bounds.x + bounds.width * 0.05,
    bounds.y + bounds.height * 0.1,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.2,
    bounds.y + bounds.height * 0.15,
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "Label", exact: true }).click();
  await page.getByLabel("Annotation text").fill("Original label");
  await page.locator("canvas").scrollIntoViewIfNeeded();
  bounds = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(
    bounds.x + bounds.width * 0.1,
    bounds.y + bounds.height * 0.65,
  );
  await page
    .getByRole("checkbox", { name: /I checked this screenshot/ })
    .check();
  await page
    .getByRole("button", { name: "Confirm processing & upload" })
    .click();
  await expect(
    page.getByText("Uploaded safely", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${pid}`)).json()).draft
          .guides[0]?.steps[0]?.assetId,
      { timeout: 10000 },
    )
    .toBeTruthy();
  let project = await (await page.request.get(`/api/projects/${pid}`)).json();
  const stepId = project.draft.guides[0].steps[0].id,
    firstImage = project.draft.guides[0].steps[0].assetId;
  await page.goto(
    `/app/projects/${pid}/assets?replace=${stepId}&annotate=1&tool=label`,
  );
  await expect(page.getByLabel("Layer 2 text")).toHaveValue("Original label");
  await page.getByLabel("Layer 2 text").fill("Reviewed label");
  await page.getByLabel("Layer 1 X", { exact: true }).fill("35");
  await page
    .getByRole("checkbox", { name: /I checked this screenshot/ })
    .check();
  await page
    .getByRole("button", { name: "Confirm processing & upload" })
    .click();
  await expect(
    page.getByText("Uploaded safely", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${pid}`)).json()).draft
          .guides[0].steps[0].assetId,
      { timeout: 10000 },
    )
    .not.toBe(firstImage);
  project = await (await page.request.get(`/api/projects/${pid}`)).json();
  const secondImage = project.draft.guides[0].steps[0].assetId;
  expect(secondImage).not.toBe(firstImage);
  const recipe = await (
    await page.request.get(`/api/projects/${pid}/assets/${secondImage}/edit`)
  ).json();
  expect(recipe.shapes[1].label).toBe("Reviewed label");
  expect(recipe.shapes[0].x).toBe(35);
  const pixels = await sharp(
    await (await page.request.get(`/api/assets/${secondImage}`)).body(),
  )
    .extract({ left: 400, top: 165, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect([...pixels]).toEqual([23, 33, 43]);
  await page.screenshot({
    path: ".work/screenshots/editable-layers.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Handbook", exact: true }).click();
  await page
    .getByLabel("Preferred terms and aliases")
    .fill("Preview | Review page");
  await page.getByRole("button", { name: "Save terminology" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${pid}`)).json()).draft
          .glossary[0]?.term,
    )
    .toBe("Preview");
  await page.getByRole("link", { name: "Guides", exact: true }).click();
  await page
    .getByLabel("Instruction", { exact: true })
    .fill("Use Review page before continuing.");
  await expect(
    page.getByText("Terminology review", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Instruction", { exact: true })).toHaveValue(
    "Use Review page before continuing.",
  );
  await page
    .getByRole("link", { name: "Back to project", exact: true })
    .click();
  await page.getByLabel("Project AI cost budget (USD)").fill("0.1");
  await page
    .getByLabel("Reason for budget change")
    .fill("Set an explicit test budget");
  await page
    .getByRole("checkbox", { name: /I reviewed known and uncertain charges/ })
    .check();
  await page
    .getByRole("button", { name: "Save AI budget", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${pid}/resources`)
          ).json()
        ).ai.budgetUsd,
    )
    .toBe(0.1);
  const session = (await (await page.request.get("/api/session")).json()).user,
    headers = {
      "X-CSRF-Token": session.csrf,
      "Idempotency-Key": crypto.randomUUID(),
    };
  const order = await (
    await page.request.post("/api/billing/checkouts", {
      headers,
      data: { projectId: pid, product: "project" },
    })
  ).json();
  await page.request.post("/api/billing/local-confirm", {
    headers,
    data: { orderId: order.orderId },
  });
  await page.reload();
  await page
    .getByText("Reuse this structure for another client", { exact: true })
    .click();
  await page.getByLabel("New project name").fill("Independent images");
  await page.getByLabel("New client name").fill("Another fictional client");
  await page.locator(".copy-images input[type=checkbox]").check();
  await page
    .locator(".copy-project")
    .getByRole("checkbox", { name: /I reviewed the source text/ })
    .check();
  await page.getByRole("button", { name: "Create independent draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Independent images", exact: true }),
  ).toBeVisible();
  const copiedId = /projects\/([^/]+)/.exec(page.url())![1],
    copied = await (await page.request.get(`/api/projects/${copiedId}`)).json();
  expect(copied.draft.guides[0].steps[0].assetId).not.toBe(secondImage);
  await page.getByRole("link", { name: /Projects \d/ }).click();
  await page.getByText("More filters", { exact: true }).click();
  await page.getByLabel("Project plan", { exact: true }).selectOption("free");
  await expect(
    page.locator(`.project-cell[href='/app/projects/${copiedId}']`),
  ).toBeVisible();
  await expect(
    page.locator(`.project-cell[href='/app/projects/${pid}']`),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".work/screenshots/combined-filters.png",
    fullPage: true,
  });
});
test("a 20-file mixed batch keeps valid images and reports the invalid file before upload", async ({
  page,
}) => {
  const pid = await setup(page);
  await page.getByRole("link", { name: "Screenshots", exact: true }).click();
  const bytes = await sharp({
    create: { width: 80, height: 40, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  await page.locator("input[type=file]").setInputFiles([
    ...Array.from({ length: 19 }, (_, i) => ({
      name: `valid-${i}.png`,
      mimeType: "image/png",
      buffer: bytes,
    })),
    {
      name: "invalid.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Fictional invalid screenshot"),
    },
  ]);
  await expect(page.getByText(/invalid.txt: use a static PNG/)).toBeVisible();
  await expect(page.locator(".asset-queue .queue-item")).toHaveCount(19);
  expect(
    (await (await page.request.get(`/api/projects/${pid}/assets`)).json())
      .length,
  ).toBe(0);
});

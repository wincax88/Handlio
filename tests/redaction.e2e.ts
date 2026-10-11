import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
test("uploads only reviewed, irreversibly redacted pixels", async ({
  page,
}) => {
  mkdirSync(".work", { recursive: true });
  const fixture = ".work/redaction-source.png";
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="#f6f8f1"/><rect width="170" height="480" fill="#244d42"/><text x="24" y="50" font-size="24" fill="white">Harbor Demo</text><text x="205" y="70" font-size="26" fill="#244d42">Website settings</text><rect x="280" y="130" width="410" height="80" rx="6" fill="#edd8c2"/><text x="305" y="175" font-size="22" fill="#712f23">DEMO-SECRET-abc123</text><text x="205" y="300" font-size="20" fill="#64765c">Use only fictional credentials for this test.</text></svg>';
  await sharp(Buffer.from(svg)).png().toFile(fixture);
  await page.goto("/auth");
  await page
    .getByLabel("Email address")
    .fill(`redaction-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page
    .getByLabel("Verification code")
    .fill((await page.locator(".notice strong").textContent())!);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await page.getByRole("link", { name: "Create your first project" }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Image privacy test");
  await page
    .getByLabel("Client name", { exact: true })
    .fill("Fictional client");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page.getByRole("link", { name: "Screenshots", exact: true }).click();
  let uploads = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/projects\/[^/]+\/assets$/.test(r.url())
    )
      uploads++;
  });
  await page.locator("input[type=file]").setInputFiles(fixture);
  await expect(page.locator("canvas")).toBeVisible();
  expect(uploads).toBe(0);
  await expect(
    page.getByRole("button", { name: "Confirm processing & upload" }),
  ).toBeDisabled();
  const bounds = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width * 0.34,
    bounds.y + bounds.height * 0.25,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.88,
    bounds.y + bounds.height * 0.47,
  );
  await page.mouse.up();
  await page
    .getByRole("checkbox", { name: /I checked this screenshot/ })
    .check();
  await page
    .getByRole("button", { name: "Confirm processing & upload" })
    .click();
  await expect(
    page.getByText("Uploaded safely", { exact: true }),
  ).toBeVisible();
  expect(uploads).toBe(1);
  const pid = /projects\/([^/]+)/.exec(page.url())![1];
  const assets = await (
    await page.request.get(`/api/projects/${pid}/assets`)
  ).json();
  const buffer = await (
    await page.request.get(`/api/assets/${assets[0].id}`)
  ).body();
  const pixels = await sharp(buffer)
    .extract({ left: 400, top: 165, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect([...pixels]).toEqual([23, 33, 43]);
  const safeMeta = await sharp(buffer).metadata();
  expect(safeMeta.exif).toBeUndefined();
  await page.screenshot({
    path: ".work/screenshots/redaction.png",
    fullPage: true,
  });

  await page
    .getByRole("link", { name: "Continue to your guides", exact: true })
    .click();
  await page.getByRole("link", { name: "Redact", exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I checked this screenshot/ })
    .check();
  await page
    .getByRole("button", { name: "Confirm processing & upload" })
    .click();
  await expect(
    page.getByText("Uploaded safely", { exact: true }),
  ).toBeVisible();
  const updated = await (await page.request.get(`/api/projects/${pid}`)).json();
  const currentAsset = updated.draft.guides
    .flatMap((g: any) => g.steps)
    .find((s: any) => s.assetId)?.assetId;
  const safeAgain = await (
    await page.request.get(`/api/assets/${currentAsset}`)
  ).body();
  const permanent = await sharp(safeAgain)
    .extract({ left: 400, top: 165, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect([...permanent]).toEqual([23, 33, 43]);
});

import { expect, test } from "vitest";
import express from "express";
import request from "supertest";
import path from "node:path";
import { installSeo } from "../server/seo";

function site(sandbox = false) {
  const app = express();
  installSeo(app, path.resolve("dist"), {
    NODE_ENV: "production",
    APP_ORIGIN: "https://www.handlio.cloud",
    PAYMENTS_SANDBOX_INSTANCE: sandbox ? "1" : "",
  });
  return request(app);
}

test.each([
  ["/", "Great work deserves"],
  ["/pricing", "One project. A clear handoff."],
  ["/examples", "See what a clear handoff looks like."],
  ["/help", "Help &amp; support"],
  ["/terms", "Service terms"],
  ["/privacy", "Privacy &amp; data handling"],
  ["/refund", "Refunds &amp; payment support"],
])("%s includes useful HTML before JavaScript runs", async (url, heading) => {
  const res = await site().get(url).expect(200).expect("Content-Type", /html/);
  expect(res.text).toContain(heading);
  expect(res.text).toContain('data-prerendered="true"');
  expect(res.text).toContain(
    `rel="canonical" href="https://www.handlio.cloud${url}"`,
  );
  expect(res.text).toContain(
    'content="index, follow, max-image-preview:large"',
  );
  expect(res.headers["x-robots-tag"]).toBeUndefined();
  expect(res.text.match(/<h1[ >]/g)).toHaveLength(1);
  expect(res.text.match(/<title[ >]/g)).toHaveLength(1);
  expect(res.text.match(/name="description"/g)).toHaveLength(1);
  const data = JSON.parse(
    /type="application\/ld\+json">(.*?)<\/script>/.exec(res.text)![1],
  );
  expect(data["@context"]).toBe("https://schema.org");
  expect(res.text).toContain("Source code");
});

test("canonicals ignore tracking queries and untrusted request hosts", async () => {
  const res = await site()
    .get("/pricing?utm_source=example&return=%3Cscript%3E")
    .set("Host", "attacker.example")
    .expect(200);
  expect(res.text).toContain(
    'rel="canonical" href="https://www.handlio.cloud/pricing"',
  );
  expect(res.text).not.toContain("attacker.example");
  expect(res.text).not.toContain("utm_source");
});

test.each([
  "/auth",
  "/app/projects/private-project",
  "/h/private-handbook/access?invite=secret",
  "/ops",
])("%s stays out of search and prerendered content", async (url) => {
  const res = await site()
    .get(url)
    .expect(200)
    .expect("X-Robots-Tag", "noindex, nofollow");
  expect(res.text).toContain('name="robots" content="noindex, nofollow"');
  expect(res.text).not.toContain("data-prerendered");
  expect(res.text).not.toContain('rel="canonical"');
  expect(res.text).not.toContain("private-project");
  expect(res.text).not.toContain("private-handbook");
  expect(res.text).not.toContain("invite=secret");
});

test("unknown pages and missing assets return 404 instead of a duplicate home page", async () => {
  for (const url of ["/does-not-exist", "/missing.js"]) {
    const res = await site()
      .get(url)
      .expect(404)
      .expect("X-Robots-Tag", "noindex, nofollow");
    expect(res.text).toContain("Page not found");
    expect(res.text).not.toContain("Great work deserves");
  }
});

test("duplicate public URL forms redirect permanently", async () => {
  await site()
    .get("/pricing/?utm_source=example")
    .expect(308)
    .expect("Location", "/pricing?utm_source=example");
  await site().get("/index.html").expect(308).expect("Location", "/");
});

test("sitemap exposes only canonical public pages and robots leaves noindex pages crawlable", async () => {
  const map = await site()
    .get("/sitemap.xml")
    .expect(200)
    .expect("Content-Type", /xml/);
  expect(map.text.match(/<loc>/g)).toHaveLength(7);
  expect(map.text).toContain("https://www.handlio.cloud/pricing</loc>");
  expect(map.text).not.toMatch(/\/auth|\/app\/|\/h\/|\/ops|\/samples\//);
  const robots = await site().get("/robots.txt").expect(200);
  expect(robots.text).toContain(
    "Sitemap: https://www.handlio.cloud/sitemap.xml",
  );
  expect(robots.text).not.toContain("Disallow: /auth");
  expect(robots.text).toContain("Disallow: /api/");
});

test("sandbox blocks indexing for public and static pages and publishes no sitemap URLs", async () => {
  const home = await site(true)
    .get("/")
    .expect(200)
    .expect("X-Robots-Tag", "noindex, nofollow");
  expect(home.text).toContain('name="robots" content="noindex, nofollow"');
  const map = await site(true).get("/sitemap.xml").expect(200);
  expect(map.text).not.toContain("<loc>");
  const robots = await site(true).get("/robots.txt").expect(200);
  expect(robots.text).toBe("User-agent: *\nDisallow: /\n");
  await site(true)
    .get("/handlio-logo.png")
    .expect(200)
    .expect("X-Robots-Tag", "noindex, nofollow");
});

test("social preview has a real PNG image with the advertised dimensions", async () => {
  const res = await site()
    .get("/social-card.png")
    .expect(200)
    .expect("Content-Type", /png/);
  expect(res.body.readUInt32BE(16)).toBe(1200);
  expect(res.body.readUInt32BE(20)).toBe(630);
});

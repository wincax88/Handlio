import { afterAll, beforeAll, expect, test } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { Manual } from "../src/Reader";
import { contentChanges, mergeContent } from "../shared/compare";
import { projectDate, sectionOrder } from "../shared/handbook";
process.env.DATA_DIR = mkdtempSync(
  path.join(tmpdir(), "handlio-project-settings-"),
);
process.env.NODE_ENV = "test";
process.env.MAIL_PROVIDER = "local";
process.env.BILLING_PROVIDER = "";
process.env.BILLING_ADAPTER_URL = "";
const { createApp } = await import("../server/app");
const { db, one, run } = await import("../server/db");
const { processJobs } = await import("../server/jobs");
const { renderHtml, generateExport } = await import("../server/export");
const app = createApp();
async function login(email: string) {
  const agent = request.agent(app);
  const c = await agent
    .post("/api/auth/challenges")
    .send({ email, purpose: "owner" });
  expect(c.status).toBe(200);
  expect(
    (
      await agent.post("/api/auth/verify").send({
        challengeId: c.body.challengeId,
        code: c.body.devCode,
        purpose: "owner",
      })
    ).status,
  ).toBe(200);
  const session = (await agent.get("/api/session")).body;
  return {
    agent,
    call: (method: "post" | "patch" | "delete", url: string, body: any) =>
      agent[method](url)
        .set("X-CSRF-Token", session.user.csrf)
        .set("Idempotency-Key", randomUUID())
        .send(body),
  };
}
let owner: Awaited<ReturnType<typeof login>>,
  outsider: Awaited<ReturnType<typeof login>>,
  pid: string,
  first: any,
  frozen: string;
const get = async () => (await owner.agent.get(`/api/projects/${pid}`)).body;
async function save(draft: any) {
  const p = await get();
  return owner.call("patch", `/api/projects/${pid}/draft`, {
    baseRevision: p.revision,
    draft,
  });
}
async function publish() {
  const check = (await owner.call("post", `/api/projects/${pid}/validate`, {}))
    .body;
  expect(check.blockers).toEqual([]);
  const result = await owner.call("post", `/api/projects/${pid}/releases`, {
    draftRevision: check.revision,
    validationId: check.id,
    summary: "Project settings test",
    warningReason: "Reviewed warnings",
  });
  expect(result.status).toBe(202);
  await processJobs();
  return (await get()).currentRelease;
}
beforeAll(async () => {
  owner = await login("settings-owner@example.test");
  outsider = await login("settings-other@example.test");
  const result = await owner.call("post", "/api/projects", {
    name: "Settings test",
    clientName: "Fictional client",
    title: "Client handbook",
    template: "blank",
  });
  pid = result.body.id;
  const checkout = await owner.call("post", "/api/billing/checkouts", {
    projectId: pid,
    product: "project",
  });
  await owner.call("post", "/api/billing/local-confirm", {
    orderId: checkout.body.orderId,
  });
  const d = (await get()).draft;
  d.intro = "A fictional project overview.";
  d.supportEmail = "support@example.test";
  d.maintenance = "Contact the creator for changes.";
  Object.assign(d.guides[0], {
    title: "First workflow",
    goal: "Review content",
    prerequisites: "Editor access",
    audience: "Editors",
    completion: "The preview is correct",
    steps: [
      {
        id: randomUUID(),
        title: "Open preview",
        body: "Open the preview.",
        expected: "The preview appears.",
        warning: "",
        source: "",
        alt: "",
        assetId: null,
        reviewed: true,
        textOnly: true,
        aiPending: false,
      },
    ],
  });
  expect((await save(d)).status).toBe(200);
});
afterAll(() => db.close());

test("projects inherit workspace time zone and accept independent language and time zone on creation", async () => {
  const settings = (await owner.agent.get("/api/settings")).body;
  expect(
    (
      await owner.call("patch", "/api/settings", {
        ...settings,
        timezone: "Asia/Shanghai",
      })
    ).status,
  ).toBe(200);
  const result = await owner.call("post", "/api/projects", {
    name: "Inherited locale",
    clientName: "Demo",
    title: "Guide",
    template: "blank",
  });
  expect(result.status).toBe(201);
  const p = (await owner.agent.get(`/api/projects/${result.body.id}`)).body;
  expect(p.draft).toMatchObject({ language: "en", timezone: "Asia/Shanghai" });
  await owner.call("delete", `/api/projects/${p.id}`, { name: p.name });
  const specific = await owner.call("post", "/api/projects", {
    name: "Explicit locale",
    clientName: "Demo",
    title: "Guide",
    template: "blank",
    language: "zh-cn",
    timezone: "America/New_York",
  });
  expect(specific.status).toBe(201);
  const other = (await owner.agent.get(`/api/projects/${specific.body.id}`))
    .body;
  expect(other.draft).toMatchObject({
    language: "zh-CN",
    timezone: "America/New_York",
  });
  await owner.call("delete", `/api/projects/${other.id}`, { name: other.name });
  expect((await get()).draft.timezone).toBe("UTC");
});

test("invalid locales, duplicate or missing fixed sections and cross-tenant changes are rejected", async () => {
  const p = await get();
  for (const patch of [
    { language: "en<script>" },
    { timezone: "Mars/Olympus" },
    { sectionTitles: { ...p.draft.sectionTitles, overview: " " } },
    { sectionOrder: ["overview", "overview", "support", "checklist"] },
    { sectionOrder: ["overview", "support"] },
    { sectionOrder: ["overview", "support", "checklist", "arbitrary-section"] },
  ]) {
    expect((await save({ ...p.draft, ...patch })).status).toBe(400);
  }
  expect((await get()).revision).toBe(p.revision);
  expect(
    (
      await outsider.call("patch", `/api/projects/${pid}/draft`, {
        baseRevision: p.revision,
        draft: p.draft,
      })
    ).status,
  ).toBe(404);
});

test("fixed sections interleave with guides and freeze with locale in the exact published version", async () => {
  const d = (await get()).draft;
  const second = structuredClone(d.guides[0]);
  second.id = randomUUID();
  second.title = "Second workflow";
  second.steps[0].id = randomUUID();
  const hidden = structuredClone(second);
  hidden.id = randomUUID();
  hidden.title = "PRIVATE HIDDEN GUIDE";
  hidden.included = false;
  hidden.steps[0].id = randomUUID();
  d.guides.push(second, hidden);
  d.language = "zh-CN";
  d.timezone = "America/New_York";
  d.sectionTitles = {
    overview: "项目 <说明>",
    checklist: "交付核对",
    support: "联系与维护",
  };
  d.sectionOrder = [
    "support",
    `guide:${d.guides[0].id}`,
    "overview",
    `guide:${second.id}`,
    "checklist",
    `guide:${hidden.id}`,
  ];
  expect((await save(d)).status).toBe(200);
  first = await publish();
  expect(first.snapshot).toMatchObject({
    language: "zh-CN",
    timezone: "America/New_York",
    sectionTitles: d.sectionTitles,
  });
  expect(first.snapshot.sectionOrder).toEqual(d.sectionOrder.slice(0, -1));
  expect(JSON.stringify(first.snapshot)).not.toContain(hidden.id);
  frozen = one("SELECT snapshot FROM releases WHERE id=?", first.id)!.snapshot;
  await owner.call("patch", `/api/projects/${pid}`, { sharing: true });
  const invite = (
    await owner.call("post", `/api/projects/${pid}/invites`, {
      email: "settings-client@example.test",
      role: "Viewer",
      download: true,
    })
  ).body;
  const client = request.agent(app);
  const challenge = await client.post("/api/auth/challenges").send({
    email: "settings-client@example.test",
    purpose: "client",
    publicId: (await get()).publicId,
    invite: new URL(invite.localInviteUrl).searchParams.get("invite"),
  });
  expect(
    (
      await client.post("/api/auth/verify").send({
        challengeId: challenge.body.challengeId,
        code: challenge.body.devCode,
        purpose: "client",
      })
    ).status,
  ).toBe(200);
  const read = (
    await client.get(`/api/client/handbooks/${(await get()).publicId}`)
  ).body;
  expect(read.release.snapshot.sectionOrder).toEqual(
    first.snapshot.sectionOrder,
  );
  expect(read.release.hash).toBe(first.hash);
});

test("web and offline output use the same order, escaped titles, language and project dates", async () => {
  const row = one("SELECT * FROM releases WHERE id=?", first.id)!;
  const web = renderToStaticMarkup(createElement(Manual, { release: first }));
  const { html } = await renderHtml(row);
  for (const output of [web, html]) {
    expect(output).toContain('lang="zh-CN"');
    expect(output).toContain("项目 &lt;说明&gt;");
    expect(output).toContain("America/New_York");
    const anchors = [...output.matchAll(/<section[^>]*\bid="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(anchors).toEqual([
      "support",
      `guide-${first.snapshot.guides[0].id}`,
      "handbook-overview",
      `guide-${first.snapshot.guides[1].id}`,
      "handoff-checklist",
    ]);
    expect(output).not.toContain("PRIVATE HIDDEN GUIDE");
  }
  expect(
    projectDate("2026-03-08T06:30:00Z", { timezone: "America/New_York" }),
  ).toContain("1:30");
  expect(
    projectDate("2026-03-08T07:30:00Z", { timezone: "America/New_York" }),
  ).toContain("3:30");
  const pdf = await generateExport(row, randomUUID(), "pdf", "Letter");
  expect(pdf.tocEntries).toBe(5);
  const parsed = await PDFDocument.load(
    readFileSync(path.join(process.env.DATA_DIR!, pdf.file)),
  );
  expect(
    parsed.catalog.lookup(PDFName.of("Lang"), PDFString).decodeText(),
  ).toBe("zh-CN");
});

test("copy and restore retain section placement without sharing IDs or mutating old releases", async () => {
  const d = (await get()).draft;
  d.language = "fr";
  d.timezone = "Europe/Paris";
  d.sectionTitles.support = "Assistance";
  d.sectionOrder = [...d.sectionOrder].reverse();
  expect((await save(d)).status).toBe(200);
  expect(
    one("SELECT snapshot FROM releases WHERE id=?", first.id)!.snapshot,
  ).toBe(frozen);
  const copy = await owner.call("post", `/api/projects/${pid}/copy`, {
    name: "Copied settings",
    clientName: "Another client",
    reviewed: true,
  });
  expect(copy.status).toBe(200);
  const copied = (await owner.agent.get(`/api/projects/${copy.body.id}`)).body;
  expect(copied.draft).toMatchObject({
    language: "fr",
    timezone: "Europe/Paris",
  });
  expect(
    copied.draft.sectionOrder.filter(
      (key: string) => !key.startsWith("guide:"),
    ),
  ).toEqual(d.sectionOrder.filter((key: string) => !key.startsWith("guide:")));
  expect(
    copied.draft.guides.some((g: any) =>
      d.guides.some((old: any) => old.id === g.id),
    ),
  ).toBe(false);
  expect(copied.draft.sectionOrder).toEqual(sectionOrder(copied.draft));
  expect(
    (await owner.call("post", `/api/releases/${first.id}/restore`, {})).status,
  ).toBe(200);
  const restored = await publish();
  expect(restored.version).toBe(first.version + 1);
  expect(restored.snapshot.language).toBe("zh-CN");
  expect(restored.snapshot.sectionOrder).toEqual(first.snapshot.sectionOrder);
  expect(
    one("SELECT snapshot FROM releases WHERE id=?", first.id)!.snapshot,
  ).toBe(frozen);
});

test("legacy drafts and releases use safe display defaults without rewriting published content", async () => {
  const legacy = structuredClone(first);
  for (const field of ["language", "timezone", "sectionTitles", "sectionOrder"])
    delete legacy.snapshot[field];
  const web = renderToStaticMarkup(createElement(Manual, { release: legacy }));
  const row = one("SELECT * FROM releases WHERE id=?", first.id)!;
  const { html } = await renderHtml({
    ...row,
    snapshot: JSON.stringify(legacy.snapshot),
  });
  for (const output of [web, html]) {
    expect(output).toContain('lang="en"');
    expect(output).toContain("Project overview");
    expect(output).toContain("UTC");
    expect(output.indexOf('id="handbook-overview"')).toBeLessThan(
      output.indexOf(`id="guide-${legacy.snapshot.guides[0].id}"`),
    );
  }
  run(
    "UPDATE projects SET draft=? WHERE id=?",
    JSON.stringify(legacy.snapshot),
    pid,
  );
  const p = await get();
  expect(p.draft).toMatchObject({ language: "en", timezone: "UTC" });
  expect((await save(p.draft)).status).toBe(200);
  expect(
    one("SELECT snapshot FROM releases WHERE id=?", first.id)!.snapshot,
  ).toBe(frozen);
});

test("locale and chapter changes participate in conflict merge and field comparison", () => {
  const base = first.snapshot;
  const local = structuredClone(base),
    remote = structuredClone(base);
  local.timezone = "UTC";
  remote.sectionTitles.support = "Service contact";
  const merged = mergeContent(base, local, remote);
  expect(merged.conflicts).toEqual([]);
  expect(merged.value).toMatchObject({
    timezone: "UTC",
    sectionTitles: { support: "Service contact" },
  });
  expect(
    contentChanges(base, merged.value).some((c) => c.path.includes("timezone")),
  ).toBe(true);
  local.sectionOrder = [...base.sectionOrder].reverse();
  remote.sectionOrder = [...base.sectionOrder.slice(1), base.sectionOrder[0]];
  expect(
    mergeContent(base, local, remote).conflicts.some(
      (c) => c.path === "draft/sectionOrder",
    ),
  ).toBe(true);
});

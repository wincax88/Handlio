import { chromium } from "playwright";
import { ZipArchive } from "archiver";
import { createWriteStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir, requireValue, one, AppError, type Row } from "./db.js";
import type { Draft } from "../shared/model.js";
import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  PDFHexString,
  StandardFonts,
  rgb,
  type PDFObject,
} from "pdf-lib";
export const escapeHtml = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const text = (v: string) => escapeHtml(v).replace(/\n/g, "<br>");
export async function renderHtml(r: Row, inline = false, paper = "A4") {
  const d = JSON.parse(r.snapshot) as Draft & {
    projectName: string;
    clientName: string;
  };
  const images = new Map<string, string>();
  for (const aid of [
    d.logoId,
    ...d.guides.flatMap((g) => g.steps.map((s) => s.assetId)),
  ].filter(Boolean) as string[]) {
    requireValue(
      one(
        "SELECT id FROM assets WHERE id=? AND project_id=? AND status='ready'",
        aid,
        r.project_id,
      ),
      "ASSET_REVOKED",
      409,
      "A screenshot was withdrawn.",
    );
    images.set(
      aid,
      inline
        ? `data:image/png;base64,${(await readFile(path.join(dataDir, `${aid}.png`))).toString("base64")}`
        : `assets/${aid}.png`,
    );
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(d.title)}</title><style>
  @page{size:${paper === "Letter" ? "Letter" : "A4"};margin:18mm 16mm}*{box-sizing:border-box}body{font:16px/1.7 'Segoe UI','Microsoft YaHei',sans-serif;color:#182b34;background:#f8f9f6;margin:0}main{max-width:900px;margin:auto;padding:40px 26px}h1{font-size:40px;line-height:1.15}h2{font-size:28px;border-top:1px solid #dce2dc;padding-top:22px}h3{font-size:20px}a{color:${d.color}}p,li{overflow-wrap:anywhere}img{display:block;max-width:100%;max-height:230mm;object-fit:contain;margin:16px 0}header{padding:32px 0 40px;border-bottom:2px solid ${d.color}}.meta{font-size:12px;color:#52655d;overflow-wrap:anywhere}.step{margin:26px 0}.result{font-size:14px}.checklist{padding-left:24px}nav a{display:block;margin:8px 0}@media print{body{background:white;font-size:10pt}main{padding:0}header{break-after:page}h2,h3{break-after:avoid}img{break-inside:avoid}nav{break-after:page}.step{margin:16px 0}}</style></head><body><main><header>${d.logoId ? `<img src="${images.get(d.logoId)}" alt="Brand logo" style="max-width:160px;max-height:70px">` : ""}<p>${escapeHtml(d.clientName)} · CLIENT HANDBOOK</p><h1>${escapeHtml(d.title)}</h1><p>${text(d.intro)}</p><p class="meta">Version v${r.version} · Published ${new Date(r.created_at).toISOString()}<br>Manifest SHA-256 ${r.hash}<br>Generated ${new Date().toISOString()}</p></header><nav><h2>Contents</h2>${d.guides.map((g, i) => `<a href="#guide-${i}">${i + 1}. ${escapeHtml(g.title)}</a>`).join("")}<a href="#handoff">Handoff checklist</a><a href="#support">Support & maintenance</a></nav><section><h2>Project overview</h2><p>${text(d.intro)}</p><p>${escapeHtml(d.projectName)} · ${escapeHtml(d.clientName)}</p></section>${d.guides.map((g, i) => `<section id="guide-${i}"><h2>${i + 1}. ${escapeHtml(g.title)}</h2><p>${text(g.goal)}</p><p><b>Before you begin</b><br>${text(g.prerequisites)}</p><p><b>For</b> ${text(g.audience)}</p>${g.steps.map((s, j) => `<article class="step" id="step-${escapeHtml(s.id)}"><h3>${j + 1}. ${escapeHtml(s.title)}</h3><p>${text(s.body)}</p>${s.assetId ? `<img src="${images.get(s.assetId)}" alt="${escapeHtml(s.alt)}">` : ""}${s.expected ? `<p class="result"><b>Expected result</b><br>${text(s.expected)}</p>` : ""}${s.warning ? `<p class="result"><b>Please note</b><br>${text(s.warning)}</p>` : ""}</article>`).join("")}<p><b>Completion</b><br>${text(g.completion)}</p>${g.faq ? `<h3>Common questions</h3><p>${text(g.faq)}</p>` : ""}</section>`).join("")}<section id="handoff"><h2>Handoff checklist</h2><ul class="checklist">${d.checklist.map((c) => `<li>${c.done ? "✓" : "○"} ${escapeHtml(c.title)}${c.required ? " (required)" : ""}<br>${text(c.description)}</li>`).join("")}</ul></section><section id="support"><h2>Support & maintenance</h2><p>${text(d.maintenance)}</p>${d.supportEmail ? `<p><a href="mailto:${escapeHtml(d.supportEmail)}">${escapeHtml(d.supportEmail)}</a></p>` : ""}${d.supportUrl ? `<p><a href="${escapeHtml(d.supportUrl)}">${escapeHtml(d.supportUrl)}</a></p>` : ""}</section><footer><p class="meta">Prepared with Handlio. Receipt confirmation is a workflow record, not an electronic contract signature. This offline file cannot submit questions or confirmations; use the authenticated online handoff link.</p></footer></main></body></html>`;
  return { html, images };
}
export async function generateExport(
  r: Row,
  jid: string,
  format: string,
  paper: string,
) {
  const output = path.join(
    dataDir,
    `${jid}.${format === "pdf" ? "pdf" : "zip"}`,
  );
  let pages: number | undefined;
  let tocEntries: number | undefined;
  if (format === "html") {
    const { html, images } = await renderHtml(r);
    await new Promise<void>((resolve, reject) => {
      const file = createWriteStream(output);
      const zip = new ZipArchive({ zlib: { level: 6 } });
      file.on("close", resolve);
      file.on("error", reject);
      zip.on("error", reject);
      zip.pipe(file);
      zip.append(html, { name: "index.html" });
      zip.append(
        JSON.stringify(
          {
            version: r.version,
            releaseId: r.id,
            manifestHash: r.hash,
            algorithm: "sorted-json-v1",
            publishedAt: new Date(r.created_at).toISOString(),
          },
          null,
          2,
        ),
        { name: "manifest.json" },
      );
      zip.append(
        "Extract this entire ZIP and open index.html. All reading resources are included. No network connection is required. Questions and receipt confirmation are available only through your authenticated online handoff link.",
        { name: "README.txt" },
      );
      for (const aid of images.keys())
        zip.file(path.join(dataDir, `${aid}.png`), {
          name: `assets/${aid}.png`,
        });
      void zip.finalize();
    });
  } else {
    const { html } = await renderHtml(r, true, paper);
    const browserPath =
      process.env.CHROMIUM_EXECUTABLE_PATH ||
      [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      ].find(existsSync);
    const browser = await chromium.launch({
      headless: true,
      timeout: 15000,
      ...(browserPath ? { executablePath: browserPath } : {}),
    });
    try {
      const page = await browser.newPage();
      await page.route("**/*", (route) => route.abort());
      await page.setContent(
        html.replace(
          "nav a{display:block;margin:8px 0}",
          "nav a{display:block;margin:8px 0;padding-right:55px}",
        ),
        { waitUntil: "load", timeout: 30000 },
      );
      const bytes = await page.pdf({
        format: paper === "Letter" ? "Letter" : "A4",
        printBackground: true,
        displayHeaderFooter: true,
        tagged: true,
        outline: true,
        headerTemplate: "<span></span>",
        footerTemplate: `<div style="width:100%;font-size:8px;text-align:center;color:#52655d">Handlio · v${r.version} · <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
        margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
      });
      const numbered = await numberContents(bytes);
      await writeFile(output, numbered.bytes);
      pages = numbered.pages;
      tocEntries = numbered.tocEntries;
    } finally {
      await browser.close();
    }
  }
  return {
    file: path.basename(output),
    bytes: (await readFile(output)).length,
    format,
    paper,
    releaseId: r.id,
    manifestHash: r.hash,
    pages,
    tocEntries,
  };
}
async function numberContents(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  const references = new Map(pages.map((p, i) => [p.ref.toString(), i + 1]));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let tocEntries = 0;
  function resolveDestination(
    value: PDFObject | undefined,
  ): PDFArray | undefined {
    if (value instanceof PDFArray) return value;
    if (value instanceof PDFDict)
      return resolveDestination(value.lookup(PDFName.of("D")));
    if (
      value instanceof PDFName ||
      value instanceof PDFString ||
      value instanceof PDFHexString
    ) {
      const name =
        value instanceof PDFName ? value.decodeText() : value.decodeText();
      const dictionary = pdf.catalog.lookup(PDFName.of("Dests"));
      if (dictionary instanceof PDFDict) {
        const found = dictionary.lookup(PDFName.of(name));
        if (found) return resolveDestination(found);
      }
      const names = pdf.catalog.lookup(PDFName.of("Names"));
      const tree =
        names instanceof PDFDict
          ? names.lookup(PDFName.of("Dests"))
          : undefined;
      function find(node: PDFObject | undefined): PDFArray | undefined {
        if (!(node instanceof PDFDict)) return;
        const pairs = node.lookup(PDFName.of("Names"));
        if (pairs instanceof PDFArray)
          for (let n = 0; n < pairs.size(); n += 2) {
            const key = pairs.lookup(n);
            if (
              (key instanceof PDFString || key instanceof PDFHexString) &&
              key.decodeText() === name
            )
              return resolveDestination(pairs.lookup(n + 1));
          }
        const kids = node.lookup(PDFName.of("Kids"));
        if (kids instanceof PDFArray)
          for (let k = 0; k < kids.size(); k++) {
            const found = find(kids.lookup(k));
            if (found) return found;
          }
        return;
      }
      return find(tree);
    }
    return;
  }
  for (const page of pages.slice(1)) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    for (let i = 0; i < annotations.size(); i++) {
      const a = annotations.lookup(i, PDFDict);
      const action = a.lookup(PDFName.of("A"));
      const dest = resolveDestination(
        a.lookup(PDFName.of("Dest")) ||
          (action instanceof PDFDict
            ? action.lookup(PDFName.of("D"))
            : undefined),
      );
      const rect = a.lookupMaybe(PDFName.of("Rect"), PDFArray);
      if (!dest || !rect) continue;
      const ref = dest.get(0);
      if (!(ref instanceof PDFRef)) continue;
      const number = references.get(ref.toString());
      if (!number) continue;
      const y = rect.lookup(1, PDFNumber).asNumber() + 3;
      page.drawText(String(number), {
        x: page.getWidth() - 67,
        y,
        size: 10,
        font,
        color: rgb(0.32, 0.4, 0.35),
      });
      tocEntries++;
    }
  }
  pdf.setCreator("Handlio");
  return { bytes: await pdf.save(), pages: pages.length, tocEntries };
}

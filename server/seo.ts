import type { Express } from "express";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  defaultSiteOrigin,
  isPrivatePath,
  isPublicPath,
  metaEntries,
  pageMetadata,
  publicPaths,
  structuredData,
} from "../shared/seo.js";

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export function installSeo(
  app: Express,
  dist: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  // Only trusted configuration supplies the origin; forwarded Host headers never do.
  const origin = new URL(env.APP_ORIGIN || defaultSiteOrigin).origin;
  const allowIndexing =
    env.NODE_ENV === "production" && env.PAYMENTS_SANDBOX_INSTANCE !== "1";
  const template = readFileSync(path.join(dist, "index.html"), "utf8");
  const pages: Record<string, string> = JSON.parse(
    readFileSync(path.join(dist, ".prerender/pages.json"), "utf8"),
  );
  for (const route of [...publicPaths, "/404"])
    if (!pages[route])
      throw new Error(`Missing prerendered page: ${route}. Run npm run build.`);

  app.use((req, res, next) => {
    if (
      !allowIndexing ||
      isPrivatePath(req.path) ||
      req.path.startsWith("/samples/")
    )
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });
  app.get("/robots.txt", (req, res) => {
    res
      .type("text/plain")
      .send(
        allowIndexing
          ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /samples/\n\nSitemap: ${origin}/sitemap.xml\n`
          : "User-agent: *\nDisallow: /\n",
      );
  });
  app.get("/sitemap.xml", (req, res) => {
    const urls = allowIndexing
      ? publicPaths
          .map(
            (route) =>
              `<url><loc>${escapeHtml(`${origin}${route}`)}</loc></url>`,
          )
          .join("")
      : "";
    res
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
      );
  });
  // HTML is routed below so that / and public pages never bypass metadata or noindex.
  app.get("/index.html", (req, res) => res.redirect(308, "/"));
  app.use(express.static(dist, { index: false, redirect: false }));
  app.get("/{*path}", (req, res) => {
    const normalized = req.path.replace(/\/+$/, "") || "/";
    if (normalized !== req.path && isPublicPath(normalized)) {
      const query = req.url.includes("?")
        ? req.url.slice(req.url.indexOf("?"))
        : "";
      return res.redirect(308, `${normalized}${query}`);
    }
    const publicPage = isPublicPath(req.path);
    if (!publicPage) res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const known = publicPage || isPrivatePath(req.path);
    const prerendered = publicPage
      ? pages[req.path]
      : known
        ? ""
        : pages["/404"];
    const metadata = metaEntries(req.path, origin, allowIndexing)
      .map(
        ([attribute, key, value]) =>
          `<meta data-handlio-seo ${attribute}="${escapeHtml(key)}" content="${escapeHtml(value)}">`,
      )
      .join("");
    const canonical = publicPage
      ? `<link data-handlio-seo rel="canonical" href="${escapeHtml(`${origin}${req.path}`)}">`
      : "";
    const data = structuredData(req.path, origin);
    const json = data
      ? `<script data-handlio-seo type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`
      : "";
    const head = `<title data-handlio-seo>${escapeHtml(pageMetadata(req.path).title)}</title>${metadata}${canonical}${json}<meta name="handlio-origin" content="${escapeHtml(origin)}"><meta name="handlio-indexing" content="${allowIndexing ? "enabled" : "disabled"}">`;
    const html = template
      .replace(/<title[^>]*>[\s\S]*?<\/title>/, () => head)
      .replace(
        '<div id="root"></div>',
        () =>
          `<div id="root"${prerendered ? ' data-prerendered="true"' : ""}>${prerendered}</div>`,
      );
    res.setHeader("Cache-Control", "no-cache");
    res
      .status(known ? 200 : 404)
      .type("html")
      .send(html);
  });
}

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import type { Express } from "express";
import { authenticated } from "./auth.js";
import { AppError, audit, now, one, run, tx } from "./db.js";
import { editable, owner } from "./domain.js";
import type { Draft } from "../shared/model.js";
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
export function draftLinks(draft: Draft) {
  const text = [
    draft.supportUrl,
    draft.intro,
    draft.maintenance,
    ...draft.guides.flatMap((g) => [
      g.goal,
      g.prerequisites,
      g.faq,
      ...g.steps.flatMap((s) => [s.body, s.expected, s.warning]),
    ]),
  ].join("\n");
  return [
    ...new Set(
      (text.match(/https?:\/\/[^\s<>"']+/g) || []).map((s) =>
        s.replace(/[.,;!?]+$/, ""),
      ),
    ),
  ].slice(0, 20);
}
export function safeLinkUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hostname.length > 253
  )
    throw new Error("UNSAFE_LINK");
  return url;
}
export async function checkLink(value: string, redirects = 0): Promise<string> {
  try {
    const url = safeLinkUrl(value);
    const addresses = isIP(url.hostname)
      ? [{ address: url.hostname, family: isIP(url.hostname) }]
      : await Promise.race([
          lookup(url.hostname, { all: true }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("DNS_TIMEOUT")), 4000).unref(),
          ),
        ]);
    // Pin a public IPv4 address. Private, special-use and IPv6-only hosts require manual review.
    const address = addresses.find(
      (a) => a.family === 4 && !blocked.check(a.address, "ipv4"),
    );
    if (!address) return "review";
    const result = await new Promise<{ code: number; location?: string }>(
      (resolve, reject) => {
        const req = request(
          url,
          {
            method: "HEAD",
            family: 4,
            lookup: (_host, _options, callback) =>
              (callback as any)(null, address.address, 4),
            headers: { "User-Agent": "Handlio-Link-Check/1.0" },
          },
          (res) => {
            resolve({
              code: res.statusCode || 0,
              location: res.headers.location,
            });
            res.destroy();
          },
        );
        const timer = setTimeout(
          () => req.destroy(new Error("LINK_TIMEOUT")),
          5000,
        );
        req.once("close", () => clearTimeout(timer));
        req.once("error", reject);
        req.end();
      },
    );
    if (
      result.code >= 300 &&
      result.code < 400 &&
      result.location &&
      redirects < 2
    )
      return checkLink(new URL(result.location, url).href, redirects + 1);
    return result.code >= 200 && result.code < 400
      ? "reachable"
      : [404, 410].includes(result.code)
        ? "broken"
        : "review";
  } catch {
    return "review";
  }
}
const active = new Set<string>();
export function installLinkChecks(app: Express) {
  app.post("/api/projects/:id/check-links", authenticated, async (req, res) => {
    const p = owner(res.locals.user, String(req.params.id));
    editable(p);
    if (
      active.has(p.id) ||
      (one(
        "SELECT MAX(checked_at) AS n FROM link_checks WHERE project_id=?",
        p.id,
      )?.n || 0) >
        now() - 60000
    )
      throw new AppError(
        "RATE_LIMITED",
        429,
        "Wait one minute before checking project links again.",
      );
    active.add(p.id);
    try {
      const results: { url: string; status: string }[] = [];
      const urls = draftLinks(JSON.parse(p.draft));
      for (let i = 0; i < urls.length; i += 4)
        results.push(
          ...(await Promise.all(
            urls
              .slice(i, i + 4)
              .map(async (url) => ({ url, status: await checkLink(url) })),
          )),
        );
      tx(() => {
        for (const result of results)
          run(
            "INSERT OR REPLACE INTO link_checks VALUES (?,?,?,?,?)",
            p.id,
            p.revision,
            result.url,
            result.status,
            now(),
          );
        audit(res.locals.user.id, p.id, "external_links_checked", {
          revision: p.revision,
          count: results.length,
        });
      });
      res.json({
        revision: p.revision,
        results,
        note: "Checks use HTTPS HEAD without cookies or credentials. Restricted, inconclusive and IPv6-only links need manual review.",
      });
    } finally {
      active.delete(p.id);
    }
  });
}

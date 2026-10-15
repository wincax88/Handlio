import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { renderPage } from "../.work/seo/entry-server.js";
// The bundled renderer exports the same route list used by the HTTP server.
import { publicPaths } from "../.work/seo/entry-server.js";

await mkdir("dist/.prerender", { recursive: true });
const pages = Object.fromEntries(
  [...publicPaths, "/404"].map((route) => [route, renderPage(route)]),
);
await writeFile("dist/.prerender/pages.json", JSON.stringify(pages));
const logo = (await readFile("public/handlio-logo.png")).toString("base64");
const card = (await readFile("public/social-card.svg", "utf8")).replace(
  'href="./handlio-logo.png"',
  `href="data:image/png;base64,${logo}"`,
);
await sharp(Buffer.from(card)).png().toFile("dist/social-card.png");
console.log(`Prerendered ${publicPaths.length} public pages and the 404 page.`);

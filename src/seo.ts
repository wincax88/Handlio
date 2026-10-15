import {
  defaultSiteOrigin,
  isPublicPath,
  metaEntries,
  pageMetadata,
  structuredData,
} from "../shared/seo";

export function updatePageMetadata(path: string) {
  const origin =
    document.querySelector<HTMLMetaElement>('meta[name="handlio-origin"]')
      ?.content || defaultSiteOrigin;
  const allowIndexing =
    document.querySelector<HTMLMetaElement>('meta[name="handlio-indexing"]')
      ?.content === "enabled";
  document.title = pageMetadata(path).title;
  document.head
    .querySelectorAll("[data-handlio-seo]:not(title)")
    .forEach((node) => node.remove());
  for (const [attribute, key, value] of metaEntries(
    path,
    origin,
    allowIndexing,
  )) {
    const meta = document.createElement("meta");
    meta.setAttribute(attribute, key);
    meta.content = value;
    meta.dataset.handlioSeo = "";
    document.head.append(meta);
  }
  if (isPublicPath(path)) {
    const link = document.createElement("link");
    link.rel = "canonical";
    link.href = `${origin}${path}`;
    link.dataset.handlioSeo = "";
    document.head.append(link);
    const data = document.createElement("script");
    data.type = "application/ld+json";
    data.textContent = JSON.stringify(structuredData(path, origin));
    data.dataset.handlioSeo = "";
    document.head.append(data);
  }
}

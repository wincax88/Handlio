export const defaultSiteOrigin = "https://www.handlio.cloud";

export const publicPages = {
  "/": {
    title: "Handlio — Client Handoff Software & Screenshot Handbooks",
    description:
      "Turn screenshots into clear client handbooks for website and software handoffs. Share privately, answer questions, and export PDF or offline HTML. Start free.",
    name: "Client handoff software",
  },
  "/pricing": {
    title: "Pricing — Free Drafts & $19 Project Packs | Handlio",
    description:
      "Create a free handbook draft. Publish and share a project for $19 USD with 90 days of hosting, or extend hosting for $9. No subscription or automatic renewal.",
    name: "Pricing",
  },
  "/examples": {
    title: "Client Handoff Examples & Handbook Templates | Handlio",
    description:
      "Explore website operations and software implementation handbook templates. Read a fictional sample handoff and download sample PDF and offline HTML exports.",
    name: "Handbook examples",
  },
  "/help": {
    title: "Help Center — Create, Share & Export Handbooks | Handlio",
    description:
      "Learn how to prepare screenshots, publish a handbook, invite clients, collect version receipts, and export your work. Contact Handlio for account or payment help.",
    name: "Help center",
  },
  "/terms": {
    title: "Service Terms | Handlio",
    description:
      "Read Handlio service terms, project hosting periods, content responsibilities, export options, and the scope of version-specific client receipt records.",
    name: "Service terms",
  },
  "/privacy": {
    title: "Privacy & Data Handling | Handlio",
    description:
      "Understand how Handlio handles account data, reviewed screenshots, private client access, retention, and requests to export, correct, or delete your data.",
    name: "Privacy & data handling",
  },
  "/refund": {
    title: "Refunds & Payment Support | Handlio",
    description:
      "Find payment support for Handlio project packs and hosting extensions. Learn how to request a purchase review and how verified refund outcomes affect access.",
    name: "Refunds & payment support",
  },
} as const;

export type PublicPath = keyof typeof publicPages;
export const publicPaths = Object.keys(publicPages) as PublicPath[];
export function isPublicPath(path: string): path is PublicPath {
  return Object.hasOwn(publicPages, path);
}
export function isPrivatePath(path: string) {
  return path === "/auth" || path === "/ops" || /^\/(app|h)(\/|$)/.test(path);
}
export function pageMetadata(path: string) {
  if (isPublicPath(path)) return publicPages[path];
  if (isPrivatePath(path))
    return {
      title: path.startsWith("/h/")
        ? "Private Client Handbook | Handlio"
        : path === "/auth"
          ? "Sign In to Your Workspace | Handlio"
          : "Private Workspace | Handlio",
      description:
        "Sign in with your verified email to access your private Handlio workspace or invited client handbook.",
      name: "Private access",
    };
  return {
    title: "Page Not Found | Handlio",
    description:
      "This page is unavailable. Visit Handlio to create a client handbook or find help.",
    name: "Page not found",
  };
}

export function structuredData(path: string, origin: string) {
  if (!isPublicPath(path)) return null;
  const url = `${origin}${path === "/" ? "/" : path}`;
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Organization",
      "@id": `${origin}/#organization`,
      name: "Handlio Team",
      url: `${origin}/`,
      logo: `${origin}/handlio-logo.png`,
    },
    {
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      name: "Handlio",
      url: `${origin}/`,
      inLanguage: "en",
      publisher: { "@id": `${origin}/#organization` },
    },
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: publicPages[path].title,
      description: publicPages[path].description,
      inLanguage: "en",
      isPartOf: { "@id": `${origin}/#website` },
    },
  ];
  if (path === "/")
    graph.push({
      "@type": "WebApplication",
      name: "Handlio",
      url: `${origin}/`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web browser",
      description: publicPages["/"].description,
      license: "https://spdx.org/licenses/AGPL-3.0-only.html",
      featureList: [
        "Screenshot-based handbooks",
        "Private client invitations",
        "Version-specific questions and receipts",
        "PDF and offline HTML exports",
      ],
    });
  else
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Handlio",
          item: `${origin}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: publicPages[path].name,
          item: url,
        },
      ],
    });
  return { "@context": "https://schema.org", "@graph": graph };
}

export function metaEntries(
  path: string,
  origin: string,
  allowIndexing: boolean,
) {
  const page = pageMetadata(path);
  return [
    ["name", "description", page.description],
    [
      "name",
      "robots",
      allowIndexing && isPublicPath(path)
        ? "index, follow, max-image-preview:large"
        : "noindex, nofollow",
    ],
    ["property", "og:type", "website"],
    ["property", "og:site_name", "Handlio"],
    ["property", "og:locale", "en_US"],
    ["property", "og:title", page.title],
    ["property", "og:description", page.description],
    ["property", "og:image", `${origin}/social-card.png`],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", "Handlio — Clear guides. Smooth handoffs."],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", page.title],
    ["name", "twitter:description", page.description],
    ["name", "twitter:image", `${origin}/social-card.png`],
    ["name", "twitter:image:alt", "Handlio — Clear guides. Smooth handoffs."],
    ...(isPublicPath(path) ? [["property", "og:url", `${origin}${path}`]] : []),
  ];
}

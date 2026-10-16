import type { Draft, Guide } from "./model.js";

export function canonicalLanguage(value: string): string | null {
  const tag = value.trim();
  if (tag.length < 2 || tag.length > 80) return null;
  try {
    return Intl.getCanonicalLocales(tag)[0] || null;
  } catch {
    return null;
  }
}
export function isValidTimezone(value: string): boolean {
  const zone = value.trim();
  try {
    return (
      zone.length <= 100 &&
      /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(zone) &&
      !!new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
        .timeZone
    );
  } catch {
    return false;
  }
}
export const defaultSectionTitles = {
  overview: "Project overview",
  checklist: "Handoff checklist",
  support: "Support & maintenance",
};
export type FixedSection = keyof typeof defaultSectionTitles;
type Structure = {
  guides: Guide[];
  sectionOrder?: string[];
  sectionTitles?: typeof defaultSectionTitles;
};
export function sectionOrder(d: Structure): string[] {
  const known = new Set([
    "overview",
    "checklist",
    "support",
    ...d.guides.map((g) => `guide:${g.id}`),
  ]);
  const order = [
    ...new Set(
      d.sectionOrder || [
        "overview",
        ...d.guides.map((g) => `guide:${g.id}`),
        "checklist",
        "support",
      ],
    ),
  ].filter((id) => known.has(id));
  for (const g of d.guides) {
    const key = `guide:${g.id}`;
    if (!order.includes(key)) {
      const lastGuide = Math.max(
        -1,
        ...order.map((id, index) => (id.startsWith("guide:") ? index : -1)),
      );
      const checklist = order.indexOf("checklist");
      order.splice(
        lastGuide >= 0
          ? lastGuide + 1
          : checklist >= 0
            ? checklist
            : order.length,
        0,
        key,
      );
    }
  }
  for (const id of Object.keys(defaultSectionTitles))
    if (!order.includes(id)) order.push(id);
  return order;
}
export type HandbookSection =
  | { kind: "fixed"; id: FixedSection; title: string; anchor: string }
  | {
      kind: "guide";
      id: string;
      title: string;
      anchor: string;
      guide: Guide;
      number: number;
    };
export function handbookSections(d: Structure): HandbookSection[] {
  let number = 0;
  return sectionOrder(d).flatMap((id): HandbookSection[] => {
    if (id.startsWith("guide:")) {
      const guide = d.guides.find((g) => `guide:${g.id}` === id);
      return guide
        ? [
            {
              kind: "guide",
              id,
              title: guide.title,
              anchor: `guide-${guide.id}`,
              guide,
              number: ++number,
            },
          ]
        : [];
    }
    const fixed = id as FixedSection;
    return [
      {
        kind: "fixed",
        id: fixed,
        title: d.sectionTitles?.[fixed] || defaultSectionTitles[fixed],
        anchor: {
          overview: "handbook-overview",
          checklist: "handoff-checklist",
          support: "support",
        }[fixed],
      },
    ];
  });
}
export function presentationDefaults(d: Draft): Draft {
  return {
    ...d,
    language: d.language || "en",
    timezone: d.timezone || "UTC",
    sectionTitles: { ...defaultSectionTitles, ...d.sectionTitles },
    sectionOrder: sectionOrder(d),
  };
}
export function projectDate(
  value: string | number,
  d: { timezone?: string },
): string {
  return (
    new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: d.timezone || "UTC",
    }).format(new Date(value)) + ` (${d.timezone || "UTC"})`
  );
}

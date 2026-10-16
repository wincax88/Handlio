import { z } from "zod";
import {
  defaultSectionTitles,
  canonicalLanguage,
  isValidTimezone,
  sectionOrder,
} from "./handbook.js";
export const languageSchema = z
  .string()
  .trim()
  .refine(
    (value) => canonicalLanguage(value) !== null,
    "Use a valid language tag, such as en or zh-CN.",
  )
  .transform((value) => canonicalLanguage(value)!);
export const timezoneSchema = z
  .string()
  .trim()
  .refine(
    isValidTimezone,
    "Use a valid time zone, such as UTC or America/New_York.",
  );
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const safeUrl = z.union([
  z.literal(""),
  z
    .string()
    .url()
    .refine((v) => v.startsWith("https://"), "Use an HTTPS URL"),
]);
export const stepSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(120),
  body: z.string().max(2000),
  expected: z.string().max(500),
  warning: z.string().max(500),
  source: z.string().max(500),
  alt: z.string().max(500),
  assetId: z.string().nullable(),
  reviewed: z.boolean(),
  textOnly: z.boolean(),
  aiPending: z.boolean().default(false),
});
export const guideSchema = z.object({
  id: z.string(),
  title: z.string().max(160),
  goal: z.string().max(1000),
  prerequisites: z.string().max(1000),
  audience: z.string().max(160),
  completion: z.string().max(1000),
  faq: z.string().max(2000),
  included: z.boolean(),
  steps: z.array(stepSchema).max(200),
});
export const draftSchema = z
  .object({
    language: languageSchema.default("en"),
    timezone: timezoneSchema.default("UTC"),
    sectionTitles: z
      .object({
        overview: z.string().trim().min(1).max(120),
        checklist: z.string().trim().min(1).max(120),
        support: z.string().trim().min(1).max(120),
      })
      .default(() => ({ ...defaultSectionTitles })),
    sectionOrder: z.array(z.string().min(1).max(200)).max(13).optional(),
    title: z.string().min(1).max(160),
    intro: z.string().max(1000),
    supportEmail: z.union([emailSchema, z.literal("")]),
    supportUrl: safeUrl,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    logoId: z.string().nullable().default(null),
    maintenance: z.string().max(2000),
    terms: z.array(z.string().max(100)).max(30),
    glossary: z
      .array(
        z.object({
          term: z.string().trim().min(1).max(100),
          aliases: z.array(z.string().trim().min(1).max(100)).max(10),
        }),
      )
      .max(30)
      .default([]),
    guides: z.array(guideSchema).max(10),
    checklist: z
      .array(
        z.object({
          id: z.string(),
          title: z.string().min(1).max(160),
          description: z.string().max(1000),
          guideId: z.string().nullable().default(null),
          required: z.boolean(),
          done: z.boolean(),
        }),
      )
      .max(50),
  })
  .superRefine((d, context) => {
    if (
      d.sectionOrder &&
      (new Set(d.sectionOrder).size !== d.sectionOrder.length ||
        Object.keys(defaultSectionTitles).some(
          (key) => !d.sectionOrder!.includes(key),
        ) ||
        d.sectionOrder.some(
          (key) =>
            !Object.hasOwn(defaultSectionTitles, key) &&
            !key.startsWith("guide:"),
        ))
    ) {
      context.addIssue({
        code: "custom",
        path: ["sectionOrder"],
        message:
          "Keep each fixed section exactly once and use guide references for instructions.",
      });
    }
  })
  .transform((d) => {
    const order = sectionOrder(d);
    return {
      ...d,
      sectionOrder: order,
      guides: [...d.guides].sort(
        (a, b) =>
          order.indexOf(`guide:${a.id}`) - order.indexOf(`guide:${b.id}`),
      ),
    };
  });
export type Step = z.infer<typeof stepSchema>;
export type Guide = z.infer<typeof guideSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type Role = "Viewer" | "Reviewer" | "Confirmer";
export type Release = {
  id: string;
  version: number;
  status: string;
  hash: string;
  publishedAt: string;
  summary: string;
  snapshot: Draft & { projectName: string; clientName: string };
  changes: { added: string[]; removed: string[]; modified: string[] };
};
export type Issue = {
  code: string;
  message: string;
  guideId?: string;
  stepId?: string;
};
export const LIMITS = {
  free: {
    guides: 3,
    steps: 20,
    storage: 100 * 1024 * 1024,
    ai: 10,
    exports: 0,
  },
  paid: {
    guides: 10,
    steps: 200,
    storage: 1024 * 1024 * 1024,
    ai: 300,
    exports: 200,
  },
};
export const PRICING = {
  project: 1900,
  renewal: 900,
  currency: "USD",
  days: 90,
  graceDays: 30,
  version: "trial-2026-01",
};
export function createDraft(
  template: string,
  title: string,
  makeId: () => string,
): Draft {
  const sections =
    template === "website"
      ? ["Getting started", "Managing content", "Publishing & maintenance"]
      : template === "software"
        ? ["Getting started", "Everyday workflows", "Administration & support"]
        : ["Your first guide"];
  const guides = sections.map((t) => ({
    id: makeId(),
    title: t,
    goal: "",
    prerequisites: "",
    audience: "",
    completion: "",
    faq: "",
    included: true,
    steps: [],
  }));
  return {
    language: "en",
    timezone: "UTC",
    sectionTitles: { ...defaultSectionTitles },
    sectionOrder: sectionOrder({ guides }),
    title,
    intro: "",
    supportEmail: "",
    supportUrl: "",
    color: "#0d7d77",
    logoId: null,
    maintenance: "",
    terms: [],
    glossary: [],
    guides,
    checklist: [
      "Key workflows are explained",
      "Permissions and roles are explained",
      "Support channels are provided",
      "Maintenance boundaries are clear",
    ].map((title) => ({
      id: makeId(),
      title,
      description: "",
      guideId: null,
      required: true,
      done: false,
    })),
  };
}

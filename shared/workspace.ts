import { z } from "zod";
import { emailSchema } from "./model.js";

export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  displayName: z.string().trim().max(120).default(""),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }),
  supportEmail: z.union([emailSchema, z.literal("")]),
  logoId: z.string().nullable().default(null),
  expiryReminders: z.boolean().default(true),
  questionNotifications: z.boolean().default(true),
  receiptNotifications: z.boolean().default(true),
  marketingEmails: z.boolean().default(false),
  onboardingComplete: z.boolean().default(false),
});
export type WorkspaceSettings = z.infer<typeof settingsSchema>;
export const workspaceDefaults: WorkspaceSettings = {
  name: "My workspace",
  displayName: "",
  timezone: "UTC",
  supportEmail: "",
  logoId: null,
  expiryReminders: true,
  questionNotifications: true,
  receiptNotifications: true,
  marketingEmails: false,
  onboardingComplete: false,
};
export function workspaceSettings(raw: string): WorkspaceSettings {
  const stored = JSON.parse(raw);
  // Existing workspaces keep their established flow; only new accounts onboard.
  return { ...workspaceDefaults, onboardingComplete: true, ...stored };
}

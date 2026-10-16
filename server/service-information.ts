import type { Express } from "express";
import { aiConfiguration } from "./ai.js";
export function installServiceInformation(app: Express) {
  app.get("/api/service-information", (_req, res) =>
    res.json({
      operator: process.env.OPERATOR_NAME || "Handlio Team",
      operatorRegion: process.env.OPERATOR_REGION || "Mainland China",
      hostingRegion: process.env.DATA_HOSTING_REGION || "Pending confirmation",
      supportEmail: process.env.SUPPORT_EMAIL || "support@handlio.cloud",
      emailProvider: process.env.MAIL_PROVIDER || "Not disclosed",
      aiConfigured: aiConfiguration().enabled,
      aiProvider: aiConfiguration().provider || "Not configured",
      aiPrivacyNotice:
        aiConfiguration().notice || "AI processing is not enabled.",
      retention: {
        verificationMinutes: 10,
        sessionHours: 12,
        temporaryExportsDays: 7,
        unreferencedAssetsHours: 24,
        deletedProjectCleanupDays: 7,
        backupsMaximumDays: 35,
      },
      backupConfigured: !!(
        process.env.BACKUP_KEY && process.env.BACKUP_DIRECTORY
      ),
    }),
  );
}

// One consented deployment smoke call using a generated, fictional screenshot only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
const selected =
  process.env.AI_PROVIDER?.trim() ||
  (process.env.AI_ADAPTER_URL
    ? "adapter"
    : process.env.DEEPSEEK_API_KEY
      ? "deepseek"
      : "");
if (selected !== "deepseek") {
  console.log("DeepSeek is not selected; no AI smoke request sent.");
} else {
  if (!process.env.DEEPSEEK_API_KEY?.trim())
    throw new Error("DEEPSEEK_API_KEY is required for DeepSeek.");
  const temporaryData = mkdtempSync(
    path.join(tmpdir(), "handlio-deepseek-smoke-"),
  );
  process.env.DATA_DIR = temporaryData;
  const { requestAiSuggestions, deepseekModel } =
    await import("../server/ai.js");
  const { db } = await import("../server/db.js");
  try {
    const screenshot = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400"><rect width="1000" height="400" fill="white"/><text x="50" y="80" font-size="36" font-family="sans-serif">Fictional CMS — Test article</text><rect x="50" y="150" width="260" height="90" rx="12" fill="#163c6b"/><text x="80" y="207" fill="white" font-size="32" font-family="sans-serif">Save draft</text></svg>`,
      ),
    )
      .png()
      .toBuffer();
    const result = await requestAiSuggestions({
      maxCostUsd: 0.05,
      costCurrency: "USD",
      instruction: "Visible facts only",
      promptVersion: "suggestions-v2",
      language: "en",
      terms: [],
      sources: [
        {
          sourceStepId: "fictional-save-draft",
          title: "",
          body: "",
          assetHash: "synthetic-smoke-only",
          imageBase64: screenshot.toString("base64"),
        },
      ],
    });
    if (
      !/save\s+(?:the\s+)?draft/i.test(
        result.suggestions.map((s: any) => `${s.title} ${s.body}`).join(" "),
      )
    )
      throw new Error(
        "DeepSeek did not identify the fictional screenshot control.",
      );
    console.log(
      JSON.stringify({
        provider: "deepseek",
        requestedModel: deepseekModel,
        returnedModel: result.model,
        suggestions: result.suggestions.length,
        visionVerified: true,
        usage: result.usage,
        costUpperBoundUsd: result.costUpperBoundUsd,
        actualChargeUsd: result.cost,
      }),
    );
  } finally {
    db.close();
    rmSync(temporaryData, { recursive: true, force: true });
  }
}

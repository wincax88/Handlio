import { generateExport } from "./export.js";
process.once("message", async (input: any) => {
  try {
    const result = await generateExport(
      input.release,
      input.jobId,
      input.format,
      input.paper,
    );
    process.send?.({ ok: true, result }, () => process.exit(0));
  } catch {
    process.send?.({ ok: false }, () => process.exit(1));
  }
});

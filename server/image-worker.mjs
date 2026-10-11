import sharp from "sharp";
// Decoder lives in a short-lived process without provider credentials.
process.once("message", async ({ bytes }) => {
  try {
    const input = sharp(bytes, {
      limitInputPixels: 20000000,
      failOn: "warning",
    });
    const meta = await input.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1 ||
      !meta.width ||
      !meta.height ||
      meta.width > 8000 ||
      meta.height > 8000
    )
      throw new Error("IMAGE_LIMIT");
    const { data, info } = await input
      .rotate()
      .png()
      .toBuffer({ resolveWithObject: true });
    process.send?.(
      { ok: true, data, width: info.width, height: info.height },
      () => process.exit(0),
    );
  } catch {
    process.send?.({ ok: false }, () => process.exit(1));
  }
});

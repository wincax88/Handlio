import sharp from "sharp";
// Decoder lives in a short-lived process without provider credentials.
process.once("message", async ({ bytes, overlay }) => {
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
    const pipeline = input.rotate();
    if (overlay) pipeline.composite([{ input: Buffer.from(overlay) }]);
    const { data, info } = await pipeline
      .png()
      .toBuffer({ resolveWithObject: true });
    const previewWidth = Math.min(1000, info.width);
    const gray = await sharp(data)
      .resize({ width: previewWidth })
      .flatten({ background: "#ffffff" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = gray.info.width,
      h = gray.info.height,
      pixels = gray.data,
      visited = new Uint8Array(w * h);
    let glyphs = 0,
      tiny = 0;
    const stack = [];
    for (let index = 0; index < w * h; index++) {
      if (visited[index] || pixels[index * gray.info.channels] > 100) continue;
      visited[index] = 1;
      stack.push(index);
      let count = 0,
        minX = w,
        maxX = 0,
        minY = h,
        maxY = 0;
      while (stack.length) {
        const p = stack.pop(),
          x = p % w,
          y = Math.floor(p / w);
        count++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (const next of [
          x > 0 ? p - 1 : -1,
          x + 1 < w ? p + 1 : -1,
          y > 0 ? p - w : -1,
          y + 1 < h ? p + w : -1,
        ])
          if (
            next >= 0 &&
            !visited[next] &&
            pixels[next * gray.info.channels] <= 100
          ) {
            visited[next] = 1;
            stack.push(next);
          }
      }
      const gw = maxX - minX + 1,
        gh = maxY - minY + 1;
      if (
        count >= 3 &&
        count <= 500 &&
        gw >= 1 &&
        gw <= 30 &&
        gh >= 3 &&
        gh <= 40
      ) {
        glyphs++;
        if ((gh * Math.min(760, info.width)) / previewWidth < 8) tiny++;
      }
    }
    process.send?.(
      {
        ok: true,
        data,
        width: info.width,
        height: info.height,
        quality: {
          smallText: glyphs >= 40 && tiny / glyphs > 0.3,
          glyphCandidates: glyphs,
          tinyCandidates: tiny,
          method: "contrast-component-review-v1",
        },
      },
      () => process.exit(0),
    );
  } catch {
    process.send?.({ ok: false }, () => process.exit(1));
  }
});

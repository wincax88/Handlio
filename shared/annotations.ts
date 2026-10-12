import { z } from "zod";
const coordinate = z.number().finite().min(-8000).max(8000);
export const annotationSchema = z.object({
  type: z.enum(["rectangle", "arrow", "number", "label"]),
  x: coordinate,
  y: coordinate,
  w: coordinate,
  h: coordinate,
  label: z.string().max(80),
});
export const annotationsSchema = z.array(annotationSchema).max(100);
export type Annotation = z.infer<typeof annotationSchema>;
export function annotationSvg(
  width: number,
  height: number,
  marks: Annotation[],
) {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    );
  const scale = Math.max(1, width / 800);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${marks
    .map((m) => {
      if (m.type === "rectangle")
        return `<rect x="${Math.min(m.x, m.x + m.w)}" y="${Math.min(m.y, m.y + m.h)}" width="${Math.abs(m.w)}" height="${Math.abs(m.h)}" fill="none" stroke="#d35536" stroke-width="${3 * scale}"/>`;
      if (m.type === "arrow") {
        const angle = Math.atan2(m.h, m.w),
          endX = m.x + m.w,
          endY = m.y + m.h,
          length = 14 * scale;
        return `<path d="M${m.x} ${m.y} L${endX} ${endY}" fill="none" stroke="#d35536" stroke-width="${3 * scale}"/><path d="M${endX} ${endY} L${endX - length * Math.cos(angle - Math.PI / 6)} ${endY - length * Math.sin(angle - Math.PI / 6)} L${endX - length * Math.cos(angle + Math.PI / 6)} ${endY - length * Math.sin(angle + Math.PI / 6)} Z" fill="#d35536"/>`;
      }
      if (m.type === "number")
        return `<circle cx="${m.x}" cy="${m.y}" r="${16 * scale}" fill="#d35536"/><text x="${m.x}" y="${m.y + 6 * scale}" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="${16 * scale}" font-weight="bold">${escape(m.label)}</text>`;
      return `<text x="${m.x}" y="${m.y + 20 * scale}" fill="#17212b" stroke="#f8f5eb" stroke-width="${4 * scale}" paint-order="stroke" font-family="sans-serif" font-size="${20 * scale}" font-weight="bold">${escape(m.label)}</text>`;
    })
    .join("")}</svg>`;
}

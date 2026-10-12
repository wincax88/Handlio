export type ContentChange = { path: string; before: any; after: any };
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const keyed = (value: any) =>
  Array.isArray(value) &&
  value.every((item) => item && typeof item.id === "string");
const record = (value: any) =>
  value && typeof value === "object" && !Array.isArray(value);
export function contentChanges(
  before: any,
  after: any,
  path = "Handbook",
): ContentChange[] {
  if (same(before, after)) return [];
  if (keyed(before) && keyed(after)) {
    const changes: ContentChange[] = [];
    if (
      !same(
        before.map((v: any) => v.id),
        after.map((v: any) => v.id),
      )
    )
      changes.push({
        path: `${path} / order`,
        before: before.map((v: any) => v.title || v.id),
        after: after.map((v: any) => v.title || v.id),
      });
    for (const key of new Set([...before, ...after].map((v: any) => v.id))) {
      const a = before.find((v: any) => v.id === key),
        b = after.find((v: any) => v.id === key);
      changes.push(
        ...contentChanges(
          a,
          b,
          `${path} / ${b?.title || a?.title || key} [${key}]`,
        ),
      );
    }
    return changes;
  }
  if (record(before) && record(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => key !== "id")
      .flatMap((key) =>
        contentChanges(before[key], after[key], `${path} / ${key}`),
      );
  return [{ path, before, after }];
}
export type MergeConflict = {
  path: string;
  base: any;
  local: any;
  server: any;
};
export function mergeContent(
  base: any,
  local: any,
  server: any,
  choices: Record<string, any> = {},
) {
  const conflicts: MergeConflict[] = [];
  function merge(a: any, b: any, c: any, path: string): any {
    if (same(b, c)) return b;
    if (same(a, b)) return c;
    if (same(a, c)) return b;
    if (keyed(a) && keyed(b) && keyed(c)) {
      const order = merge(
        a.map((v: any) => v.id),
        b.map((v: any) => v.id),
        c.map((v: any) => v.id),
        `${path}/order`,
      );
      const keys = [
        ...new Set([
          ...order,
          ...b.map((v: any) => v.id),
          ...c.map((v: any) => v.id),
        ]),
      ];
      return keys
        .map((key) =>
          merge(
            a.find((v: any) => v.id === key),
            b.find((v: any) => v.id === key),
            c.find((v: any) => v.id === key),
            `${path}/${key}`,
          ),
        )
        .filter((v) => v !== undefined);
    }
    if (record(a) && record(b) && record(c)) {
      const result: Record<string, any> = {};
      for (const key of new Set([
        ...Object.keys(a),
        ...Object.keys(b),
        ...Object.keys(c),
      ])) {
        const value = merge(a[key], b[key], c[key], `${path}/${key}`);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (Object.hasOwn(choices, path)) return choices[path];
    conflicts.push({ path, base: a, local: b, server: c });
    return b;
  }
  return { value: merge(base, local, server, "draft"), conflicts };
}

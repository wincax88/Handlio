import type { Draft } from "./model.js";
export function terminologyHints(
  text: string,
  draft: Pick<Draft, "terms" | "glossary">,
) {
  const glossary = draft.glossary?.length
    ? draft.glossary
    : draft.terms.map((term) => ({ term, aliases: [] as string[] }));
  const hints: { preferred: string; found: string }[] = [];
  for (const entry of glossary) {
    for (const alias of entry.aliases)
      if (text.toLocaleLowerCase().includes(alias.toLocaleLowerCase()))
        hints.push({ preferred: entry.term, found: alias });
    const escaped = entry.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of text.matchAll(new RegExp(escaped, "giu")))
      if (
        match[0] !== entry.term &&
        !hints.some((h) => h.preferred === entry.term && h.found === match[0])
      )
        hints.push({ preferred: entry.term, found: match[0] });
  }
  return hints;
}

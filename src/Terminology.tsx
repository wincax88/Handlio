import { useEffect, useState } from "react";
import type { ProjectEditorProps } from "./ProjectPage";
import { terminologyHints } from "../shared/terminology";
import { Button, ErrorNotice, Field, Panel } from "./ui";
export function Terminology({
  draft,
  update,
}: Pick<ProjectEditorProps, "draft" | "update">) {
  const encoded = JSON.stringify(draft.glossary || draft.terms);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      setText(
        (draft.glossary?.length
          ? draft.glossary.map(
              (g) =>
                `${g.term}${g.aliases.length ? " | " + g.aliases.join(", ") : ""}`,
            )
          : draft.terms
        ).join("\n"),
      ),
    [encoded],
  );
  return (
    <Panel title="Project terminology">
      <p>
        Use one preferred term for the same action or interface label. Up to 30
        terms; aliases produce review hints without changing your text
        automatically.
      </p>
      <ErrorNotice error={error} />
      <Field
        label="Preferred terms and aliases"
        hint="One line per term: Preview | Review page, View changes"
      >
        <textarea
          rows={6}
          maxLength={36000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <Button
        kind="secondary"
        onClick={() => {
          try {
            const glossary = text
              .split("\n")
              .filter((line) => line.trim())
              .map((line) => {
                const [term, ...aliases] = line.split("|");
                return {
                  term: term.trim(),
                  aliases: aliases
                    .join("|")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                };
              });
            const seen = new Set(
              glossary.map((g) => g.term.toLocaleLowerCase()),
            );
            if (seen.size !== glossary.length)
              throw new Error("Use each preferred term only once.");
            if (
              glossary.length > 30 ||
              glossary.some(
                (g) =>
                  !g.term ||
                  g.term.length > 100 ||
                  g.aliases.length > 10 ||
                  g.aliases.some((alias) => alias.length > 100),
              )
            )
              throw new Error("Invalid terminology limits.");
            update((d) => {
              d.glossary = glossary;
              d.terms = glossary.map((g) => g.term);
            });
            setError(null);
          } catch {
            setError(
              "Enter up to 30 unique terms, up to 100 characters each, with no more than 10 aliases per term.",
            );
          }
        }}
      >
        Save terminology
      </Button>
    </Panel>
  );
}
export function TermHints({
  text,
  draft,
}: {
  text: string;
  draft: ProjectEditorProps["draft"];
}) {
  const hints = terminologyHints(text, draft);
  return hints.length ? (
    <div className="notice">
      <div>
        <strong>Terminology review</strong>
        {hints.map((hint) => (
          <p key={`${hint.preferred}:${hint.found}`}>
            Review “{hint.found}”; your project uses “{hint.preferred}”.
          </p>
        ))}
      </div>
    </div>
  ) : null;
}

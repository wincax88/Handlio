import { useState } from "react";
import type { Draft, Release } from "../shared/model";
import { contentChanges, mergeContent } from "../shared/compare";
import { assetUrl } from "./api";
import { Badge, Button, Field, Panel } from "./ui";

function valueText(value: any): string {
  return value === undefined
    ? "Removed"
    : typeof value === "string"
      ? value || "Empty"
      : JSON.stringify(value, null, 2);
}
function ChangedText({
  before,
  after,
  side,
}: {
  before: any;
  after: any;
  side: "before" | "after";
}) {
  const value = side === "before" ? before : after;
  if (typeof before !== "string" || typeof after !== "string")
    return <pre>{valueText(value)}</pre>;
  let start = 0,
    end = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++;
  const middle = value.slice(start, value.length - end);
  return (
    <pre>
      {value.slice(0, start)}
      {side === "before" ? <del>{middle}</del> : <mark>{middle}</mark>}
      {end ? value.slice(-end) : ""}
    </pre>
  );
}
export function DraftMerge({
  base,
  local,
  server,
  onSave,
  onDiscard,
  busy,
}: {
  base: Draft;
  local: Draft;
  server: Draft;
  onSave: (draft: Draft) => Promise<void>;
  onDiscard: () => void;
  busy: boolean;
}) {
  const [choices, setChoices] = useState<Record<string, any>>({});
  const initial = mergeContent(base, local, server);
  const merged = mergeContent(base, local, server, choices);
  return (
    <section className="draft-merge">
      <p>
        Changes made in only one copy are merged automatically. Choose how to
        combine each field changed in both copies. Published versions stay
        unchanged.
      </p>
      {initial.conflicts.map((conflict) => (
        <div className="merge-field" key={conflict.path}>
          <h3>{conflict.path}</h3>
          <div className="content-diff">
            <div>
              <span className="eyebrow">YOUR UNSAVED COPY</span>
              <pre>{valueText(conflict.local)}</pre>
              <Button
                kind="secondary"
                onClick={() =>
                  setChoices({ ...choices, [conflict.path]: conflict.local })
                }
              >
                Keep my value
              </Button>
            </div>
            <div>
              <span className="eyebrow">NEWER SAVED COPY</span>
              <pre>{valueText(conflict.server)}</pre>
              <Button
                kind="secondary"
                onClick={() =>
                  setChoices({ ...choices, [conflict.path]: conflict.server })
                }
              >
                Use saved value
              </Button>
            </div>
          </div>
          {typeof conflict.local === "string" &&
            typeof conflict.server === "string" && (
              <Field label={`Merged ${conflict.path}`}>
                <textarea
                  rows={3}
                  value={
                    Object.hasOwn(choices, conflict.path)
                      ? choices[conflict.path]
                      : conflict.local
                  }
                  onChange={(e) =>
                    setChoices({ ...choices, [conflict.path]: e.target.value })
                  }
                />
              </Field>
            )}
          <Badge
            tone={Object.hasOwn(choices, conflict.path) ? "green" : "amber"}
          >
            {Object.hasOwn(choices, conflict.path)
              ? "Chosen"
              : "Choose a merge"}
          </Badge>
        </div>
      ))}
      {!initial.conflicts.length && (
        <p>These changes can be merged without field conflicts.</p>
      )}
      <details>
        <summary>
          Review all merged changes ({contentChanges(base, merged.value).length}
          )
        </summary>
        {contentChanges(base, merged.value).map((change) => (
          <div key={change.path}>
            <strong>{change.path}</strong>
            <pre>{valueText(change.after)}</pre>
          </div>
        ))}
      </details>
      <div className="action-row">
        <Button
          disabled={busy || merged.conflicts.length > 0}
          onClick={() => void onSave(merged.value)}
        >
          Save merged draft
        </Button>
        <Button
          kind="secondary"
          onClick={() =>
            void navigator.clipboard.writeText(JSON.stringify(local, null, 2))
          }
        >
          Copy my unsaved text
        </Button>
        <Button kind="text" disabled={busy} onClick={onDiscard}>
          Discard local changes and reload
        </Button>
      </div>
    </section>
  );
}
export function VersionComparison({
  releases,
  draft,
  projectName,
  clientName,
}: {
  releases: Release[];
  draft: Draft;
  projectName: string;
  clientName: string;
}) {
  const eligible = releases.filter((r) => r.status !== "security_revoked");
  const [beforeId, setBeforeId] = useState(
    eligible[1]?.id || eligible[0]?.id || "draft",
  );
  const [afterId, setAfterId] = useState(eligible[0]?.id || "draft");
  const before = eligible.find((r) => r.id === beforeId),
    after = eligible.find((r) => r.id === afterId);
  const publishedDraft = {
    ...draft,
    projectName,
    clientName,
    guides: draft.guides
      .filter((g) => g.included)
      .map((g) => ({
        ...g,
        steps: g.steps.map((s) => ({ ...s, source: "" })),
      })),
  };
  const a = before?.snapshot || publishedDraft,
    b = after?.snapshot || publishedDraft;
  const changes = contentChanges(a, b);
  function options() {
    return (
      <>
        <option value="draft">Current draft</option>
        {eligible.map((r) => (
          <option key={r.id} value={r.id}>
            Version v{r.version} · {r.summary}
          </option>
        ))}
      </>
    );
  }
  return (
    <Panel title="See exactly what changed">
      <p>
        Compare handbook fields, guides, checklist items, step text and
        screenshots. Comparing a draft does not publish it.
      </p>
      <div className="form-grid">
        <Field label="Compare from">
          <select
            value={beforeId}
            onChange={(e) => setBeforeId(e.target.value)}
          >
            {options()}
          </select>
        </Field>
        <Field label="Compare to">
          <select value={afterId} onChange={(e) => setAfterId(e.target.value)}>
            {options()}
          </select>
        </Field>
      </div>
      <p>{changes.length} changed fields</p>
      {!changes.length && (
        <p className="muted">No differences in the selected content.</p>
      )}
      {changes.map((change) => (
        <details className="change-detail" key={change.path}>
          <summary>
            {change.path} ·{" "}
            {change.before === undefined
              ? "Added"
              : change.after === undefined
                ? "Removed"
                : "Modified"}
          </summary>
          <div className="content-diff">
            <div>
              <span className="eyebrow">BEFORE</span>
              {change.path.endsWith("/ assetId") ||
              change.path.endsWith("/ logoId") ? (
                change.before ? (
                  <img
                    src={assetUrl(change.before, before?.id)}
                    alt="Previous reviewed image"
                  />
                ) : (
                  <p>No image</p>
                )
              ) : (
                <ChangedText
                  before={change.before}
                  after={change.after}
                  side="before"
                />
              )}
            </div>
            <div>
              <span className="eyebrow">AFTER</span>
              {change.path.endsWith("/ assetId") ||
              change.path.endsWith("/ logoId") ? (
                change.after ? (
                  <img
                    src={assetUrl(change.after, after?.id)}
                    alt="Updated reviewed image"
                  />
                ) : (
                  <p>No image</p>
                )
              ) : (
                <ChangedText
                  before={change.before}
                  after={change.after}
                  side="after"
                />
              )}
            </div>
          </div>
        </details>
      ))}
    </Panel>
  );
}

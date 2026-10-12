import { useEffect, useState, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  FileText,
  ImagePlus,
  Merge,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  X,
  ArrowDownUp,
  Square,
  ArrowUpRight,
  Type,
  Crop,
  ShieldCheck,
} from "lucide-react";
import type { Guide, Step } from "../shared/model";
import type { ProjectEditorProps } from "./ProjectPage";
import { TermHints } from "./Terminology";
import { api, assetUrl, navigate, send } from "./api";
import { Badge, Button, Empty, ErrorNotice, Field, Link } from "./ui";
export const newStep = (): Step => ({
  id: crypto.randomUUID(),
  title: "",
  body: "",
  expected: "",
  warning: "",
  source: "",
  alt: "",
  assetId: null,
  reviewed: false,
  textOnly: true,
  aiPending: false,
});
export function Editor({
  project: p,
  draft,
  update,
  session,
  guideId,
  flush,
  onGuideChange,
}: ProjectEditorProps & {
  guideId?: string;
  onGuideChange?: (id: string) => void;
}) {
  const [gid, setGid] = useState(guideId || draft.guides[0]?.id);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [guideSettings, setGuideSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [undo, setUndo] = useState<Guide | null>(null);
  useEffect(() => {
    if (guideId) setGid(guideId);
  }, [guideId]);
  const guide = draft.guides.find((g) => g.id === gid) || draft.guides[0];
  const step = guide?.steps.find((s) => s.id === sid) || guide?.steps[0];
  useEffect(() => {
    if (guide) onGuideChange?.(guide.id);
  }, [guide?.id, onGuideChange]);
  function changeStep(key: keyof Step, value: any) {
    update((d) => {
      const s = d.guides
        .find((g) => g.id === guide.id)!
        .steps.find((s) => s.id === step!.id)!;
      (s as any)[key] = value;
      if (!["reviewed", "aiPending"].includes(key)) s.reviewed = false;
    });
  }
  function changeGuide(key: keyof Guide, value: any) {
    update((d) => {
      (d.guides.find((g) => g.id === guide.id)! as any)[key] = value;
    });
  }
  function move(offset: number) {
    if (!step) return;
    update((d) => {
      const list = d.guides.find((g) => g.id === guide.id)!.steps;
      const index = list.findIndex((s) => s.id === step.id);
      if (index + offset >= 0 && index + offset < list.length) {
        const [s] = list.splice(index, 1);
        list.splice(index + offset, 0, s);
      }
    });
  }
  async function generate() {
    if (!step) return;
    setBusy(true);
    setError(null);
    try {
      await flush();
      const job = await send(`/projects/${p.id}/ai-jobs`, {
        stepIds: [step.id],
        consent,
      });
      for (let attempt = 0; attempt < 95; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        const result = await api(`/jobs/${job.jobId}`);
        if (result.state === "succeeded") {
          setAi(result.output);
          return;
        }
        if (["failed", "canceled"].includes(result.state))
          throw new Error(result.error || "AI task failed.");
      }
      throw new Error(
        "The task is taking longer than expected. Check its status in the project.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!guide)
    return (
      <Empty
        title="Create your first guide"
        body="A guide groups the steps for one practical goal."
        action={
          <Button
            onClick={() => {
              const g: Guide = {
                id: crypto.randomUUID(),
                title: "New guide",
                goal: "",
                prerequisites: "",
                audience: "",
                completion: "",
                faq: "",
                included: true,
                steps: [],
              };
              update((d) => d.guides.push(g));
              setGid(g.id);
            }}
          >
            Add guide
          </Button>
        }
      />
    );
  return (
    <div className="editor-layout">
      <aside className="editor-outline">
        <div className="outline-heading">
          <span>GUIDE OUTLINE</span>
          <button
            className="icon-button"
            title="Add guide"
            onClick={() => {
              const g: Guide = {
                id: crypto.randomUUID(),
                title: "New guide",
                goal: "",
                prerequisites: "",
                audience: "",
                completion: "",
                faq: "",
                included: true,
                steps: [],
              };
              update((d) => d.guides.push(g));
              setGid(g.id);
              setGuideSettings(true);
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        <select
          className="editor-guide-select"
          aria-label="Select guide"
          value={guide.id}
          onChange={(e) => {
            setGid(e.target.value);
            setSid(null);
            setGuideSettings(false);
          }}
        >
          {draft.guides.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title || "Untitled guide"}
            </option>
          ))}
        </select>
        <div className="outline-stepcount">
          <span>{guide.steps.length} steps</span>
          <ArrowDownUp size={15} />
        </div>
        {draft.guides.map((g, i) => (
          <div
            key={g.id}
            className={`outline-guide ${g.id === guide.id ? "active" : ""}`}
          >
            <button
              className="guide-select"
              onClick={() => {
                setGid(g.id);
                setSid(null);
                setGuideSettings(false);
              }}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <strong>{g.title || "Untitled guide"}</strong>
              <ChevronRight size={14} />
            </button>
            {g.id === guide.id && (
              <div className="outline-steps">
                {g.steps.map((s, j) => (
                  <button
                    draggable
                    key={s.id}
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", s.id)
                    }
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = e.dataTransfer.getData("text/plain");
                      update((d) => {
                        const list = d.guides.find(
                          (g) => g.id === guide.id,
                        )!.steps;
                        const index = list.findIndex((v) => v.id === from);
                        if (index < 0) return;
                        const [item] = list.splice(index, 1);
                        list.splice(j, 0, item);
                      });
                    }}
                    className={s.id === step?.id ? "selected" : ""}
                    onClick={() => {
                      setSid(s.id);
                      setGuideSettings(false);
                    }}
                  >
                    <span>{j + 1}</span>
                    <span className="step-outline-text">
                      <strong>{s.title || "Untitled step"}</strong>
                      <small>
                        {s.aiPending
                          ? "AI suggestion to review"
                          : s.assetId
                            ? "Screenshot + instruction"
                            : "Text-only instruction"}
                      </small>
                    </span>
                    {s.reviewed ? (
                      <Check size={13} />
                    ) : (
                      <span className="unreviewed-dot" />
                    )}
                  </button>
                ))}
                <button
                  className="add-step"
                  onClick={() => {
                    const s = newStep();
                    update((d) =>
                      d.guides.find((v) => v.id === guide.id)!.steps.push(s),
                    );
                    setSid(s.id);
                    setGuideSettings(false);
                  }}
                >
                  <Plus size={14} />
                  Add a step
                </button>
              </div>
            )}
          </div>
        ))}
        <button
          className="guide-settings-link"
          onClick={() => setGuideSettings(!guideSettings)}
        >
          <BookOpen size={16} />
          Guide details & prerequisites
        </button>
        <div className="outline-foot">
          Drag to reorder.
          <br />
          Arrow controls are available in each step.
        </div>
      </aside>
      <section className="editor-main">
        <div className="editor-breadcrumb">
          <span>{guide.title}</span>
          <ChevronRight size={13} />
          <span>
            {guideSettings
              ? "Guide details"
              : step
                ? `Step ${guide.steps.indexOf(step) + 1}`
                : "Getting started"}
          </span>
        </div>
        <ErrorNotice error={error} />
        {undo && (
          <div className="notice">
            Step deleted from this draft. Published versions keep their copy.
            <Button
              kind="text"
              onClick={() => {
                update((d) => {
                  const index = d.guides.findIndex((g) => g.id === undo.id);
                  d.guides[index] = undo;
                });
                setUndo(null);
              }}
            >
              Undo deletion
            </Button>
          </div>
        )}
        {guideSettings ? (
          <div className="guide-details">
            <p className="eyebrow">GUIDE DETAILS</p>
            <h2>Set your client up for success.</h2>
            {(
              [
                ["title", "Guide title", 160],
                ["goal", "What will the client achieve?", 1000],
                ["prerequisites", "Before you begin", 1000],
                ["audience", "Who is this guide for?", 160],
                ["completion", "How will they know they’re done?", 1000],
                ["faq", "Common questions", 2000],
              ] as const
            ).map(([key, label, max]) => (
              <Field key={key} label={label}>
                <textarea
                  rows={key === "prerequisites" ? 3 : 2}
                  maxLength={max}
                  value={guide[key]}
                  onChange={(e) => changeGuide(key, e.target.value)}
                />
              </Field>
            ))}
            <label className="check-field">
              <input
                type="checkbox"
                checked={guide.included}
                onChange={(e) => changeGuide("included", e.target.checked)}
              />
              Include this guide in the next release
            </label>
            <div className="step-tools">
              <Button
                kind="text"
                onClick={() =>
                  update((d) => {
                    const i = d.guides.findIndex((g) => g.id === guide.id);
                    if (i > 0)
                      [d.guides[i - 1], d.guides[i]] = [
                        d.guides[i],
                        d.guides[i - 1],
                      ];
                  })
                }
              >
                Move guide up
              </Button>
              <Button
                kind="text"
                onClick={() =>
                  update((d) => {
                    const i = d.guides.findIndex((g) => g.id === guide.id);
                    if (i < d.guides.length - 1)
                      [d.guides[i + 1], d.guides[i]] = [
                        d.guides[i],
                        d.guides[i + 1],
                      ];
                  })
                }
              >
                Move guide down
              </Button>
              <Button
                kind="text danger-text"
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this guide from the draft? Published versions will retain their copy.",
                    )
                  )
                    update((d) => {
                      d.guides = d.guides.filter((g) => g.id !== guide.id);
                    });
                }}
              >
                Delete guide
              </Button>
            </div>
          </div>
        ) : step ? (
          <>
            <div className="step-editor-heading">
              <span className="step-label">
                STEP {String(guide.steps.indexOf(step) + 1).padStart(2, "0")}
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label="Move step up"
                  disabled={guide.steps.indexOf(step) === 0}
                  onClick={() => move(-1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Move step down"
                  disabled={
                    guide.steps.indexOf(step) === guide.steps.length - 1
                  }
                  onClick={() => move(1)}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Duplicate step"
                  onClick={() => {
                    const copy = {
                      ...structuredClone(step),
                      id: crypto.randomUUID(),
                      reviewed: false,
                    };
                    update((d) => {
                      const list = d.guides.find(
                        (g) => g.id === guide.id,
                      )!.steps;
                      list.splice(
                        list.findIndex((s) => s.id === step.id) + 1,
                        0,
                        copy,
                      );
                    });
                    setSid(copy.id);
                  }}
                >
                  <Copy size={16} />
                </button>
                <button
                  className="icon-button danger-text"
                  title="Delete step"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Remove this step from the draft? Published versions and their questions keep the original step.",
                      )
                    ) {
                      setUndo(structuredClone(guide));
                      update((d) => {
                        const g = d.guides.find((g) => g.id === guide.id)!;
                        g.steps = g.steps.filter((s) => s.id !== step.id);
                      });
                      setSid(null);
                    }
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <input
              className="step-title-input"
              aria-label="Step title"
              maxLength={120}
              value={step.title}
              onChange={(e) => changeStep("title", e.target.value)}
              placeholder="Give this step a clear title"
            />

            {step.assetId ? (
              <div className="step-image">
                <div className="editor-image-toolbar">
                  <div>
                    {[
                      { tool: "rectangle", icon: Square, label: "Rectangle" },
                      { tool: "arrow", icon: ArrowUpRight, label: "Arrow" },
                      { tool: "label", icon: Type, label: "Text" },
                      { tool: "crop", icon: Crop, label: "Crop" },
                    ].map((t) => (
                      <Link
                        key={t.tool}
                        to={`/app/projects/${p.id}/assets?replace=${step.id}&tool=${t.tool}&annotate=1`}
                        className="icon-button"
                        title={t.label}
                      >
                        <t.icon size={16} />
                        <span className="visually-hidden">{t.label}</span>
                      </Link>
                    ))}
                  </div>
                  <div>
                    <Link
                      to={`/app/projects/${p.id}/assets?replace=${step.id}&tool=redact&annotate=1`}
                      className="button secondary"
                    >
                      <ShieldCheck size={14} />
                      Redact
                    </Link>
                    <Link
                      to={`/app/projects/${p.id}/assets?replace=${step.id}`}
                      className="button secondary"
                    >
                      <ImagePlus size={14} />
                      Replace
                    </Link>
                  </div>
                </div>
                <img
                  src={assetUrl(step.assetId)}
                  alt={step.alt || "Processed step screenshot"}
                />
                <div>
                  <Badge tone="green">
                    <ShieldIcon />
                    Processed image · Flattened
                  </Badge>
                  <Link
                    to={`/app/projects/${p.id}/assets?replace=${step.id}`}
                    className="button text"
                  >
                    Replace / annotate
                  </Link>
                  <Button
                    kind="text"
                    onClick={() => {
                      changeStep("assetId", null);
                      changeStep("textOnly", true);
                    }}
                  >
                    Remove image
                  </Button>
                </div>
              </div>
            ) : (
              <Link
                to={`/app/projects/${p.id}/assets?replace=${step.id}`}
                className="image-placeholder"
              >
                <ImagePlus size={27} />
                <strong>Add a screenshot</strong>
                <span>Review and redact locally before uploading.</span>
              </Link>
            )}
            <Field label="Instruction">
              <textarea
                className="step-body"
                ref={bodyInput}
                rows={5}
                maxLength={2000}
                value={step.body}
                onChange={(e) => changeStep("body", e.target.value)}
                placeholder="Tell your client exactly what to do. Use the labels they will see on screen."
              />
            </Field>
            {step.assetId && (
              <Field
                label="Image description"
                hint="Shown to screen readers and when the image is unavailable."
              >
                <input
                  maxLength={500}
                  value={step.alt}
                  onChange={(e) => changeStep("alt", e.target.value)}
                  placeholder="Describe what this screenshot shows."
                />
              </Field>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                checked={step.textOnly}
                onChange={(e) => changeStep("textOnly", e.target.checked)}
              />
              This step can be understood without a screenshot
            </label>
            <div className="step-tools">
              <Button
                kind="text"
                onClick={() => {
                  const caret = bodyInput.current?.selectionStart || 0;
                  const index =
                    caret > 0 && caret < step.body.length
                      ? caret
                      : step.body.lastIndexOf(
                          " ",
                          Math.floor(step.body.length / 2),
                        );
                  if (index <= 0 || index >= step.body.length) {
                    setError(
                      "Place the cursor between two instructions before splitting.",
                    );
                    return;
                  }
                  const next = {
                    ...newStep(),
                    title: `${step.title.slice(0, 108)} (continued)`,
                    body: step.body.slice(index).trimStart(),
                  };
                  update((d) => {
                    const list = d.guides.find((g) => g.id === guide.id)!.steps;
                    const s = list.find((s) => s.id === step.id)!;
                    s.body = step.body.slice(0, index).trimEnd();
                    s.reviewed = false;
                    list.splice(list.indexOf(s) + 1, 0, next);
                  });
                  setSid(next.id);
                }}
              >
                <Scissors size={15} />
                Split instructions
              </Button>
              <Button
                kind="text"
                disabled={guide.steps.indexOf(step) === guide.steps.length - 1}
                onClick={() => {
                  const next = guide.steps[guide.steps.indexOf(step) + 1];
                  if (!next) return;
                  if (next.assetId) {
                    setError(
                      "Remove or move the next screenshot before merging text.",
                    );
                    return;
                  }
                  if (
                    (step.body + "\n" + next.body).length > 2000 ||
                    (step.expected + "\n" + next.expected).length > 500 ||
                    (step.warning + "\n" + next.warning).length > 500
                  ) {
                    setError(
                      "These steps exceed a field limit when merged. Shorten the text first.",
                    );
                    return;
                  }
                  update((d) => {
                    const list = d.guides.find((g) => g.id === guide.id)!.steps;
                    const i = list.findIndex((s) => s.id === step.id);
                    const next = list[i + 1];
                    if (next) {
                      list[i].body = list[i].body + "\n" + next.body;
                      list[i].expected = [list[i].expected, next.expected]
                        .filter(Boolean)
                        .join("\n");
                      list[i].warning = [list[i].warning, next.warning]
                        .filter(Boolean)
                        .join("\n");
                      list[i].reviewed = false;
                      list.splice(i + 1, 1);
                    }
                  });
                }}
              >
                <Merge size={15} />
                Merge next text
              </Button>
            </div>
          </>
        ) : (
          <Empty
            title="Explain the first step."
            body="Start with a manual instruction or import a processed screenshot."
            action={
              <Button
                onClick={() => {
                  const s = newStep();
                  update((d) =>
                    d.guides.find((g) => g.id === guide.id)!.steps.push(s),
                  );
                  setSid(s.id);
                }}
              >
                Add your first step <Plus size={16} />
              </Button>
            }
          />
        )}
      </section>
      <aside className="editor-properties">
        {step && (
          <TermHints
            text={`${step.title}\n${step.body}\n${step.expected}\n${step.warning}`}
            draft={draft}
          />
        )}
        <p className="eyebrow">Step details</p>
        {step && !guideSettings ? (
          <>
            <Field label="Expected result">
              <textarea
                rows={4}
                maxLength={500}
                value={step.expected}
                onChange={(e) => changeStep("expected", e.target.value)}
                placeholder="What should the client see after this action?"
              />
            </Field>
            <Field label="Before you start" hint="Applies to this guide.">
              <textarea
                rows={3}
                maxLength={1000}
                value={guide.prerequisites}
                onChange={(e) => changeGuide("prerequisites", e.target.value)}
              />
            </Field>
            <Field label="Caution · optional">
              <textarea
                rows={3}
                maxLength={500}
                value={step.warning}
                onChange={(e) => changeStep("warning", e.target.value)}
                placeholder="A risk, exception, or useful tip."
              />
            </Field>

            <details className="internal-source">
              <summary>Internal source note</summary>
              <Field label="Internal source note">
                <textarea
                  rows={2}
                  maxLength={500}
                  value={step.source}
                  onChange={(e) => changeStep("source", e.target.value)}
                  placeholder="Never included in the client release."
                />
              </Field>
            </details>
            <label className="review-check">
              <input
                type="checkbox"
                checked={step.reviewed}
                onChange={(e) => {
                  changeStep("reviewed", e.target.checked);
                  if (e.target.checked) changeStep("aiPending", false);
                }}
              />
              <span>
                <strong>I’ve checked this step</strong>
                <small>Instructions and screenshot are accurate.</small>
              </span>
            </label>
            <div className="ai-section">
              <div>
                <Sparkles size={17} />
                <h3>Draft with AI</h3>
                <Badge>Optional</Badge>
              </div>
              <p>
                Suggestions use only the selected step and its processed
                screenshot. You review every change.
              </p>
              {!session.aiEnabled ? (
                <span className="muted">
                  Provider not configured. Manual editing is fully available.
                </span>
              ) : (
                <>
                  <p className="muted">{session.aiNotice}</p>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    I agree to send this processed screenshot to the configured
                    provider.
                  </label>
                  <Button
                    kind="secondary full"
                    disabled={busy || !consent || !step.assetId}
                    onClick={() => void generate()}
                  >
                    <Sparkles size={15} />
                    {busy ? "Generating suggestion…" : "Generate suggestion"}
                  </Button>
                </>
              )}
              <small>{p.entitlement.aiRemaining} steps remaining</small>
              {ai?.suggestions?.map((s: any) => (
                <div className="ai-suggestion" key={s.sourceStepId}>
                  <strong>{s.title}</strong>
                  <p>{s.body}</p>
                  <p>{s.expected}</p>
                  {s.missing.map((m: string) => (
                    <p key={m} className="warning-text">
                      Needs review: {m}
                    </p>
                  ))}
                  <Button
                    kind="secondary"
                    onClick={() => {
                      update((d) => {
                        const target = d.guides
                          .flatMap((g) => g.steps)
                          .find((v) => v.id === s.sourceStepId);
                        if (target) {
                          target.title = s.title;
                          target.body = s.body;
                          target.expected = s.expected;
                          target.aiPending = true;
                          target.reviewed = false;
                        }
                      });
                      setAi(null);
                    }}
                  >
                    Accept for review
                  </Button>
                  <Button kind="text" onClick={() => setAi(null)}>
                    Reject
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="inline-tip">
            <BookOpen size={20} />
            <p>
              A complete guide explains the goal, what’s needed before starting,
              and how to recognize success.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
function ShieldIcon() {
  return <Check size={12} />;
}

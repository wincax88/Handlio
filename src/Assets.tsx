import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Crop,
  ImagePlus,
  MousePointer2,
  ShieldCheck,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  Hash,
} from "lucide-react";
import type { ProjectEditorProps } from "./ProjectPage";
import { api, assetUrl, send } from "./api";
import { registerNavigationGuard } from "./api";
import {
  Badge,
  Button,
  Empty,
  ErrorNotice,
  Field,
  Link,
  PageHeading,
  Panel,
} from "./ui";
import { newStep } from "./Editor";
type Mark = {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
};
type LocalImage = {
  id: string;
  name: string;
  bitmap: ImageBitmap;
  size: number;
  marks: Mark[];
  reviewed: boolean;
  status: string;
  error?: string;
  assetId?: string;
  sourceAssetId?: string;
};
export function Assets({
  project: p,
  draft,
  update,
  flush,
  refresh,
}: ProjectEditorProps) {
  const [queue, setQueue] = useState<LocalImage[]>([]);
  const [selected, setSelected] = useState("");
  const [tool, setTool] = useState(() => {
    const requested =
      new URLSearchParams(location.search).get("tool") || "redact";
    return ["redact", "rectangle", "arrow", "number", "label", "crop"].includes(
      requested,
    )
      ? requested
      : "redact";
  });
  const [label, setLabel] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [gid, setGid] = useState(draft.guides[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Mark | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const image = queue.find((v) => v.id === selected) || queue[0];
  const replace = new URLSearchParams(location.search).get("replace");
  useEffect(() => {
    let cancelled = false;
    void api(`/projects/${p.id}/assets`)
      .then(setAssets)
      .catch((e) => setError(e.message));
    if (new URLSearchParams(location.search).has("annotate") && replace) {
      const step = draft.guides
        .flatMap((g) => g.steps)
        .find((s) => s.id === replace);
      if (step?.assetId)
        void (async () => {
          try {
            const recipe = await api(
              `/projects/${p.id}/assets/${step.assetId}/edit`,
            );
            const response = await fetch(assetUrl(recipe.baseId));
            if (!response.ok) throw new Error("Screenshot unavailable.");
            const blob = await response.blob();
            const bitmap = await createImageBitmap(blob);
            if (cancelled) {
              bitmap.close();
              return;
            }
            const next = {
              id: crypto.randomUUID(),
              name: "Processed screenshot.png",
              bitmap,
              size: blob.size,
              marks: recipe.shapes as Mark[],
              sourceAssetId: recipe.baseId as string,
              reviewed: false,
              status: "local",
            };
            setQueue([next]);
            setSelected(next.id);
          } catch (e) {
            if (!cancelled) setError((e as Error).message);
          }
        })();
    }
    const warn = (e: BeforeUnloadEvent) => {
      if (queueRef.current.some((q) => q.status !== "uploaded")) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    const unregister = registerNavigationGuard(
      () =>
        !queueRef.current.some((q) => q.status !== "uploaded") ||
        window.confirm(
          "Leave screenshot preparation? Images that are not uploaded will be lost. Stay here to finish reviewing and uploading them.",
        ),
    );
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", warn);
      unregister();
      queueRef.current.forEach((q) => q.bitmap.close());
    };
  }, [p.id, replace]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !image) return;
    c.width = image.bitmap.width;
    c.height = image.bitmap.height;
    draw(c, image, pending);
  }, [image, pending]);
  function edit(fn: (item: LocalImage) => void) {
    setQueue((prev) =>
      prev.map((q) => {
        if (q.id !== image?.id) return q;
        const next = { ...q, marks: [...q.marks] };
        fn(next);
        return next;
      }),
    );
  }
  async function choose(files: File[]) {
    setError(null);
    if (queue.length + files.length > 20) {
      setError("Select at most 20 screenshots in one batch.");
      return;
    }
    const additions: LocalImage[] = [];
    for (const f of files) {
      try {
        if (!["image/png", "image/jpeg", "image/webp"].includes(f.type))
          throw new Error(`${f.name}: use a static PNG, JPEG or WebP.`);
        if (f.size > 20 * 1048576)
          throw new Error(`${f.name}: maximum file size is 20 MiB.`);
        const bytes = new Uint8Array(await f.arrayBuffer());
        const png =
          bytes[0] === 137 &&
          bytes[1] === 80 &&
          bytes[2] === 78 &&
          bytes[3] === 71;
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        const ascii = (a: number, b: number) =>
          String.fromCharCode(...bytes.slice(a, b));
        const webp = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
        if (!png && !jpeg && !webp)
          throw new Error(
            `${f.name}: this file is not a valid PNG, JPEG or WebP.`,
          );
        if (png) {
          const view = new DataView(bytes.buffer);
          for (let offset = 8; offset + 12 <= bytes.length;) {
            if (ascii(offset + 4, offset + 8) === "acTL")
              throw new Error(`${f.name}: animated images are not supported.`);
            offset += view.getUint32(offset) + 12;
          }
        }
        if (webp && ascii(12, 16) === "VP8X" && bytes[20] & 2)
          throw new Error(`${f.name}: animated images are not supported.`);
        const b = await createImageBitmap(f);
        if (
          b.width > 8000 ||
          b.height > 8000 ||
          b.width * b.height > 20000000
        ) {
          b.close();
          throw new Error(
            `${f.name}: maximum dimensions are 8,000 per side and 20 million pixels.`,
          );
        }
        additions.push({
          id: crypto.randomUUID(),
          name: f.name,
          bitmap: b,
          size: f.size,
          marks: [],
          reviewed: false,
          status: "local",
        });
      } catch (e) {
        setError((prev) =>
          [prev, (e as Error).message].filter(Boolean).join(" "),
        );
      }
    }
    setQueue((prev) => [...prev, ...additions]);
    if (!selected && additions.length) setSelected(additions[0].id);
  }
  function position(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          image!.bitmap.width,
          ((e.clientX - rect.left) / rect.width) * image!.bitmap.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          image!.bitmap.height,
          ((e.clientY - rect.top) / rect.height) * image!.bitmap.height,
        ),
      ),
    };
  }
  function down(e: PointerEvent<HTMLCanvasElement>) {
    if (!image || image.status === "uploaded" || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = position(e);
    setPending({ type: tool, ...start.current, w: 0, h: 0, label });
  }
  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!start.current) return;
    const end = position(e);
    setPending({
      type: tool,
      ...start.current,
      w: end.x - start.current.x,
      h: end.y - start.current.y,
      label,
    });
  }
  async function up(e: PointerEvent<HTMLCanvasElement>) {
    if (!start.current || !image) return;
    const end = position(e);
    const mark: Mark = {
      type: tool,
      ...start.current,
      w: end.x - start.current.x,
      h: end.y - start.current.y,
      label,
    };
    start.current = null;
    setPending(null);
    if (tool === "crop") {
      const x = Math.min(mark.x, mark.x + mark.w),
        y = Math.min(mark.y, mark.y + mark.h),
        w = Math.abs(mark.w),
        h = Math.abs(mark.h);
      if (w < 4 || h < 4) return;
      const base = document.createElement("canvas");
      base.width = image.bitmap.width;
      base.height = image.bitmap.height;
      draw(base, {
        ...image,
        marks: image.marks.filter((m) => m.type === "redact"),
      });
      const result = document.createElement("canvas");
      result.width = w;
      result.height = h;
      result.getContext("2d")!.drawImage(base, x, y, w, h, 0, 0, w, h);
      const blob = await new Promise<Blob>((r) =>
        result.toBlob((b) => r(b!), "image/png"),
      );
      const bitmap = await createImageBitmap(blob);
      edit((q) => {
        q.bitmap.close();
        q.bitmap = bitmap;
        q.marks = q.marks
          .filter((m) => m.type !== "redact")
          .map((m) => ({ ...m, x: m.x - x, y: m.y - y }))
          .filter(
            (m) =>
              m.x + Math.abs(m.w) >= 0 &&
              m.y + Math.abs(m.h) >= 0 &&
              m.x <= w &&
              m.y <= h,
          );
        q.sourceAssetId = undefined;
        q.reviewed = false;
      });
    } else if (
      ["number", "label"].includes(tool) ||
      (Math.abs(mark.w) > 3 && Math.abs(mark.h) > 3)
    )
      edit((q) => {
        if (q.marks.length >= 100) return;
        q.marks.push(mark);
        if (mark.type === "redact") q.sourceAssetId = undefined;
        q.reviewed = false;
      });
  }
  async function upload() {
    setBusy(true);
    setError(null);
    try {
      await flush();
      for (const item of queue.filter(
        (q) => q.reviewed && q.status !== "uploaded",
      )) {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: "uploading", error: undefined }
              : q,
          ),
        );
        try {
          const flat = document.createElement("canvas");
          flat.width = item.bitmap.width;
          flat.height = item.bitmap.height;
          draw(flat, {
            ...item,
            marks: item.marks.filter((m) => m.type === "redact"),
          });
          const blob = await new Promise<Blob>((resolve, reject) =>
            flat.toBlob(
              (b) =>
                b ? resolve(b) : reject(new Error("Image processing failed.")),
              "image/png",
            ),
          );
          if (blob.size > 20 * 1048576)
            throw new Error(
              "Processed image exceeds 20 MiB. Crop or resize the source and retry.",
            );
          const base = item.sourceAssetId
            ? { id: item.sourceAssetId }
            : await api(`/projects/${p.id}/assets`, {
                method: "POST",
                body: blob,
                headers: {
                  "Content-Type": "image/png",
                  "X-Sanitized": "true",
                  "Idempotency-Key": item.id,
                },
              });
          const shapes = item.marks.filter(
            (m) => m.type !== "redact" && m.type !== "crop",
          );
          const uploaded = shapes.length
            ? await send(
                `/projects/${p.id}/assets/${base.id}/annotations`,
                { shapes },
                "POST",
                `${item.id}:layers`,
              )
            : base;
          update((d) => {
            if (replace) {
              const step = d.guides
                .flatMap((g) => g.steps)
                .find((s) => s.id === replace);
              if (step) {
                step.assetId = uploaded.id;
                step.textOnly = false;
                step.reviewed = false;
                step.alt = "";
              }
            } else {
              const g = d.guides.find((g) => g.id === gid);
              if (g) {
                const step = newStep();
                step.title = item.name.replace(/\.[^.]+$/, "");
                step.assetId = uploaded.id;
                step.textOnly = false;
                g.steps.push(step);
              }
            }
          });
          const flattened = await createImageBitmap(blob);
          item.bitmap.close();
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? {
                    ...q,
                    bitmap: flattened,
                    marks: shapes,
                    size: blob.size,
                    status: "uploaded",
                    assetId: uploaded.id,
                  }
                : q,
            ),
          );
        } catch (e) {
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? { ...q, status: "failed", error: (e as Error).message }
                : q,
            ),
          );
        }
      }
      await flush();
      setAssets(await api(`/projects/${p.id}/assets`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="PREPARE BEFORE YOU SHARE"
        title="Screenshots, safely handled."
        description="Your original files stay in browser memory. Only flattened, reviewed images are uploaded."
        actions={
          <label className="button">
            <PlusIcon />
            Choose screenshots
            <input
              className="visually-hidden"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                void choose(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </label>
        }
      />
      <ErrorNotice error={error} />
      <div
        className="upload-drop"
        tabIndex={0}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void choose(Array.from(e.dataTransfer.files));
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            void choose(files);
          }
        }}
      >
        <Upload size={24} />
        <strong>Drop screenshots here, or paste an image</strong>
        <span>
          PNG, JPEG, WebP · up to 20 files · 20 MiB each · static images only
        </span>
      </div>
      {queue.length > 0 && (
        <div className="asset-workspace">
          <aside className="asset-queue">
            <p className="eyebrow">LOCAL REVIEW QUEUE · {queue.length}</p>
            {queue.map((q, i) => (
              <div
                key={q.id}
                className={`queue-item ${q.id === image?.id ? "selected" : ""}`}
              >
                <button onClick={() => setSelected(q.id)}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{q.name}</strong>
                    <small>
                      {q.bitmap.width} × {q.bitmap.height} ·{" "}
                      {(q.size / 1048576).toFixed(1)} MiB
                    </small>
                    <small>
                      {q.status === "uploaded"
                        ? "Uploaded safely"
                        : q.status === "failed"
                          ? q.error
                          : q.reviewed
                            ? "Reviewed, ready to upload"
                            : "Review before uploading"}
                    </small>
                  </div>
                  {q.status === "uploaded" ? (
                    <CheckCircle2 size={16} />
                  ) : q.reviewed ? (
                    <ShieldCheck size={16} />
                  ) : null}
                </button>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Move image up"
                    disabled={i === 0 || busy}
                    onClick={() =>
                      setQueue((prev) => {
                        const list = [...prev];
                        [list[i - 1], list[i]] = [list[i], list[i - 1]];
                        return list;
                      })
                    }
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Move image down"
                    disabled={i === queue.length - 1 || busy}
                    onClick={() =>
                      setQueue((prev) => {
                        const list = [...prev];
                        [list[i + 1], list[i]] = [list[i], list[i + 1]];
                        return list;
                      })
                    }
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Remove local image"
                    disabled={busy}
                    onClick={() => {
                      q.bitmap.close();
                      setQueue((prev) => prev.filter((v) => v.id !== q.id));
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </aside>
          <section className="asset-canvas-panel">
            <div className="image-tools">
              {[
                { id: "redact", icon: ShieldCheck, label: "Redact" },
                { id: "rectangle", icon: Square, label: "Rectangle" },
                { id: "arrow", icon: ArrowUpRight, label: "Arrow" },
                { id: "number", icon: Hash, label: "Number" },
                { id: "label", icon: Type, label: "Label" },
                { id: "crop", icon: Crop, label: "Crop" },
              ].map((t) => (
                <button
                  disabled={image?.status === "uploaded"}
                  key={t.id}
                  className={tool === t.id ? "active" : ""}
                  onClick={() => setTool(t.id)}
                >
                  <t.icon size={16} />
                  {t.label}
                </button>
              ))}
              <button
                disabled={!image?.marks.length || image?.status === "uploaded"}
                onClick={() =>
                  edit((q) => {
                    q.marks.pop();
                    q.reviewed = false;
                  })
                }
              >
                <Undo2 size={16} />
                Undo
              </button>
            </div>
            {["number", "label"].includes(tool) && (
              <Field label="Annotation text">
                <input
                  value={label}
                  maxLength={80}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
            )}
            <p className="tool-help">
              {tool === "redact"
                ? "Drag a solid box over sensitive information. It will be baked into the uploaded pixels."
                : tool === "crop"
                  ? "Drag the area to keep. Cropping flattens current annotations."
                  : "Drag to annotate. For a number or text label, click its position."}
            </p>
            <div className="canvas-surface">
              <canvas
                ref={canvas}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
              />
            </div>
            {image && image.marks.some((m) => m.type !== "redact") && (
              <details className="annotation-layers" open>
                <summary>Editable annotation layers</summary>
                {image.marks.map((mark, index) =>
                  mark.type === "redact" ? null : (
                    <div className="annotation-layer" key={index}>
                      <strong>
                        {mark.type} {index + 1}
                      </strong>
                      <div className="layer-geometry">
                        {(
                          [
                            ["x", "X"],
                            ["y", "Y"],
                            ["w", "Width"],
                            ["h", "Height"],
                          ] as const
                        ).map(([key, label]) => (
                          <Field
                            key={key}
                            label={`Layer ${index + 1} ${label}`}
                          >
                            <input
                              type="number"
                              min={-8000}
                              max={8000}
                              value={mark[key]}
                              disabled={busy || image.status === "uploaded"}
                              onChange={(e) => {
                                const value = Number(e.target.value);
                                if (Number.isFinite(value))
                                  edit((q) => {
                                    q.marks[index] = {
                                      ...mark,
                                      [key]: Math.max(
                                        -8000,
                                        Math.min(8000, value),
                                      ),
                                    };
                                    q.reviewed = false;
                                  });
                              }}
                            />
                          </Field>
                        ))}
                      </div>
                      {["label", "number"].includes(mark.type) && (
                        <Field label={`Layer ${index + 1} text`}>
                          <input
                            maxLength={80}
                            value={mark.label}
                            disabled={busy || image.status === "uploaded"}
                            onChange={(e) =>
                              edit((q) => {
                                q.marks[index] = {
                                  ...mark,
                                  label: e.target.value,
                                };
                                q.reviewed = false;
                              })
                            }
                          />
                        </Field>
                      )}
                      <Button
                        kind="text"
                        disabled={busy || image.status === "uploaded"}
                        onClick={() =>
                          edit((q) => {
                            q.marks[index] = {
                              ...mark,
                              x: Math.max(-8000, mark.x - 5),
                            };
                            q.reviewed = false;
                          })
                        }
                      >
                        Move layer left
                      </Button>
                      <Button
                        kind="text"
                        disabled={busy || image.status === "uploaded"}
                        onClick={() =>
                          edit((q) => {
                            q.marks[index] = {
                              ...mark,
                              x: Math.min(image.bitmap.width, mark.x + 5),
                            };
                            q.reviewed = false;
                          })
                        }
                      >
                        Move layer right
                      </Button>
                      <Button
                        kind="text danger-text"
                        disabled={busy || image.status === "uploaded"}
                        onClick={() =>
                          edit((q) => {
                            q.marks.splice(index, 1);
                            q.reviewed = false;
                          })
                        }
                      >
                        Remove layer
                      </Button>
                    </div>
                  ),
                )}
                <p className="muted">
                  Redactions are part of the safe base image and cannot be
                  restored after upload.
                </p>
              </details>
            )}
            <label className="review-check">
              <input
                type="checkbox"
                disabled={image?.status === "uploaded"}
                checked={image?.reviewed || false}
                onChange={(e) =>
                  edit((q) => {
                    q.reviewed = e.target.checked;
                  })
                }
              />
              <span>
                <strong>
                  I checked this screenshot for sensitive information
                </strong>
                <small>
                  Check passwords, keys, personal data, balances, and client
                  secrets. Uploaded redactions cannot be undone.
                </small>
              </span>
            </label>
          </section>
        </div>
      )}
      <div className="asset-upload-footer">
        {replace ? (
          <span>
            Replace the selected step image. Its text is preserved; review it
            again.
          </span>
        ) : (
          <Field label="Add screenshots as steps in">
            <select value={gid} onChange={(e) => setGid(e.target.value)}>
              <option value="">Library only (for example, a logo)</option>
              {draft.guides.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Button
          disabled={
            busy || !queue.some((q) => q.reviewed && q.status !== "uploaded")
          }
          onClick={() => void upload()}
        >
          <Upload size={16} />
          {busy ? "Processing reviewed images…" : "Confirm processing & upload"}
        </Button>
      </div>
      <Panel title="Processed image library">
        <p className="muted">
          Only these processed assets can be used in drafts and releases.
        </p>
        {!assets.length ? (
          <Empty
            title="Your safe image library is empty"
            body="Choose screenshots above, redact locally, then confirm the upload."
          />
        ) : (
          <div className="asset-library">
            {assets.map((a) => (
              <div key={a.id}>
                {a.status === "ready" ? (
                  <img
                    src={assetUrl(a.id)}
                    alt="Processed screenshot"
                    loading="lazy"
                  />
                ) : (
                  <div className="revoked-image">Safety withdrawn</div>
                )}
                <small>
                  {a.width} × {a.height} · {(a.bytes / 1024).toFixed(0)} KiB
                </small>
                <Badge tone={a.status === "ready" ? "green" : "red"}>
                  {a.status}
                </Badge>
                {a.status === "ready" && (
                  <div className="action-row">
                    <Button
                      kind="text"
                      onClick={() =>
                        update((d) => {
                          if (replace) {
                            const s = d.guides
                              .flatMap((g) => g.steps)
                              .find((s) => s.id === replace);
                            if (s) {
                              s.assetId = a.id;
                              s.reviewed = false;
                              s.textOnly = false;
                              s.alt = "";
                            }
                          } else {
                            const g = d.guides.find((g) => g.id === gid);
                            if (g)
                              g.steps.push({
                                ...newStep(),
                                assetId: a.id,
                                textOnly: false,
                              });
                          }
                        })
                      }
                    >
                      Use screenshot
                    </Button>
                    <Button
                      kind="text"
                      onClick={async () => {
                        try {
                          if (queue.length >= 20)
                            throw new Error(
                              "Select at most 20 screenshots in one batch.",
                            );
                          const recipe = await api(
                            `/projects/${p.id}/assets/${a.id}/edit`,
                          );
                          const response = await fetch(assetUrl(recipe.baseId));
                          if (!response.ok)
                            throw new Error("Screenshot unavailable.");
                          const blob = await response.blob();
                          const bitmap = await createImageBitmap(blob);
                          const next: LocalImage = {
                            id: crypto.randomUUID(),
                            name: "Processed screenshot.png",
                            bitmap,
                            size: blob.size,
                            marks: recipe.shapes,
                            sourceAssetId: recipe.baseId,
                            reviewed: false,
                            status: "local",
                          };
                          setQueue((prev) => [...prev, next]);
                          setSelected(next.id);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Annotate safe image
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Link to={`/app/projects/${p.id}/guides`} className="button secondary">
        Continue to your guides <ArrowUpRight size={16} />
      </Link>
    </>
  );
}
function PlusIcon() {
  return <ImagePlus size={17} />;
}
function draw(
  canvas: HTMLCanvasElement,
  item: LocalImage,
  pending?: Mark | null,
) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(item.bitmap, 0, 0);
  for (const m of [...item.marks, ...(pending ? [pending] : [])]) {
    const scale = Math.max(1, canvas.width / 800);
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = "#d35536";
    ctx.fillStyle = "#d35536";
    if (m.type === "redact") {
      ctx.fillStyle = "#17212b";
      ctx.fillRect(
        Math.min(m.x, m.x + m.w),
        Math.min(m.y, m.y + m.h),
        Math.abs(m.w),
        Math.abs(m.h),
      );
    } else if (m.type === "rectangle" || m.type === "crop") {
      ctx.strokeStyle = m.type === "crop" ? "#244d42" : "#d35536";
      ctx.strokeRect(m.x, m.y, m.w, m.h);
    } else if (m.type === "arrow") {
      const angle = Math.atan2(m.h, m.w);
      const length = 14 * scale;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x + m.w, m.y + m.h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(m.x + m.w, m.y + m.h);
      ctx.lineTo(
        m.x + m.w - length * Math.cos(angle - Math.PI / 6),
        m.y + m.h - length * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(
        m.x + m.w - length * Math.cos(angle + Math.PI / 6),
        m.y + m.h - length * Math.sin(angle + Math.PI / 6),
      );
      ctx.closePath();
      ctx.fill();
    } else if (m.type === "number") {
      ctx.beginPath();
      ctx.arc(m.x, m.y, 16 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${16 * scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(m.label, m.x, m.y);
    } else if (m.type === "label") {
      ctx.font = `bold ${20 * scale}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const width = ctx.measureText(m.label).width;
      ctx.fillStyle = "#f8f5eb";
      ctx.fillRect(
        m.x - 4 * scale,
        m.y - 4 * scale,
        width + 8 * scale,
        30 * scale,
      );
      ctx.fillStyle = "#17212b";
      ctx.fillText(m.label, m.x, m.y);
    }
  }
}

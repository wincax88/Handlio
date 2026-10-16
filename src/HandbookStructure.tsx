import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import {
  defaultSectionTitles,
  handbookSections,
  sectionOrder,
  type FixedSection,
} from "../shared/handbook";
import type { Draft } from "../shared/model";
import { Link } from "./ui";

function SectionTitle({
  id,
  title,
  rename,
}: {
  id: FixedSection;
  title: string;
  rename: (value: string) => void;
}) {
  const [value, setValue] = useState(title);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setValue(title), [title]);
  return (
    <>
      <input
        aria-label={`Rename ${defaultSectionTitles[id]}`}
        aria-invalid={invalid}
        maxLength={120}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={() => {
          if (!value.trim()) {
            setInvalid(true);
            return;
          }
          rename(value.trim());
        }}
      />
      <small>
        {invalid
          ? "Enter a section title."
          : "Required section · rename or move"}
      </small>
    </>
  );
}
export function HandbookStructure({
  draft,
  update,
  projectId,
}: {
  draft: Draft;
  update: (fn: (d: Draft) => void) => void;
  projectId: string;
}) {
  const sections = handbookSections(draft);
  function move(id: string, to: number) {
    update((d) => {
      const order = sectionOrder(d),
        from = order.indexOf(id);
      if (from < 0 || to < 0 || to >= order.length) return;
      order.splice(from, 1);
      order.splice(to, 0, id);
      d.sectionOrder = order;
      d.guides.sort(
        (a, b) =>
          order.indexOf(`guide:${a.id}`) - order.indexOf(`guide:${b.id}`),
      );
    });
  }
  return (
    <>
      {sections.map((section, i) => (
        <div
          className="structure-guide-row"
          key={section.id}
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/plain", section.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            move(e.dataTransfer.getData("text/plain"), i);
          }}
        >
          <span className="drag-handle" aria-hidden="true">
            ⋮⋮
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {section.kind === "fixed" ? (
              <SectionTitle
                id={section.id}
                title={section.title}
                rename={(title) =>
                  update((d) => {
                    d.sectionTitles = {
                      ...defaultSectionTitles,
                      ...d.sectionTitles,
                      [section.id]: title,
                    };
                  })
                }
              />
            ) : (
              <>
                <strong>{section.title}</strong>
                <small>
                  {section.guide.steps.length} steps ·{" "}
                  {section.guide.goal || "Add a goal in your guide"}
                </small>
              </>
            )}
          </div>
          <button
            className="icon-button"
            aria-label={`Move ${section.title} up`}
            disabled={i === 0}
            onClick={() => move(section.id, i - 1)}
          >
            <ArrowUp size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={`Move ${section.title} down`}
            disabled={i === sections.length - 1}
            onClick={() => move(section.id, i + 1)}
          >
            <ArrowDown size={15} />
          </button>
          {section.kind === "guide" ? (
            <>
              <Link
                to={`/app/projects/${projectId}/guides/${section.guide.id}`}
                className="button secondary"
              >
                Edit
              </Link>
              <input
                type="checkbox"
                aria-label={`Include ${section.title} in release`}
                checked={section.guide.included}
                onChange={(e) =>
                  update((d) => {
                    d.guides.find((g) => g.id === section.guide.id)!.included =
                      e.target.checked;
                  })
                }
              />
            </>
          ) : (
            <a
              href={
                section.id === "overview"
                  ? "#handbook-cover"
                  : section.id === "checklist"
                    ? "#handbook-checklist"
                    : "#handbook-support"
              }
              className="button secondary"
            >
              Edit
            </a>
          )}
        </div>
      ))}
    </>
  );
}

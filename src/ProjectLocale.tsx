import { useEffect, useState } from "react";
import type { Draft } from "../shared/model";
import { canonicalLanguage, isValidTimezone } from "../shared/handbook";
import { Button, ErrorNotice, Field, Panel } from "./ui";

export function ProjectLocaleFields({
  language,
  timezone,
  onLanguage,
  onTimezone,
}: {
  language: string;
  timezone: string;
  onLanguage: (value: string) => void;
  onTimezone: (value: string) => void;
}) {
  return (
    <div className="form-grid">
      <Field
        label="Project content language"
        hint="Language tag, such as en or zh-CN. Content is not translated."
      >
        <input
          value={language}
          maxLength={80}
          list="project-languages"
          onChange={(e) => onLanguage(e.target.value)}
        />
        <datalist id="project-languages">
          {[
            "en",
            "en-US",
            "en-GB",
            "zh-CN",
            "zh-TW",
            "ja",
            "de",
            "fr",
            "es",
            "pt-BR",
          ].map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      </Field>
      <Field
        label="Project time zone"
        hint="Used for dates in this project and its published handbooks."
      >
        <input
          value={timezone}
          maxLength={100}
          list="project-timezones"
          onChange={(e) => onTimezone(e.target.value)}
        />
        <datalist id="project-timezones">
          {[...new Set(["UTC", ...Intl.supportedValuesOf("timeZone")])].map(
            (zone) => (
              <option key={zone} value={zone} />
            ),
          )}
        </datalist>
      </Field>
    </div>
  );
}
export function ProjectLocaleSettings({
  draft,
  update,
}: {
  draft: Draft;
  update: (fn: (d: Draft) => void) => void;
}) {
  const [language, setLanguage] = useState(draft.language || "en");
  const [timezone, setTimezone] = useState(draft.timezone || "UTC");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLanguage(draft.language || "en");
    setTimezone(draft.timezone || "UTC");
  }, [draft.language, draft.timezone]);
  return (
    <Panel title="Project language & time zone">
      <ProjectLocaleFields
        language={language}
        timezone={timezone}
        onLanguage={setLanguage}
        onTimezone={setTimezone}
      />
      <ErrorNotice error={error} />
      <Button
        kind="secondary"
        disabled={language === draft.language && timezone === draft.timezone}
        onClick={() => {
          const lang = canonicalLanguage(language),
            tz = timezone.trim();
          if (!lang || !isValidTimezone(tz)) {
            setError(
              "Enter a valid language tag and time zone before applying.",
            );
            return;
          }
          update((d) => {
            d.language = lang;
            d.timezone = tz;
          });
          setError(null);
        }}
      >
        Apply language & time zone
      </Button>
      <p className="muted">
        Publish a new version to update the client's handbook. Previous versions
        keep their original settings.
      </p>
    </Panel>
  );
}

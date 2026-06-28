import React from "react";
import {
  artistPersonaFields,
  emptyPersonaDraftFields,
  personaLayerMap,
  producerContextField,
  soulPersonaFields,
  validatePersonaDraft,
  type ArtistPersonaDraft,
  type PersonaDraft,
  type PersonaDraftLayer,
  type PersonaEditorSource,
  type SoulPersonaDraft
} from "../personaEditor";
import { t, type ProducerRoomLocale } from "../i18n";
import type { PersonaField } from "../../../src/types";

type DirtyMap = Record<PersonaDraftLayer, boolean>;
type LayerTouchedMap = Record<PersonaDraftLayer, boolean>;
type PersonaAiSuggestionMode = "review_all" | "dedupe";
export type PersonaAiSuggestion = {
  draft: string;
  reasoning?: string;
  mode: PersonaAiSuggestionMode;
};

const emptyTouchedMap: LayerTouchedMap = {
  artist: false,
  soul: false,
  identity: false,
  producer: false,
  inner: false
};

const editableSetupLayers: PersonaDraftLayer[] = ["artist", "soul", "producer"];

const layerInfo = (layer: PersonaDraftLayer) =>
  personaLayerMap.find((entry) => entry.layer === layer);

const fileEnglishText: Record<string, { role: string; kind: string; requirement: string; summary: string; purpose: string; write: string; avoid: string }> = {
  "ARTIST.md": {
    role: "Music core",
    kind: "Input",
    requirement: "Required",
    summary: "The creative core: what the artist notices, what the music sounds like, and what the lyrics do.",
    purpose: "Sets song topics, sound direction, lyric habits, and public voice. This strongly affects Suno prompts and daily song ideas.",
    write: "Themes, sound texture, lyric constraints, public post voice, and musical traits for Suno.",
    avoid: "Artist display name, producer information, conversation tone, and internal memory."
  },
  "SOUL.md": {
    role: "Conversation voice",
    kind: "Input",
    requirement: "Required",
    summary: "How the artist talks with the producer during reports, advice, and refusals.",
    purpose: "Sets reply distance, speed, roughness, and how weak ideas are stopped. It does not set genre or sound.",
    write: "Conversation distance, phrasing, and the attitude used when rejecting weak or risky ideas.",
    avoid: "Music genre, Suno settings, producer callname, and artist profile facts."
  },
  "PRODUCER.md": {
    role: "Producer context",
    kind: "Input",
    requirement: "Optional",
    summary: "Producer-side preferences, constraints, and boundaries that affect creative decisions.",
    purpose: "Sets producer preferences, directions to avoid, and public-release boundaries. Optional; blank does not block setup.",
    write: "Directions to avoid, preferred density, public-release boundaries, and decision context.",
    avoid: "Address, contact info, real-name detail, secrets, artist voice, and music identity."
  },
  "IDENTITY.md": {
    role: "Identity card",
    kind: "Generated",
    requirement: "Read-only",
    summary: "A generated profile from the display name and setup fields. It is not canonical input.",
    purpose: "Shows the configured name and setup summary as a readable profile. New rules written here do not become canonical.",
    write: "Users do not write here. Runtime generates it from Settings, ARTIST.md, and SOUL.md.",
    avoid: "New settings, creative rules, or personal information."
  },
  "INNER.md": {
    role: "Internal memory",
    kind: "Internal",
    requirement: "Read-only",
    summary: "Runtime-managed inner memory. It is not a Setup input.",
    purpose: "Carries creative history and internal pressure across runs. Users do not fill it during initial setup, and it is not a public profile.",
    write: "Normally users do not write here. Existing content is kept as seed/history.",
    avoid: "Setup input, public profile, and producer information."
  }
};

function fileText(locale: ProducerRoomLocale, file: (typeof personaLayerMap)[number]) {
  return locale === "en" ? fileEnglishText[file.file] ?? file : file;
}

const fieldEnglishText: Partial<Record<PersonaField, { label: string; help: string }>> = {
  identityLine: { label: "Artist concept", help: "Not the name. Write what this artist is obsessed with and what they sing about." },
  soundDna: { label: "Sound core", help: "Sound DNA for Suno Style and arrangement: texture, instruments, BPM, and mix traits." },
  obsessions: { label: "Recurring themes", help: "Subjects the artist repeatedly notices. Affects observation, song ideas, and lyric choices." },
  lyricsRules: { label: "Lyric stance", help: "Lyric constraints: language, avoided words, structure, metaphor habits." },
  socialVoice: { label: "Public/SNS voice", help: "Voice for public posts and short studio notes. Separate from conversation tone." },
  "soul-tone": { label: "Conversation tone", help: "Distance, speed, and roughness when talking with the producer on Telegram and similar channels." },
  "soul-refusal": { label: "Refusal style", help: "How the artist stops weak or risky ideas and what it offers instead." },
  producerFacts: { label: "Producer decision notes", help: "Only preferences, boundaries, and decision context. Do not put callnames or artist voice here." }
};

function fieldText(locale: ProducerRoomLocale, label: string, help: string, field?: PersonaField) {
  if (locale !== "en" || !field) {
    return { label, help };
  }
  return fieldEnglishText[field] ?? { label, help };
}

function overlapIssueKey(detail: string):
  | "setupOverlapArtistName"
  | "setupOverlapProducerCallname"
  | "setupOverlapProducerFacts"
  | "setupOverlapConversation"
  | "setupOverlapMusic"
  | "setupOverlapPrivate"
  | "setupOverlapGeneric" {
  const normalized = detail.toLowerCase();
  if (normalized.includes("artist name") || normalized.includes("display name")) return "setupOverlapArtistName";
  if (normalized.includes("producer callname")) return "setupOverlapProducerCallname";
  if (normalized.includes("producer relationship") || normalized.includes("producer identity") || normalized.includes("producer facts")) return "setupOverlapProducerFacts";
  if (normalized.includes("conversation tone") || normalized.includes("refusal style") || normalized.includes("telegram persona voice") || normalized.includes("voice fingerprint")) return "setupOverlapConversation";
  if (normalized.includes("suno production profile") || normalized.includes("genre dna") || normalized.includes("sonic anchors") || normalized.includes("social voice")) return "setupOverlapMusic";
  if (normalized.includes("private weather") || normalized.includes("what i fear")) return "setupOverlapPrivate";
  return "setupOverlapGeneric";
}

function personaIssueLabel(locale: ProducerRoomLocale, issue: { code: string; file: string; detail: string }): string {
  switch (issue.code) {
    case "language_policy_outside_artist":
      return t(locale, "setupLanguageOutsideArtist", { file: issue.file });
    case "duplicated_language_policy":
      return t(locale, "setupDuplicatedLanguage");
    case "conflicting_language_policy":
      return t(locale, "setupConflictingLanguage", { detail: issue.detail });
    case "duplicate_suno_profile":
      return t(locale, "setupDuplicateSuno");
    case "obsolete_lyrics_length_rule":
      return t(locale, "setupObsoleteLyrics");
    case "persona_responsibility_overlap":
      return t(locale, overlapIssueKey(issue.detail), { file: issue.file });
    default:
      return `${issue.file}: ${issue.detail}`;
  }
}

function personaFieldLabel(locale: ProducerRoomLocale, field: string): string {
  const match = [...artistPersonaFields, ...soulPersonaFields].find((entry) => entry.aiField === field || entry.field === field);
  if (match) {
    return fieldText(locale, match.label, match.help, match.aiField).label;
  }
  if (field === producerContextField.aiField) {
    return fieldText(locale, producerContextField.label, producerContextField.help, producerContextField.aiField).label;
  }
  return field;
}

function personaFieldFile(field: string): string {
  if (artistPersonaFields.some((entry) => entry.aiField === field || entry.field === field)) {
    return "ARTIST.md";
  }
  if (soulPersonaFields.some((entry) => entry.aiField === field || entry.field === field)) {
    return "SOUL.md";
  }
  if (field === producerContextField.aiField) {
    return "PRODUCER.md";
  }
  return "persona";
}

function personaFieldStatusLabel(locale: ProducerRoomLocale, status: "filled" | "thin" | "missing"): string {
  if (status === "missing") return t(locale, "setupFieldMissing");
  if (status === "thin") return t(locale, "setupFieldWeak");
  return t(locale, "setupFieldFilled");
}

function PersonaTextInput(props: {
  locale: ProducerRoomLocale;
  label: string;
  help: string;
  targetFile: string;
  value: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  onTouched: () => void;
  aiField?: PersonaField;
  busyKey: string | null;
  onPropose?: (field: PersonaField) => void;
  suggestion?: PersonaAiSuggestion;
  onApplySuggestion?: (field: PersonaField) => void;
}) {
  const isEmpty = props.value.trim().length === 0;
  return (
    <label className="persona-field">
      <div className="persona-field-heading">
        <div>
          <div className="eyebrow">{props.label}</div>
          <span className="persona-target-chip">{props.targetFile}</span>
        </div>
        {props.aiField && props.onPropose ? (
          <button
            type="button"
            className="ghost-button"
            disabled={props.busyKey !== null}
            onClick={(event) => {
              event.preventDefault();
              props.onPropose?.(props.aiField as PersonaField);
            }}
          >
            {props.busyKey === `persona-ai:${props.aiField}` ? t(props.locale, "setupAiBusy") : t(props.locale, "setupAiFieldButton")}
          </button>
        ) : null}
      </div>
      <div className="field-help">{props.help}</div>
      {props.suggestion && props.aiField ? (
        <div className={`persona-ai-suggestion persona-ai-suggestion-${props.suggestion.mode}`}>
          <div>
            <strong>{props.suggestion.mode === "dedupe" ? t(props.locale, "setupAiSuggestionDedupe") : t(props.locale, "setupAiSuggestionReview")}</strong>
            <p>{props.suggestion.draft}</p>
            {props.suggestion.reasoning ? <small>{props.suggestion.reasoning}</small> : null}
          </div>
          <button type="button" onClick={(event) => {
            event.preventDefault();
            props.onApplySuggestion?.(props.aiField as PersonaField);
          }}>{t(props.locale, "setupApplySuggestion")}</button>
        </div>
      ) : null}
      {props.multiline ? (
        <textarea rows={4} value={props.value} onBlur={props.onTouched} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input value={props.value} onBlur={props.onTouched} onChange={(event) => props.onChange(event.target.value)} />
      )}
      {isEmpty ? <div className="muted">{t(props.locale, "setupFieldEmpty")}</div> : null}
    </label>
  );
}

function SetupFileMap(props: { locale: ProducerRoomLocale }) {
  return (
    <div className="persona-file-map" aria-label="5ファイルの役割">
      {personaLayerMap.map((file) => (
        <div key={file.file} className={`persona-file-map-item${file.editable ? "" : " is-readonly"}${file.requirement === "必須" ? " is-required" : ""}`}>
          <div className="persona-file-map-main">
            <strong>{file.file}</strong>
            <span>{fileText(props.locale, file).role}</span>
          </div>
          <div className="persona-file-badges">
            <span className="persona-badge">{fileText(props.locale, file).kind}</span>
            <span className="persona-badge">{fileText(props.locale, file).requirement}</span>
          </div>
          <p>{fileText(props.locale, file).summary}</p>
          <dl>
            <div><dt>{t(props.locale, "setupPurpose")}</dt><dd>{fileText(props.locale, file).purpose}</dd></div>
            <div><dt>{t(props.locale, "setupWrite")}</dt><dd>{fileText(props.locale, file).write}</dd></div>
            <div><dt>{t(props.locale, "setupAvoid")}</dt><dd>{fileText(props.locale, file).avoid}</dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}

function SaveRow(props: {
  locale: ProducerRoomLocale;
  layer: PersonaDraftLayer;
  dirty: boolean;
  busy: boolean;
  validationError: string | null;
  onSave: () => void;
  onReset: () => void;
}) {
  const editable = layerInfo(props.layer)?.editable ?? true;
  if (!props.dirty && !props.validationError) {
    return null;
  }
  if (!editable) {
    return null;
  }
  return (
    <div className="inline-actions">
      <button
        type="button"
        className="primary"
        disabled={props.busy || Boolean(props.validationError) || !props.dirty}
        onClick={props.onSave}
      >
        {t(props.locale, "setupSave")}
      </button>
      <button type="button" disabled={props.busy || !props.dirty} onClick={props.onReset}>{t(props.locale, "setupDiscard")}</button>
      {props.validationError ? <span className="field-error">{props.validationError}</span> : null}
    </div>
  );
}

function SetupFileEditor(props: {
  locale: ProducerRoomLocale;
  layer: PersonaDraftLayer;
  draft: PersonaDraft;
  dirty: DirtyMap;
  busyKey: string | null;
  validationError: string | null;
  onUpdateArtist: (field: keyof ArtistPersonaDraft, value: string) => void;
  onUpdateSoul: (field: keyof SoulPersonaDraft, value: string) => void;
  onUpdateSnapshot: (layer: "producer", value: string) => void;
  onPropose: (field: PersonaField) => void;
  suggestions: Partial<Record<PersonaField, PersonaAiSuggestion>>;
  onApplySuggestion: (field: PersonaField) => void;
  onSave: () => void;
  onReset: () => void;
  onTouched: () => void;
}) {
  const info = layerInfo(props.layer);
  const text = info ? fileText(props.locale, info) : undefined;
  return (
    <section className="settings-section persona-file-editor">
      <div className="persona-file-editor-head">
        <span className="section-title">{info?.file ?? props.layer} {props.locale === "ja" ? "に書くこと" : "inputs"}</span>
        <span className="muted">{text?.role ?? props.layer} · {text?.summary ?? ""}</span>
      </div>
      {props.layer === "artist" ? (
        <div className="persona-field-list">
          {artistPersonaFields.map((field) => {
            const localized = fieldText(props.locale, field.label, field.help, field.aiField);
            return (
              <PersonaTextInput
                locale={props.locale}
                key={field.field}
                label={localized.label}
                help={localized.help}
                targetFile={field.targetFile}
                value={props.draft.artist[field.field]}
                multiline={field.multiline}
                onChange={(value) => props.onUpdateArtist(field.field, value)}
                onTouched={props.onTouched}
                aiField={field.aiField}
                busyKey={props.busyKey}
                onPropose={props.onPropose}
                suggestion={props.suggestions[field.aiField]}
                onApplySuggestion={props.onApplySuggestion}
              />
            );
          })}
        </div>
      ) : null}
      {props.layer === "soul" ? (
        <div className="persona-field-list">
          {soulPersonaFields.map((field) => {
            const localized = fieldText(props.locale, field.label, field.help, field.aiField);
            return (
              <PersonaTextInput
                locale={props.locale}
                key={field.field}
                label={localized.label}
                help={localized.help}
                targetFile={field.targetFile}
                value={props.draft.soul[field.field]}
                multiline={field.multiline}
                onChange={(value) => props.onUpdateSoul(field.field, value)}
                onTouched={props.onTouched}
                aiField={field.aiField}
                busyKey={props.busyKey}
                onPropose={props.onPropose}
                suggestion={props.suggestions[field.aiField]}
                onApplySuggestion={props.onApplySuggestion}
              />
            );
          })}
        </div>
      ) : null}
      {props.layer === "producer" ? (
        <>
          {(() => {
            const localized = fieldText(props.locale, producerContextField.label, producerContextField.help, producerContextField.aiField);
            return (
          <PersonaTextInput
            locale={props.locale}
            label={localized.label}
            help={localized.help}
            targetFile={producerContextField.targetFile}
            value={props.draft.snapshots.producer}
            multiline
            onChange={(value) => props.onUpdateSnapshot("producer", value)}
            onTouched={props.onTouched}
            aiField={producerContextField.aiField}
            busyKey={props.busyKey}
            onPropose={props.onPropose}
            suggestion={props.suggestions[producerContextField.aiField]}
            onApplySuggestion={props.onApplySuggestion}
          />
            );
          })()}
        </>
      ) : null}
      <SaveRow
        locale={props.locale}
        layer={props.layer}
        dirty={props.dirty[props.layer]}
        busy={props.busyKey === `persona-save:${props.layer}`}
        validationError={props.validationError}
        onSave={props.onSave}
        onReset={props.onReset}
      />
    </section>
  );
}

function IdentityProjection(props: { locale: ProducerRoomLocale; value: string }) {
  return (
    <section className="settings-section persona-file-editor">
      <div className="persona-file-editor-head">
        <span className="section-title">{t(props.locale, "setupReadonlyIdentityTitle")}</span>
        <span className="muted">{t(props.locale, "setupReadonlyIdentityHelp")}</span>
      </div>
      <textarea rows={6} value={props.value} readOnly />
    </section>
  );
}

function InnerFileNote(props: { locale: ProducerRoomLocale }) {
  return (
    <section className="settings-section persona-file-editor">
      <div className="persona-file-editor-head">
        <span className="section-title">{t(props.locale, "setupInnerTitle")}</span>
        <span className="muted">{t(props.locale, "setupInnerHelp")}</span>
      </div>
    </section>
  );
}

function SetupAiActionMenu(props: {
  locale: ProducerRoomLocale;
  busyKey: string | null;
  hasEmptyEditableField: boolean;
  onProposeMissing: () => void;
  onProposeReview: () => void;
  onProposeDedupe: () => void;
}) {
  return (
    <section className="persona-ai-menu" aria-label="AI actions">
      <div className="persona-ai-menu-row">
        <button
          type="button"
          disabled={props.busyKey !== null || !props.hasEmptyEditableField}
          onClick={props.onProposeMissing}
        >
          {props.busyKey === "persona-ai:missing" ? t(props.locale, "setupAiBusy") : t(props.locale, "setupAiFill")}
        </button>
        <div>
          <strong>{t(props.locale, "setupAiFillTitle")}</strong>
          <p>{t(props.locale, "setupAiFillHelp")}</p>
        </div>
      </div>
      <div className="persona-ai-menu-row">
        <button type="button" disabled={props.busyKey !== null} onClick={props.onProposeReview}>
          {props.busyKey === "persona-ai:review_all" ? t(props.locale, "setupAiReviewBusy") : t(props.locale, "setupAiReview")}
        </button>
        <div>
          <strong>{t(props.locale, "setupAiReviewTitle")}</strong>
          <p>{t(props.locale, "setupAiReviewHelp")}</p>
        </div>
      </div>
      <div className="persona-ai-menu-row">
        <button type="button" disabled={props.busyKey !== null} onClick={props.onProposeDedupe}>
          {props.busyKey === "persona-ai:dedupe" ? t(props.locale, "setupAiDedupeBusy") : t(props.locale, "setupAiDedupe")}
        </button>
        <div>
          <strong>{t(props.locale, "setupAiDedupeTitle")}</strong>
          <p>{t(props.locale, "setupAiDedupeHelp")}</p>
        </div>
      </div>
      <p className="persona-ai-menu-note">{t(props.locale, "setupAiNote")}</p>
    </section>
  );
}

export function SetupView(props: {
  locale?: ProducerRoomLocale;
  persona: PersonaEditorSource | null;
  draft: PersonaDraft | null;
  dirty: DirtyMap;
  busyKey: string | null;
  onUpdateArtist: (field: keyof ArtistPersonaDraft, value: string) => void;
  onUpdateSoul: (field: keyof SoulPersonaDraft, value: string) => void;
  onUpdateSnapshot: (layer: "producer", value: string) => void;
  onSaveLayer: (layer: PersonaDraftLayer) => void;
  onReset: () => void;
  onRefresh: () => void;
  onPropose: (field: PersonaField) => void;
  onProposeMissing: () => void;
  onProposeReview: () => void;
  onProposeDedupe: () => void;
  aiSuggestions: Partial<Record<PersonaField, PersonaAiSuggestion>>;
  onApplySuggestion: (field: PersonaField) => void;
  onComplete: () => void;
}) {
  const locale = props.locale ?? "ja";
  const draft = props.draft;
  const setup = props.persona?.setup;
  const weakPersonaFields = props.persona?.audit?.fields.filter((field) => field.setupInput !== false && field.status !== "filled") ?? [];
  const setupBlocked = Boolean(weakPersonaFields.length || props.persona?.audit?.issues.length);
  const weakFieldSummaryForFile = (file: string) => {
    const fields = weakPersonaFields.filter((field) => personaFieldFile(field.field) === file);
    if (!fields.length) {
      return undefined;
    }
    const prefix = locale === "ja" ? "不足" : "Needs";
    return `${prefix}: ${fields.slice(0, 2).map((field) => `${personaFieldLabel(locale, field.field)}(${personaFieldStatusLabel(locale, field.status)})`).join(" / ")}${fields.length > 2 ? ` / ${t(locale, "setupMore")} ${fields.length - 2}` : ""}`;
  };
  const [touched, setTouched] = React.useState<LayerTouchedMap>(emptyTouchedMap);
  const [saveAttempted, setSaveAttempted] = React.useState<LayerTouchedMap>(emptyTouchedMap);
  const hasEmptyEditableField = Boolean(draft && emptyPersonaDraftFields(draft).length > 0);
  const markTouched = (layer: PersonaDraftLayer) => setTouched((current) => ({ ...current, [layer]: true }));
  const visibleValidation = (layer: PersonaDraftLayer) => {
    if (!draft || (!touched[layer] && !saveAttempted[layer])) {
      return null;
    }
    return validatePersonaDraft(draft, layer);
  };
  const saveLayer = (layer: PersonaDraftLayer) => {
    if (!draft) {
      return;
    }
    const validationError = validatePersonaDraft(draft, layer);
    if (validationError) {
      setSaveAttempted((current) => ({ ...current, [layer]: true }));
      return;
    }
    props.onSaveLayer(layer);
  };
  const resetDraft = () => {
    setTouched(emptyTouchedMap);
    setSaveAttempted(emptyTouchedMap);
    props.onReset();
  };
  return (
    <section className="single-column setup-view">
      <article className="panel settings-panel">
        <div className="section-title">{t(locale, "setupTitle")}</div>
        <div className="muted">{t(locale, "setupIntro")}</div>
        <SetupFileMap locale={locale} />
        {setup?.needsSetup ? (
          <div className="warning-banner">{t(locale, "setupIncomplete")}: {setup.reasonsText}</div>
        ) : null}
        {props.persona?.audit?.issues.length ? (
          <div className="warning-banner">
            <strong>{t(locale, "setupWarningsTitle")}</strong>
            <div className="muted">{t(locale, "setupWarningsIntro")}</div>
            <ul>
              {props.persona.audit.issues.slice(0, 3).map((issue) => (
                <li key={`${issue.code}:${issue.file}:${issue.detail}`}>{personaIssueLabel(locale, issue)}</li>
              ))}
            </ul>
            {props.persona.audit.issues.length > 3 ? (
              <div className="muted">{t(locale, "setupMore")} {props.persona.audit.issues.length - 3}.</div>
            ) : null}
          </div>
        ) : null}
        {weakPersonaFields.length ? (
          <div className="warning-banner">
            <strong>{t(locale, "setupMissingTitle")}</strong>
            <ul>
              {weakPersonaFields.slice(0, 3).map((field) => (
                <li key={field.field}>{personaFieldFile(field.field)}: {personaFieldLabel(locale, field.field)}: {personaFieldStatusLabel(locale, field.status)}</li>
              ))}
            </ul>
            {weakPersonaFields.length > 3 ? (
              <div className="muted">{t(locale, "setupMore")} {weakPersonaFields.length - 3}.</div>
            ) : null}
          </div>
        ) : null}
        {!props.persona || !draft ? (
          <div className="item muted">{t(locale, "setupLoading")}</div>
        ) : (
          <div className="settings-sections">
            <SetupAiActionMenu
              locale={locale}
              busyKey={props.busyKey}
              hasEmptyEditableField={hasEmptyEditableField}
              onProposeMissing={props.onProposeMissing}
              onProposeReview={props.onProposeReview}
              onProposeDedupe={props.onProposeDedupe}
            />
            {editableSetupLayers.map((layer) => (
              <React.Fragment key={layer}>
                {weakFieldSummaryForFile(layerInfo(layer)?.file ?? "") ? (
                  <div className="muted">{weakFieldSummaryForFile(layerInfo(layer)?.file ?? "")}</div>
                ) : null}
                <SetupFileEditor
                  locale={locale}
                  layer={layer}
                  draft={draft}
                  dirty={props.dirty}
                  busyKey={props.busyKey}
                  validationError={visibleValidation(layer)}
                  onUpdateArtist={props.onUpdateArtist}
                  onUpdateSoul={props.onUpdateSoul}
                  onUpdateSnapshot={props.onUpdateSnapshot}
                  onPropose={props.onPropose}
                  suggestions={props.aiSuggestions}
                  onApplySuggestion={props.onApplySuggestion}
                  onSave={() => saveLayer(layer)}
                  onReset={resetDraft}
                  onTouched={() => markTouched(layer)}
                />
              </React.Fragment>
            ))}
            <IdentityProjection locale={locale} value={draft.snapshots.identity} />
            <InnerFileNote locale={locale} />
            <div className="inline-actions">
              <button type="button" disabled={props.busyKey !== null} onClick={props.onRefresh}>{t(locale, "setupReload")}</button>
              {setup?.needsSetup ? (
                <button type="button" disabled={props.busyKey === "persona-complete" || setupBlocked} onClick={props.onComplete}>
                  {props.busyKey === "persona-complete" ? t(locale, "setupCompletePending") : setupBlocked ? t(locale, "setupCompleteBlocked") : t(locale, "setupComplete")}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </article>
    </section>
  );
}

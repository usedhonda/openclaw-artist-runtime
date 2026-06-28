import React from "react";
import {
  artistPersonaFields,
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
import type { PersonaField } from "../../../src/types";

type DirtyMap = Record<PersonaDraftLayer, boolean>;
type LayerTouchedMap = Record<PersonaDraftLayer, boolean>;

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

function personaIssueLabel(issue: { code: string; file: string; detail: string }): string {
  switch (issue.code) {
    case "language_policy_outside_artist":
      return `${issue.file}: 日本語/英語比率は ARTIST.md に集約`;
    case "duplicated_language_policy":
      return "日本語/英語比率が複数箇所に重複";
    case "conflicting_language_policy":
      return `日本語/英語比率が矛盾: ${issue.detail}`;
    case "duplicate_suno_profile":
      return "Suno Production Profile が ARTIST.md 内で重複";
    case "obsolete_lyrics_length_rule":
      return "固定文字数ルールが DurationPlan と箱予算に矛盾";
    default:
      return `${issue.file}: ${issue.detail}`;
  }
}

function personaFieldLabel(field: string): string {
  return [...artistPersonaFields, ...soulPersonaFields].find((entry) => entry.aiField === field || entry.field === field)?.label ?? field;
}

function personaFieldFile(field: string): string {
  if (artistPersonaFields.some((entry) => entry.aiField === field || entry.field === field)) {
    return "ARTIST.md";
  }
  if (soulPersonaFields.some((entry) => entry.aiField === field || entry.field === field)) {
    return "SOUL.md";
  }
  return "persona";
}

function personaFieldStatusLabel(status: "filled" | "thin" | "missing"): string {
  return status === "missing" ? "未入力" : status === "thin" ? "薄い" : "入力済み";
}

function PersonaTextInput(props: {
  label: string;
  help: string;
  value: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  onTouched: () => void;
}) {
  const isEmpty = props.value.trim().length === 0;
  return (
    <label className="persona-field">
      <div className="eyebrow">{props.label}</div>
      <div className="field-help">{props.help}</div>
      {props.multiline ? (
        <textarea rows={4} value={props.value} onBlur={props.onTouched} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input value={props.value} onBlur={props.onTouched} onChange={(event) => props.onChange(event.target.value)} />
      )}
      {isEmpty ? <div className="muted">未入力</div> : null}
    </label>
  );
}

function SaveRow(props: {
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
        保存
      </button>
      <button type="button" disabled={props.busy || !props.dirty} onClick={props.onReset}>変更を破棄</button>
      {props.validationError ? <span className="field-error">{props.validationError}</span> : null}
    </div>
  );
}

function SetupFileEditor(props: {
  layer: PersonaDraftLayer;
  draft: PersonaDraft;
  dirty: DirtyMap;
  busyKey: string | null;
  validationError: string | null;
  onUpdateArtist: (field: keyof ArtistPersonaDraft, value: string) => void;
  onUpdateSoul: (field: keyof SoulPersonaDraft, value: string) => void;
  onUpdateSnapshot: (layer: "producer", value: string) => void;
  onSave: () => void;
  onReset: () => void;
  onTouched: () => void;
}) {
  const info = layerInfo(props.layer);
  return (
    <section className="settings-section persona-file-editor">
      <div className="persona-file-editor-head">
        <span className="section-title">{info?.role ?? props.layer}</span>
        <span className="muted">{info?.role ?? props.layer} · {info?.summary}</span>
      </div>
      {props.layer === "artist" ? (
        <div className="persona-field-list">
          {artistPersonaFields.map((field) => (
            <PersonaTextInput
              key={field.field}
              label={field.label}
              help={field.help}
              value={props.draft.artist[field.field]}
              multiline={field.multiline}
              onChange={(value) => props.onUpdateArtist(field.field, value)}
              onTouched={props.onTouched}
            />
          ))}
        </div>
      ) : null}
      {props.layer === "soul" ? (
        <div className="persona-field-list">
          {soulPersonaFields.map((field) => (
            <PersonaTextInput
              key={field.field}
              label={field.label}
              help={field.help}
              value={props.draft.soul[field.field]}
              multiline={field.multiline}
              onChange={(value) => props.onUpdateSoul(field.field, value)}
              onTouched={props.onTouched}
            />
          ))}
        </div>
      ) : null}
      {props.layer === "producer" ? (
        <>
          <PersonaTextInput
            label={producerContextField.label}
            help={producerContextField.help}
            value={props.draft.snapshots.producer}
            multiline
            onChange={(value) => props.onUpdateSnapshot("producer", value)}
            onTouched={props.onTouched}
          />
        </>
      ) : null}
      <SaveRow
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

function IdentityProjection(props: { value: string }) {
  return (
    <section className="settings-section persona-file-editor">
      <div className="persona-file-editor-head">
        <span className="section-title">Generated Identity</span>
        <span className="muted">IDENTITY.md · config と persona から生成される読み取り専用の表示</span>
      </div>
      <textarea rows={6} value={props.value} readOnly />
    </section>
  );
}

export function SetupView(props: {
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
  onComplete: () => void;
}) {
  const draft = props.draft;
  const setup = props.persona?.setup;
  const weakPersonaFields = props.persona?.audit?.fields.filter((field) => field.setupInput !== false && field.status !== "filled") ?? [];
  const setupBlocked = Boolean(weakPersonaFields.length || props.persona?.audit?.issues.length);
  const weakFieldSummaryForFile = (file: string) => {
    const fields = weakPersonaFields.filter((field) => personaFieldFile(field.field) === file);
    if (!fields.length) {
      return undefined;
    }
    return `不足: ${fields.slice(0, 2).map((field) => `${personaFieldLabel(field.field)}(${personaFieldStatusLabel(field.status)})`).join(" / ")}${fields.length > 2 ? ` / ほか${fields.length - 2}` : ""}`;
  };
  const [touched, setTouched] = React.useState<LayerTouchedMap>(emptyTouchedMap);
  const [saveAttempted, setSaveAttempted] = React.useState<LayerTouchedMap>(emptyTouchedMap);
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
        <div className="section-title">アーティスト設定</div>
        <div className="muted">Artist Core、Conversation Voice、Producer Context だけを編集します。IDENTITY は生成表示、INNER は runtime 管理です。</div>
        {setup?.needsSetup ? (
          <div className="warning-banner">初回 setup が未完了です: {setup.reasonsText}</div>
        ) : null}
        {props.persona?.audit?.issues.length ? (
          <div className="warning-banner">
            <strong>設定の警告</strong>
            <ul>
              {props.persona.audit.issues.slice(0, 3).map((issue) => (
                <li key={`${issue.code}:${issue.file}:${issue.detail}`}>{personaIssueLabel(issue)}</li>
              ))}
            </ul>
            {props.persona.audit.issues.length > 3 ? (
              <div className="muted">ほか {props.persona.audit.issues.length - 3} 件。Telegram の /persona check でも確認できます。</div>
            ) : null}
          </div>
        ) : null}
        {weakPersonaFields.length ? (
          <div className="warning-banner">
            <strong>設定の不足</strong>
            <ul>
              {weakPersonaFields.slice(0, 3).map((field) => (
                <li key={field.field}>{personaFieldFile(field.field)}: {personaFieldLabel(field.field)}: {personaFieldStatusLabel(field.status)}</li>
              ))}
            </ul>
            {weakPersonaFields.length > 3 ? (
              <div className="muted">ほか {weakPersonaFields.length - 3} 件。</div>
            ) : null}
          </div>
        ) : null}
        {!props.persona || !draft ? (
          <div className="item muted">Loading persona.</div>
        ) : (
          <div className="settings-sections">
            {editableSetupLayers.map((layer) => (
              <React.Fragment key={layer}>
                {weakFieldSummaryForFile(layerInfo(layer)?.file ?? "") ? (
                  <div className="muted">{weakFieldSummaryForFile(layerInfo(layer)?.file ?? "")}</div>
                ) : null}
                <SetupFileEditor
                  layer={layer}
                  draft={draft}
                  dirty={props.dirty}
                  busyKey={props.busyKey}
                  validationError={visibleValidation(layer)}
                  onUpdateArtist={props.onUpdateArtist}
                  onUpdateSoul={props.onUpdateSoul}
                  onUpdateSnapshot={props.onUpdateSnapshot}
                  onSave={() => saveLayer(layer)}
                  onReset={resetDraft}
                  onTouched={() => markTouched(layer)}
                />
              </React.Fragment>
            ))}
            <IdentityProjection value={draft.snapshots.identity} />
            <div className="inline-actions">
              <button type="button" disabled={props.busyKey !== null} onClick={props.onRefresh}>再読み込み</button>
              {setup?.needsSetup ? (
                <button type="button" disabled={props.busyKey === "persona-complete" || setupBlocked} onClick={props.onComplete}>
                  {props.busyKey === "persona-complete" ? "完了記録中" : setupBlocked ? "不足を埋めると完了" : "初期設定を完了"}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </article>
    </section>
  );
}

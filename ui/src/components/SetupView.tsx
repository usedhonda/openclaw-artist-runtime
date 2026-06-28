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
  if (field === producerContextField.aiField) {
    return "PRODUCER.md";
  }
  return "persona";
}

function personaFieldStatusLabel(status: "filled" | "thin" | "missing"): string {
  return status === "missing" ? "未入力" : status === "thin" ? "薄い" : "入力済み";
}

function PersonaTextInput(props: {
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
            {props.busyKey === `persona-ai:${props.aiField}` ? "作成中" : "AI案"}
          </button>
        ) : null}
      </div>
      <div className="field-help">{props.help}</div>
      {props.suggestion && props.aiField ? (
        <div className={`persona-ai-suggestion persona-ai-suggestion-${props.suggestion.mode}`}>
          <div>
            <strong>{props.suggestion.mode === "dedupe" ? "重複整理案" : "AI添削案"}</strong>
            <p>{props.suggestion.draft}</p>
            {props.suggestion.reasoning ? <small>{props.suggestion.reasoning}</small> : null}
          </div>
          <button type="button" onClick={(event) => {
            event.preventDefault();
            props.onApplySuggestion?.(props.aiField as PersonaField);
          }}>案を入れる</button>
        </div>
      ) : null}
      {props.multiline ? (
        <textarea rows={4} value={props.value} onBlur={props.onTouched} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input value={props.value} onBlur={props.onTouched} onChange={(event) => props.onChange(event.target.value)} />
      )}
      {isEmpty ? <div className="muted">未入力</div> : null}
    </label>
  );
}

function SetupFileMap() {
  return (
    <div className="persona-file-map" aria-label="5ファイルの役割">
      {personaLayerMap.map((file) => (
        <div key={file.file} className={`persona-file-map-item${file.editable ? "" : " is-readonly"}${file.requirement === "必須" ? " is-required" : ""}`}>
          <div className="persona-file-map-main">
            <strong>{file.file}</strong>
            <span>{file.role}</span>
          </div>
          <div className="persona-file-badges">
            <span className="persona-badge">{file.kind}</span>
            <span className="persona-badge">{file.requirement}</span>
          </div>
          <p>{file.summary}</p>
          <dl>
            <div><dt>書く</dt><dd>{file.write}</dd></div>
            <div><dt>書かない</dt><dd>{file.avoid}</dd></div>
          </dl>
        </div>
      ))}
    </div>
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
  onPropose: (field: PersonaField) => void;
  suggestions: Partial<Record<PersonaField, PersonaAiSuggestion>>;
  onApplySuggestion: (field: PersonaField) => void;
  onSave: () => void;
  onReset: () => void;
  onTouched: () => void;
}) {
  const info = layerInfo(props.layer);
  return (
    <section className="settings-section persona-file-editor">
      <div className="persona-file-editor-head">
        <span className="section-title">{info?.file ?? props.layer} に書くこと</span>
        <span className="muted">{info?.role ?? props.layer} · {info?.summary}</span>
      </div>
      {props.layer === "artist" ? (
        <div className="persona-field-list">
          {artistPersonaFields.map((field) => (
            <PersonaTextInput
              key={field.field}
              label={field.label}
              help={field.help}
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
          ))}
        </div>
      ) : null}
      {props.layer === "producer" ? (
        <>
          <PersonaTextInput
            label={producerContextField.label}
            help={producerContextField.help}
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
        <span className="section-title">IDENTITY.md 自動表示</span>
        <span className="muted">上の入力と設定から作る確認用の自己紹介。直接編集しません。</span>
      </div>
      <textarea rows={6} value={props.value} readOnly />
    </section>
  );
}

function InnerFileNote() {
  return (
    <section className="settings-section persona-file-editor">
      <div className="persona-file-editor-head">
        <span className="section-title">INNER.md の扱い</span>
        <span className="muted">内部メモ。Setup では編集しません。既存内容は消しません。</span>
      </div>
    </section>
  );
}

function SetupAiActionMenu(props: {
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
          {props.busyKey === "persona-ai:missing" ? "作成中" : "空欄をAI補完"}
        </button>
        <div>
          <strong>未入力だけを埋める</strong>
          <p>他の欄を読んで、空欄だけに下書きを入れます。書いてある内容は上書きしません。</p>
        </div>
      </div>
      <div className="persona-ai-menu-row">
        <button type="button" disabled={props.busyKey !== null} onClick={props.onProposeReview}>
          {props.busyKey === "persona-ai:review_all" ? "添削中" : "全体をAI添削"}
        </button>
        <div>
          <strong>5ファイル全体を本気で磨く</strong>
          <p>薄い表現、普通すぎる言葉、音楽家として弱い個性を削り、もっと尖った案を各欄に出します。保存はしません。</p>
        </div>
      </div>
      <div className="persona-ai-menu-row">
        <button type="button" disabled={props.busyKey !== null} onClick={props.onProposeDedupe}>
          {props.busyKey === "persona-ai:dedupe" ? "整理中" : "重複整理案"}
        </button>
        <div>
          <strong>正本ルールで散らばりを直す</strong>
          <p>名前、呼称、声、音楽性、producer 情報が wrong file に混ざっていないか見て、移動・削除の案を出します。</p>
        </div>
      </div>
      <p className="persona-ai-menu-note">AI案は保存前の下書きです。空欄補完以外は、各欄の「案を入れる」で反映します。</p>
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
  onProposeMissing: () => void;
  onProposeReview: () => void;
  onProposeDedupe: () => void;
  aiSuggestions: Partial<Record<PersonaField, PersonaAiSuggestion>>;
  onApplySuggestion: (field: PersonaField) => void;
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
        <div className="section-title">アーティスト設定</div>
        <div className="muted">5つのファイルの全体像です。入力する場所、自動生成される場所、内部管理の場所をここで分けて見ます。</div>
        <SetupFileMap />
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
            <SetupAiActionMenu
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
            <IdentityProjection value={draft.snapshots.identity} />
            <InnerFileNote />
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

import React from "react";
import {
  artistPersonaFields,
  personaLayerMap,
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

const snapshotLayerInfo = (layer: "identity" | "producer" | "inner") =>
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
  return [...artistPersonaFields, ...soulPersonaFields].find((entry) => entry.aiField === field)?.label ?? field;
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
  if (!props.dirty && !props.validationError) {
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

export function SetupView(props: {
  persona: PersonaEditorSource | null;
  draft: PersonaDraft | null;
  dirty: DirtyMap;
  busyKey: string | null;
  onUpdateArtist: (field: keyof ArtistPersonaDraft, value: string) => void;
  onUpdateSoul: (field: keyof SoulPersonaDraft, value: string) => void;
  onUpdateSnapshot: (layer: "identity" | "producer" | "inner", value: string) => void;
  onSaveLayer: (layer: PersonaDraftLayer) => void;
  onReset: () => void;
  onRefresh: () => void;
  onPropose: (field: PersonaField) => void;
  onComplete: () => void;
}) {
  const draft = props.draft;
  const setup = props.persona?.setup;
  const weakPersonaFields = props.persona?.audit?.fields.filter((field) => field.status !== "filled") ?? [];
  const setupBlocked = Boolean(weakPersonaFields.length || props.persona?.audit?.issues.length);
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
        <div className="muted">曲づくりに効く人格だけを並べます。必要なところだけ開いて編集します。</div>
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
                <li key={field.field}>{personaFieldLabel(field.field)}: {personaFieldStatusLabel(field.status)}</li>
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
            <details className="settings-section persona-layer-details">
              <summary>
                <span className="section-title">創作の核</span>
                <span className="muted">曲づくりの土台。必要な時だけ開いて編集します。</span>
              </summary>
              <div className="muted">保存先: ARTIST.md</div>
              <div className="persona-field-list">
                {artistPersonaFields.map((field) => (
                  <PersonaTextInput
                    key={field.field}
                    label={field.label}
                    help={field.help}
                    value={draft.artist[field.field]}
                    multiline={field.multiline}
                    onChange={(value) => props.onUpdateArtist(field.field, value)}
                    onTouched={() => markTouched("artist")}
                  />
                ))}
              </div>
              <SaveRow
                layer="artist"
                dirty={props.dirty.artist}
                busy={props.busyKey === "persona-save:artist"}
                validationError={visibleValidation("artist")}
                onSave={() => saveLayer("artist")}
                onReset={resetDraft}
              />
            </details>
            <details className="settings-section persona-layer-details">
              <summary>
                <span className="section-title">会話人格</span>
                <span className="muted">Telegram や部屋で話す温度。必要な時だけ開いて編集します。</span>
              </summary>
              <div className="muted">保存先: SOUL.md</div>
              <div className="persona-field-list">
                {soulPersonaFields.map((field) => (
                  <PersonaTextInput
                    key={field.field}
                    label={field.label}
                    help={field.help}
                    value={draft.soul[field.field]}
                    multiline={field.multiline}
                    onChange={(value) => props.onUpdateSoul(field.field, value)}
                    onTouched={() => markTouched("soul")}
                  />
                ))}
              </div>
              <SaveRow
                layer="soul"
                dirty={props.dirty.soul}
                busy={props.busyKey === "persona-save:soul"}
                validationError={visibleValidation("soul")}
                onSave={() => saveLayer("soul")}
                onReset={resetDraft}
              />
            </details>
            {(["identity", "producer", "inner"] as const).map((layer) => (
              <details className="settings-section persona-layer-details" key={layer}>
                <summary>
                  <span className="section-title">{snapshotLayerInfo(layer)?.role}</span>
                  <span className="muted">{snapshotLayerInfo(layer)?.summary}</span>
                </summary>
                <div className="muted">保存先: {snapshotLayerInfo(layer)?.file}</div>
                <div className="muted">全文をそのまま保存します。</div>
                <textarea rows={10} value={draft.snapshots[layer]} onBlur={() => markTouched(layer)} onChange={(event) => props.onUpdateSnapshot(layer, event.target.value)} />
                {draft.snapshots[layer].trim().length === 0 ? <div className="muted">未入力</div> : null}
                <SaveRow
                  layer={layer}
                  dirty={props.dirty[layer]}
                  busy={props.busyKey === `persona-save:${layer}`}
                  validationError={visibleValidation(layer)}
                  onSave={() => saveLayer(layer)}
                  onReset={resetDraft}
                />
              </details>
            ))}
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

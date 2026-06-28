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

function PersonaTextInput(props: {
  label: string;
  help: string;
  value: string;
  originalValue: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  onTouched: () => void;
  onAiDraft?: () => void;
  onResetField: () => void;
  aiBusy?: boolean;
}) {
  const isEmpty = props.value.trim().length === 0;
  const fieldChanged = props.value !== props.originalValue;
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
      {props.onAiDraft ? (
        <div className="ai-draft-row">
          <button type="button" className="secondary" disabled={props.aiBusy} onClick={props.onAiDraft}>
            {props.aiBusy ? "作成中" : "AIお任せ"}
          </button>
          <button type="button" disabled={!fieldChanged} onClick={props.onResetField}>元に戻す</button>
        </div>
      ) : null}
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
  return (
    <div className="inline-actions">
      <button
        type="button"
        className="primary"
        disabled={props.busy || Boolean(props.validationError) || !props.dirty}
        onClick={props.onSave}
      >
        Save
      </button>
      <button type="button" disabled={props.busy || !props.dirty} onClick={props.onReset}>Reset Draft</button>
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
        <div className="section-title">Artist Setup</div>
        <div className="muted">ファイル名は残しつつ、ここでは「何に効く人格か」を先に見せます。</div>
        <div className="eyebrow">参照ファイル</div>
        <div className="persona-layer-map" aria-label="persona layer map">
          {personaLayerMap.map((entry) => (
            <div className="persona-layer-chip" key={entry.layer}>
              <strong>{entry.role}</strong>
              <span>{entry.file}</span>
              <small>{entry.summary}</small>
            </div>
          ))}
        </div>
        {setup?.needsSetup ? (
          <div className="warning-banner">初回 setup が未完了です: {setup.reasonsText}</div>
        ) : null}
        {!props.persona || !draft ? (
          <div className="item muted">Loading persona.</div>
        ) : (
          <div className="settings-sections">
            <section className="settings-section">
              <div className="section-title">創作の核</div>
              <div className="muted">曲の音楽性・作詞・世界観・SNS声に効く設定です。AIお任せは欄に案を入れるだけで、保存するまで反映されません。</div>
              <div className="muted">参照元: ARTIST.md</div>
              <div className="persona-field-list">
                {artistPersonaFields.map((field) => (
                  <PersonaTextInput
                    key={field.field}
                    label={field.label}
                    help={field.help}
                    value={draft.artist[field.field]}
                    originalValue={props.persona.artist[field.field]}
                    multiline={field.multiline}
                    onChange={(value) => props.onUpdateArtist(field.field, value)}
                    onTouched={() => markTouched("artist")}
                    onAiDraft={() => props.onPropose(field.aiField)}
                    onResetField={() => props.onUpdateArtist(field.field, props.persona?.artist[field.field] ?? "")}
                    aiBusy={props.busyKey === `persona-ai:${field.aiField}`}
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
            </section>
            <section className="settings-section">
              <div className="section-title">会話人格</div>
              <div className="muted">Telegram や Producer Room で話す温度、距離感、断り方に効きます。AIお任せは欄に案を入れるだけで、保存するまで反映されません。</div>
              <div className="muted">参照元: SOUL.md</div>
              <div className="persona-field-list">
                {soulPersonaFields.map((field) => (
                  <PersonaTextInput
                    key={field.field}
                    label={field.label}
                    help={field.help}
                    value={draft.soul[field.field]}
                    originalValue={props.persona.soul[field.field]}
                    multiline={field.multiline}
                    onChange={(value) => props.onUpdateSoul(field.field, value)}
                    onTouched={() => markTouched("soul")}
                    onAiDraft={() => props.onPropose(field.aiField)}
                    onResetField={() => props.onUpdateSoul(field.field, props.persona?.soul[field.field] ?? "")}
                    aiBusy={props.busyKey === `persona-ai:${field.aiField}`}
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
            </section>
            {(["identity", "producer", "inner"] as const).map((layer) => (
              <details className="settings-section persona-layer-details" key={layer}>
                <summary>
                  <span className="section-title">{snapshotLayerInfo(layer)?.role}</span>
                  <span className="muted">{snapshotLayerInfo(layer)?.summary}</span>
                  <span className="muted">参照元: {snapshotLayerInfo(layer)?.file}</span>
                </summary>
                <div className="muted">全文をそのまま保存します。AIお任せはありません。</div>
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
              <button type="button" disabled={props.busyKey !== null} onClick={props.onRefresh}>Refresh</button>
              <button type="button" disabled={props.busyKey === "persona-complete"} onClick={props.onComplete}>
                {props.busyKey === "persona-complete" ? "完了記録中" : "Setup 完了"}
              </button>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}

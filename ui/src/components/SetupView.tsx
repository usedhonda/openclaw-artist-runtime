import React from "react";
import {
  artistPersonaFields,
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

function PersonaTextInput(props: {
  label: string;
  value: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  onAiDraft?: () => void;
  aiBusy?: boolean;
}) {
  return (
    <label>
      <div className="eyebrow">{props.label}</div>
      {props.multiline ? (
        <textarea rows={4} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      )}
      {props.onAiDraft ? (
        <button type="button" className="secondary" disabled={props.aiBusy} onClick={props.onAiDraft}>
          {props.aiBusy ? "下書き中" : "AI下書き"}
        </button>
      ) : null}
    </label>
  );
}

function SaveRow(props: {
  layer: PersonaDraftLayer;
  dirty: boolean;
  busy: boolean;
  validationError: string | null;
  onSave: (layer: PersonaDraftLayer) => void;
  onReset: () => void;
}) {
  return (
    <div className="inline-actions">
      <button
        type="button"
        className="primary"
        disabled={props.busy || Boolean(props.validationError) || !props.dirty}
        onClick={() => props.onSave(props.layer)}
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
  return (
    <section className="single-column setup-view">
      <article className="panel settings-panel">
        <div className="section-title">Setup</div>
        <div className="muted">アーティスト人格5層を編集します。AI下書きは Artist / Soul のみです。</div>
        {setup?.needsSetup ? (
          <div className="warning-banner">初回 setup が未完了です: {setup.reasonsText}</div>
        ) : null}
        {!props.persona || !draft ? (
          <div className="item muted">Loading persona.</div>
        ) : (
          <div className="settings-sections">
            <section className="settings-section">
              <div className="section-title">ARTIST.md</div>
              <div className="field-grid">
                {artistPersonaFields.map((field) => (
                  <PersonaTextInput
                    key={field.field}
                    label={field.label}
                    value={draft.artist[field.field]}
                    multiline={field.multiline}
                    onChange={(value) => props.onUpdateArtist(field.field, value)}
                    onAiDraft={() => props.onPropose(field.aiField)}
                    aiBusy={props.busyKey === `persona-ai:${field.aiField}`}
                  />
                ))}
              </div>
              <SaveRow
                layer="artist"
                dirty={props.dirty.artist}
                busy={props.busyKey === "persona-save:artist"}
                validationError={validatePersonaDraft(draft, "artist")}
                onSave={props.onSaveLayer}
                onReset={props.onReset}
              />
            </section>
            <section className="settings-section">
              <div className="section-title">SOUL.md</div>
              <div className="field-grid">
                {soulPersonaFields.map((field) => (
                  <PersonaTextInput
                    key={field.field}
                    label={field.label}
                    value={draft.soul[field.field]}
                    multiline={field.multiline}
                    onChange={(value) => props.onUpdateSoul(field.field, value)}
                    onAiDraft={() => props.onPropose(field.aiField)}
                    aiBusy={props.busyKey === `persona-ai:${field.aiField}`}
                  />
                ))}
              </div>
              <SaveRow
                layer="soul"
                dirty={props.dirty.soul}
                busy={props.busyKey === "persona-save:soul"}
                validationError={validatePersonaDraft(draft, "soul")}
                onSave={props.onSaveLayer}
                onReset={props.onReset}
              />
            </section>
            {(["identity", "producer", "inner"] as const).map((layer) => (
              <section className="settings-section" key={layer}>
                <div className="section-title">{layer.toUpperCase()}.md</div>
                <div className="muted">textarea 全文置換です。AI下書きはありません。</div>
                <textarea rows={10} value={draft.snapshots[layer]} onChange={(event) => props.onUpdateSnapshot(layer, event.target.value)} />
                <SaveRow
                  layer={layer}
                  dirty={props.dirty[layer]}
                  busy={props.busyKey === `persona-save:${layer}`}
                  validationError={validatePersonaDraft(draft, layer)}
                  onSave={props.onSaveLayer}
                  onReset={props.onReset}
                />
              </section>
            ))}
            <div className="inline-actions">
              <button type="button" disabled={props.busyKey !== null} onClick={props.onRefresh}>Refresh</button>
              <button type="button" disabled={props.busyKey === "persona-complete"} onClick={props.onComplete}>
                {props.busyKey === "persona-complete" ? "Completing..." : "Setup complete"}
              </button>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}

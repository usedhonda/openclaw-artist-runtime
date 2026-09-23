import React, { useState } from "react";

export interface ProposalFieldDetail {
  field: string;
  currentValue?: string;
  proposedValue: string;
  reasoning?: string;
  status: "proposed" | "skipped" | "low_confidence";
}

export interface ProposalDetail {
  id: string;
  domain: "persona" | "song";
  summary: string;
  fields: ProposalFieldDetail[];
  warnings?: string[];
  createdAt: string;
  songId?: string;
}

export interface PendingChangeSetCardProps {
  domain: "persona" | "song";
  proposals: ProposalDetail[];
  busy: boolean;
  highlight?: boolean;
  onYes: (id: string) => Promise<void> | void;
  onNo: (id: string) => Promise<void> | void;
  onEdit: (id: string, fields: Record<string, string>) => Promise<void> | void;
}

export async function submitProposalYes(onYes: PendingChangeSetCardProps["onYes"], id: string): Promise<void> {
  await onYes(id);
}

export async function submitProposalNo(onNo: PendingChangeSetCardProps["onNo"], id: string): Promise<void> {
  await onNo(id);
}

export function buildProposalEditFields(proposal: ProposalDetail, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    proposal.fields.map((field) => [field.field, values[field.field] ?? field.proposedValue])
  );
}

export async function submitProposalEdit(
  onEdit: PendingChangeSetCardProps["onEdit"],
  id: string,
  fields: Record<string, string>
): Promise<void> {
  await onEdit(id, fields);
}

function truncate(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

export function PendingChangeSetCard(props: PendingChangeSetCardProps) {
  const proposals = props.proposals.filter((proposal) => proposal.domain === props.domain);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftFields, setDraftFields] = useState<Record<string, string>>({});

  const startEdit = (proposal: ProposalDetail) => {
    setEditingId(proposal.id);
    setDraftFields(Object.fromEntries(proposal.fields.map((field) => [field.field, field.proposedValue])));
  };

  const saveEdit = async (proposal: ProposalDetail) => {
    await submitProposalEdit(props.onEdit, proposal.id, buildProposalEditFields(proposal, draftFields));
    setEditingId(null);
    setDraftFields({});
  };

  return (
    <article className={`panel pending-changeset-card${proposals.length > 0 ? " has-proposals" : ""}${props.highlight ? " is-highlighted" : ""}`}>
      <div className="section-title">{props.domain === "song" ? "Song ChangeSet" : "Artist Mind ChangeSet"}</div>
      {proposals.length === 0 ? (
        <div className="item muted">No pending {props.domain} ChangeSet.</div>
      ) : (
        <div className="list">
          {proposals.map((proposal) => (
            <div className="item changeset-proposal" key={proposal.id}>
              <div className="inline-actions">
                <div>
                  <strong>{proposal.summary}</strong>
                  <div className="muted">{proposal.id} · {proposal.fields.length} fields · {proposal.createdAt}</div>
                </div>
                <div className="inline-actions">
                  <button className="primary" disabled={props.busy} onClick={() => void submitProposalYes(props.onYes, proposal.id)}>Yes</button>
                  <button disabled={props.busy} onClick={() => void submitProposalNo(props.onNo, proposal.id)}>No</button>
                  <button disabled={props.busy} onClick={() => startEdit(proposal)}>Edit</button>
                </div>
              </div>
              {proposal.warnings?.length ? <div className="muted">Warnings: {proposal.warnings.join(" · ")}</div> : null}
              <div className="changeset-table">
                <div className="changeset-row changeset-head">
                  <span>Field</span>
                  <span>Current</span>
                  <span>Proposed</span>
                  <span>Reasoning</span>
                  <span>Status</span>
                </div>
                {proposal.fields.map((field) => (
                  <div className="changeset-row" key={field.field}>
                    <strong>{field.field}</strong>
                    <span>{truncate(field.currentValue)}</span>
                    <span>{truncate(field.proposedValue)}</span>
                    <span>{truncate(field.reasoning)}</span>
                    <span>{field.status}</span>
                  </div>
                ))}
              </div>
              {editingId === proposal.id ? (
                <div className="changeset-edit-modal">
                  <strong>Edit proposed values</strong>
                  {proposal.fields.map((field) => (
                    <label className="changeset-field-input" key={field.field}>
                      <span>{field.field}</span>
                      <textarea
                        value={draftFields[field.field] ?? field.proposedValue}
                        onChange={(event) => setDraftFields((current) => ({ ...current, [field.field]: event.target.value }))}
                        rows={2}
                      />
                    </label>
                  ))}
                  <div className="inline-actions">
                    <button className="primary" disabled={props.busy} onClick={() => void saveEdit(proposal)}>Save edit</button>
                    <button disabled={props.busy} onClick={() => setEditingId(null)}>Cancel edit</button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

import React from "react";

export interface PendingApprovalSummary {
  id: string;
  domain: "persona" | "song";
  summary: string;
  fieldCount: number;
  createdAt: string;
}

export interface PendingApprovalsCardProps {
  count?: number;
  recent?: PendingApprovalSummary[];
  onViewDomain?: (domain: "persona" | "song") => void;
}

export function PendingApprovalsCard(props: PendingApprovalsCardProps) {
  const count = props.count ?? 0;
  const recent = props.recent ?? [];

  return (
    <article className={`panel pending-approvals-card${count > 0 ? " has-pending" : ""}`}>
      <div className="section-title">Pending Approvals</div>
      {count === 0 ? (
        <div className="item muted">No pending approvals.</div>
      ) : (
        <div className="list">
          <div className="item">
            <strong>{count} pending proposal{count === 1 ? "" : "s"}</strong>
            <div className="muted">Review what the artist wants to change before it writes files.</div>
          </div>
          {recent.map((approval) => (
            <div className="item" key={approval.id}>
              <div className="inline-actions">
                <strong>{approval.domain}</strong>
                <button type="button" onClick={() => props.onViewDomain?.(approval.domain)}>View detail</button>
              </div>
              <div>{approval.summary}</div>
              <div className="muted">{approval.fieldCount} fields · {approval.createdAt}</div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

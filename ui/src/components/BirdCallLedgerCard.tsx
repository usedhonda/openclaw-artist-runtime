import React from "react";

export interface BirdLedgerDetail {
  todayCalls: Array<{
    timestamp: string;
    query?: string;
    mode?: string;
  }>;
  cooldown: {
    until?: string;
    reason?: string;
  };
  nextAllowedAt?: string;
}

function timeLabel(value?: string): string {
  return value ? new Date(value).toLocaleString() : "-";
}

export function BirdCallLedgerCard(props: { ledger?: BirdLedgerDetail }) {
  const ledger = props.ledger;
  return (
    <article className="panel bird-call-ledger-card">
      <div className="section-title">Bird Call Ledger</div>
      {ledger ? (
        <>
          {ledger.cooldown.until ? (
            <div className="warning-banner">Cooling down until {timeLabel(ledger.cooldown.until)} · {ledger.cooldown.reason ?? "no reason"}</div>
          ) : <div className="item muted">Bird is not in cool-down{ledger.nextAllowedAt ? ` · next allowed ${timeLabel(ledger.nextAllowedAt)}` : ""}.</div>}
          <div className="list">
            {ledger.todayCalls.length ? ledger.todayCalls.map((call) => (
              <div className="item" key={call.timestamp}>
                <strong>{call.query ?? "timeline"}</strong>
                <div className="muted">{call.mode ?? "unknown"} · {timeLabel(call.timestamp)}</div>
              </div>
            )) : <div className="item muted">No Bird calls today.</div>}
          </div>
        </>
      ) : <div className="item muted">Loading Bird ledger.</div>}
    </article>
  );
}

import React from "react";

export interface DistributionDetectionDetail {
  unitedMasters?: { url?: string; detectedAt?: string; lastCheckedAt?: string };
  spotify?: { url?: string; detectedAt?: string; lastCheckedAt?: string };
  appleMusic?: { url?: string; detectedAt?: string; lastCheckedAt?: string };
}

const dspRows: Array<{ key: keyof DistributionDetectionDetail; label: string }> = [
  { key: "unitedMasters", label: "UnitedMasters" },
  { key: "spotify", label: "Spotify" },
  { key: "appleMusic", label: "Apple Music" }
];

function timeLabel(value?: string): string {
  return value ? new Date(value).toLocaleString() : "-";
}

export function DistributionDetectionCard(props: { detected?: DistributionDetectionDetail }) {
  const detected = props.detected ?? {};
  return (
    <article className="panel distribution-detection-card">
      <div className="section-title">Distribution Detection</div>
      <div className="list">
        {dspRows.map((row) => {
          const entry = detected[row.key];
          return (
            <div className="item" key={row.key}>
              <div className="eyebrow">{row.label}</div>
              <strong>{entry?.url ? "detected" : "not detected"}</strong>
              <div className="muted">detected at {timeLabel(entry?.detectedAt)} · last checked {timeLabel(entry?.lastCheckedAt)}</div>
              {entry?.url ? <div className="muted">{entry.url}</div> : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}

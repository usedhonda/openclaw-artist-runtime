import React, { useState } from "react";

export type ManualSongCreatePost = <T>(path: string, body?: unknown) => Promise<T>;

export interface ManualSongCreateCardProps {
  busy: boolean;
  onCreate: ManualSongCreatePost;
  onCreated?: (message: string) => void;
}

export async function submitManualSongCreate(
  onCreate: ManualSongCreatePost,
  hint: string
): Promise<{ tickerOutcome?: string; stage?: string }> {
  const trimmed = hint.trim();
  return onCreate("/run-cycle", trimmed ? { manualSeed: { hint: trimmed } } : undefined);
}

export function ManualSongCreateCard(props: ManualSongCreateCardProps) {
  const [hint, setHint] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    const result = await submitManualSongCreate(props.onCreate, hint);
    const nextMessage = result.tickerOutcome
      ? `Artist cycle requested: ${result.tickerOutcome}`
      : "Artist cycle requested.";
    setMessage(nextMessage);
    props.onCreated?.(nextMessage);
    setHint("");
  };

  return (
    <article className="panel manual-song-card">
      <div className="section-title">Ask Artist To Make A Song</div>
      <div className="config-form">
        <label>
          <div className="eyebrow">Producer hint</div>
          <textarea
            value={hint}
            onChange={(event) => setHint(event.target.value)}
            rows={3}
            placeholder="Optional: Xで見てきてほしい話題、違和感、曲の芯"
          />
        </label>
        <div className="muted">Empty hint lets the artist choose autonomously. No live publish arm is changed.</div>
        <div className="inline-actions">
          <button className="primary" disabled={props.busy} onClick={() => void submit()}>
            Ask artist to make a song
          </button>
          {message ? <span className="muted">{message}</span> : null}
        </div>
      </div>
    </article>
  );
}

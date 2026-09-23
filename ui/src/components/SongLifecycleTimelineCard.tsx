import { useEffect, useMemo, useState } from "react";

type StageId =
  | "idle"
  | "planning"
  | "prompt_pack"
  | "suno_generation"
  | "take_selection"
  | "asset_generation"
  | "publishing"
  | "completed";

type SongSummary = {
  songId: string;
  title: string;
  status: string;
  updatedAt?: string;
};

type RuntimeEvent = {
  type: string;
  songId?: string;
  selectedTakeId?: string;
  timestamp?: number;
};

type SongEventsResponse = {
  events?: RuntimeEvent[];
};

const apiBase = "/plugins/artist-runtime/api";
const defaultEventStreamUrl = `${apiBase}/events/stream`;
const stages: StageId[] = ["idle", "planning", "prompt_pack", "suno_generation", "take_selection", "asset_generation", "publishing", "completed"];
const stageLabels: Record<StageId, string> = {
  idle: "idle",
  planning: "planning",
  prompt_pack: "prompt pack",
  suno_generation: "Suno",
  take_selection: "take",
  asset_generation: "assets",
  publishing: "publish",
  completed: "done"
};

const eventStage: Record<string, StageId> = {
  song_spawn_proposed: "planning",
  planning_skeleton_incomplete: "planning",
  prompt_pack_ready: "prompt_pack",
  suno_generate_retry: "suno_generation",
  suno_budget_low: "suno_generation",
  take_select_pending: "take_selection",
  take_select_low_score: "take_selection",
  song_take_completed: "asset_generation",
  distribution_change_detected: "publishing",
  song_songbook_written: "publishing"
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchSongEvents(songId: string): Promise<RuntimeEvent[]> {
  try {
    const response = await fetchJson<SongEventsResponse>(`/songs/${encodeURIComponent(songId)}/events`);
    return response.events ?? [];
  } catch {
    return [];
  }
}

function parseRuntimeEvent(data: string): RuntimeEvent | undefined {
  try {
    const parsed = JSON.parse(data) as RuntimeEvent;
    return typeof parsed.type === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function eventKey(event: RuntimeEvent): string {
  return `${event.type}:${event.songId ?? ""}:${event.selectedTakeId ?? ""}:${event.timestamp ?? 0}`;
}

function mergeSongEvents(current: RuntimeEvent[] = [], next: RuntimeEvent[]): RuntimeEvent[] {
  const seen = new Set<string>();
  return [...current, ...next]
    .filter((event) => {
      const key = eventKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

function stageIndex(stage: StageId): number {
  return stages.indexOf(stage);
}

function reachedStages(song: SongSummary, events: RuntimeEvent[]): Set<StageId> {
  const reached = new Set<StageId>(["idle"]);
  for (const event of events) {
    const stage = eventStage[event.type];
    if (stage) reached.add(stage);
  }
  if (song.status === "published") {
    reached.add("completed");
  }
  if (stages.includes(song.status as StageId)) {
    reached.add(song.status as StageId);
  }
  return reached;
}

function currentStage(song: SongSummary, reached: Set<StageId>): StageId {
  if (song.status === "published") return "completed";
  if (stages.includes(song.status as StageId)) return song.status as StageId;
  return [...reached].sort((a, b) => stageIndex(b) - stageIndex(a))[0] ?? "idle";
}

function formatTimestamp(value?: string): string {
  if (!value) return "updated time unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export interface SongLifecycleTimelineCardProps {
  eventStreamUrl?: string;
  limit?: number;
}

export function SongLifecycleTimelineCard(props: SongLifecycleTimelineCardProps) {
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [eventsBySong, setEventsBySong] = useState<Record<string, RuntimeEvent[]>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const nextSongs = await fetchJson<SongSummary[]>("/songs");
        if (cancelled) return;
        const limit = props.limit ?? 10;
        const sorted = [...nextSongs]
          .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
          .slice(0, limit);
        setSongs(sorted);
        const eventPairs = await Promise.all(sorted.map(async (song) => [song.songId, await fetchSongEvents(song.songId)] as const));
        if (cancelled) return;
        setEventsBySong(Object.fromEntries(eventPairs));
      } catch {
        if (!cancelled) {
          setSongs([]);
          setEventsBySong({});
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [props.limit]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.EventSource !== "function") {
      return undefined;
    }
    const source = new window.EventSource(props.eventStreamUrl ?? defaultEventStreamUrl);
    source.onmessage = (message) => {
      const event = parseRuntimeEvent(message.data);
      if (!event?.songId) return;
      setEventsBySong((current) => ({
        ...current,
        [event.songId as string]: mergeSongEvents(current[event.songId], [event])
      }));
    };
    source.onerror = () => {
      source.close();
    };
    return () => {
      source.close();
    };
  }, [props.eventStreamUrl]);

  const rows = useMemo(() => {
    return songs.map((song) => {
      const events = eventsBySong[song.songId] ?? [];
      const reached = reachedStages(song, events);
      const current = currentStage(song, reached);
      return { song, reached, current };
    });
  }, [eventsBySong, songs]);

  return (
    <article className="panel song-lifecycle-card">
      <div className="section-title">Song Lifecycle Timeline</div>
      {rows.length === 0 ? (
        <div className="item muted">No song lifecycle events yet.</div>
      ) : (
        <div className="song-lifecycle-list">
          {rows.map(({ song, reached, current }) => (
            <div className="song-lifecycle-row" key={song.songId}>
              <div className="song-lifecycle-head">
                <a href={`#song=${encodeURIComponent(song.songId)}`}><strong>{song.title || song.songId}</strong></a>
                <span className="muted">{song.songId} · {formatTimestamp(song.updatedAt)}</span>
              </div>
              <div className="song-lifecycle-track" aria-label={`${song.songId} lifecycle`}>
                {stages.map((stage) => {
                  const filled = reached.has(stage) || stageIndex(stage) <= stageIndex(current);
                  return (
                    <div className={`song-lifecycle-step${filled ? " is-filled" : ""}${current === stage ? " is-current" : ""}`} key={stage}>
                      <span className="song-lifecycle-dot" aria-hidden="true" />
                      <span>{stageLabels[stage]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="muted">Recent {props.limit ?? 10} songs · live updates from runtime events.</div>
    </article>
  );
}

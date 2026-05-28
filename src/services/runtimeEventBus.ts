import type { AutopilotStage, ObservationSummary, SunoImportedAssetMetadata } from "../types.js";
import type { CommissionBrief, DailyVoiceDraft } from "../types.js";
import type { ChangeSetProposal } from "./freeformChangesetProposer.js";

export type RuntimeEvent =
  | { type: "autopilot_stage_changed"; songId?: string; from?: AutopilotStage; to: AutopilotStage; timestamp: number }
  | { type: "take_imported"; songId: string; paths: string[]; metadata: SunoImportedAssetMetadata[]; timestamp: number }
  | { type: "autopilot_state_changed"; enabled: boolean; paused: boolean; reason?: string; timestamp: number }
  | { type: "song_take_completed"; songId: string; selectedTakeId?: string; urls: string[]; observationSummary?: ObservationSummary; actor?: "manual_notify_retrigger"; timestamp: number }
  | { type: "prompt_pack_ready"; songId: string; title: string; lyricsExcerpt: string; mood: string; tempo: string; styleNotes: string; voiceTop?: string; timestamp: number }
  | { type: "prompt_pack_char_count"; songId: string; style: number; lyrics: number; title: number; styleZone: string; lyricsZone: string; titleZone: string; timestamp: number }
  | { type: "theme_generated"; theme: string; reason: string; timestamp: number }
  | { type: "suno_budget_low"; songId?: string; reason: string; limit: number; used: number; timestamp: number }
  | { type: "lyrics_generation_degraded"; songId: string; reason: string; timestamp: number }
  | { type: "suno_generate_retry"; songId: string; reason: string; retryCount: number; nextRetryAt?: string; timestamp: number }
  | { type: "suno_create_failed"; songId: string; reason: string; retryCount: number; timestamp: number }
  | { type: "suno_generate_failed"; songId: string; reason: string; retryCount: number; timestamp: number }
  | { type: "suno_hard_stop"; songId?: string; reason: string; timestamp: number }
  | { type: "take_select_pending"; songId: string; reason: string; timestamp: number }
  | { type: "take_selection_stalled"; songId: string; reason: string; timestamp: number }
  | { type: "take_select_low_score"; songId: string; bestTakeId: string; score: number; reason: string; timestamp: number }
  | { type: "asset_generation_stalled"; songId: string; reason: string; timestamp: number }
  | { type: "budget_exhausted"; reason: string; limit: number; used: number; timestamp: number }
  | { type: "bird_cooldown_triggered"; reason: string; cooldownUntil: string; timestamp: number }
  | { type: "distribution_change_detected"; songId: string; platform: "unitedMasters" | "spotify" | "appleMusic"; url: string; proposalId?: string; proposal?: ChangeSetProposal; timestamp: number }
  | { type: "planning_skeleton_incomplete"; songId: string; missing: string[]; proposal: ChangeSetProposal; timestamp: number }
  | { type: "song_songbook_written"; songId: string; timestamp: number }
  | { type: "song_publish_skipped"; songId: string; timestamp: number }
  | { type: "song_archived"; songId: string; selectedTakeId?: string; timestamp: number }
  | { type: "song_discarded"; songId: string; previousSelectedTakeId?: string; fromStatus?: string; reason?: string; timestamp: number }
  | { type: "producer_decision_reminder"; callbackId: string; action: string; label: string; effect: string; songId?: string; pendingHours: number; timestamp: number }
  | ({ type: "artist_pulse_drafted"; timestamp: number } & DailyVoiceDraft)
  | { type: "song_spawn_proposed"; brief: CommissionBrief; reason: string; candidateSongId: string; voiceTop?: string; observationSummary?: ObservationSummary; timestamp: number }
  | { type: "spawn_proposal_appended"; proposalId: string; pendingCount: number; timestamp: number }
  | { type: "spawn_proposal_queue_full"; proposalId?: string; limit: number; pendingCount: number; timestamp: number }
  | { type: "spawn_proposal_skip_queue_full"; limit: number; pendingCount: number; timestamp: number }
  | { type: "observation_collected"; topMotifMatch?: string; topScore?: number; entryCount: number; timestamp: number }
  | { type: "artist_presence"; trigger: "observation_high_score" | "producer_silent_after_take"; text: string; songId?: string; timestamp: number }
  | { type: "theme_starvation"; source: "observation_empty" | "motif_bucket_empty"; details?: string; songId?: string; timestamp: number }
  | { type: "error"; source: string; reason: string; songId?: string; timestamp: number };

export type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>;

const DEFAULT_DEDUP_MS = 5000;

export interface EmitWithDedupOptions {
  event: RuntimeEvent;
  dedupKey: string;
  dedupMs?: number;
  now?: number;
}

export class RuntimeEventBus {
  private readonly handlers = new Set<RuntimeEventHandler>();
  private readonly recentEvents: RuntimeEvent[] = [];
  private readonly dedupTimestamps = new Map<string, number>();

  subscribe(handler: RuntimeEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(event: RuntimeEvent): void {
    this.recentEvents.unshift(event);
    this.recentEvents.splice(50);
    for (const handler of this.handlers) {
      void Promise.resolve(handler(event)).catch((err) => {
        console.error(`[bus.emit] handler_failed type=${event.type} err=${(err as Error)?.message ?? err}`);
      });
    }
  }

  emitWithDedup(options: EmitWithDedupOptions): boolean {
    const dedupMs = options.dedupMs ?? DEFAULT_DEDUP_MS;
    const now = options.now ?? Date.now();
    const last = this.dedupTimestamps.get(options.dedupKey);
    if (typeof last === "number" && now - last < dedupMs) {
      return false;
    }
    this.dedupTimestamps.set(options.dedupKey, now);
    this.emit(options.event);
    return true;
  }

  listRecent(limit = 20): RuntimeEvent[] {
    return this.recentEvents.slice(0, Math.max(0, limit));
  }

  clearForTest(): void {
    this.handlers.clear();
    this.recentEvents.length = 0;
    this.dedupTimestamps.clear();
  }
}

const singleton = new RuntimeEventBus();

export function getRuntimeEventBus(): RuntimeEventBus {
  return singleton;
}

export function emitRuntimeEvent(event: RuntimeEvent): void {
  singleton.emit(event);
}

export function emitRuntimeEventWithDedup(options: EmitWithDedupOptions): boolean {
  return singleton.emitWithDedup(options);
}

import type { AutopilotStage, ObservationSummary, SunoImportedAssetMetadata } from "../types.js";
import type { CommissionBrief, DailyVoiceDraft } from "../types.js";
import type { ChangeSetProposal } from "./freeformChangesetProposer.js";

export type RuntimeEvent =
  | { type: "autopilot_stage_changed"; songId?: string; from?: AutopilotStage; to: AutopilotStage; timestamp: number }
  | { type: "take_imported"; songId: string; paths: string[]; metadata: SunoImportedAssetMetadata[]; timestamp: number }
  | { type: "autopilot_state_changed"; enabled: boolean; paused: boolean; reason?: string; timestamp: number }
  | { type: "song_take_completed"; songId: string; selectedTakeId?: string; urls: string[]; observationSummary?: ObservationSummary; timestamp: number }
  | { type: "theme_generated"; theme: string; reason: string; timestamp: number }
  | { type: "suno_budget_low"; songId?: string; reason: string; limit: number; used: number; timestamp: number }
  | { type: "lyrics_generation_degraded"; songId: string; reason: string; timestamp: number }
  | { type: "suno_generate_retry"; songId: string; reason: string; retryCount: number; nextRetryAt?: string; timestamp: number }
  | { type: "suno_generate_failed"; songId: string; reason: string; retryCount: number; timestamp: number }
  | { type: "take_select_pending"; songId: string; reason: string; timestamp: number }
  | { type: "take_select_low_score"; songId: string; bestTakeId: string; score: number; reason: string; timestamp: number }
  | { type: "budget_exhausted"; reason: string; limit: number; used: number; timestamp: number }
  | { type: "bird_cooldown_triggered"; reason: string; cooldownUntil: string; timestamp: number }
  | { type: "distribution_change_detected"; songId: string; platform: "unitedMasters" | "spotify" | "appleMusic"; url: string; proposalId?: string; proposal?: ChangeSetProposal; timestamp: number }
  | { type: "planning_skeleton_incomplete"; songId: string; missing: string[]; proposal: ChangeSetProposal; timestamp: number }
  | { type: "song_songbook_written"; songId: string; timestamp: number }
  | { type: "song_publish_skipped"; songId: string; timestamp: number }
  | ({ type: "artist_pulse_drafted"; timestamp: number } & DailyVoiceDraft)
  | { type: "song_spawn_proposed"; brief: CommissionBrief; reason: string; candidateSongId: string; timestamp: number }
  | { type: "error"; source: string; reason: string; songId?: string; timestamp: number };

export type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>;

export class RuntimeEventBus {
  private readonly handlers = new Set<RuntimeEventHandler>();
  private readonly recentEvents: RuntimeEvent[] = [];

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
      void Promise.resolve(handler(event)).catch(() => undefined);
    }
  }

  listRecent(limit = 20): RuntimeEvent[] {
    return this.recentEvents.slice(0, Math.max(0, limit));
  }

  clearForTest(): void {
    this.handlers.clear();
    this.recentEvents.length = 0;
  }
}

const singleton = new RuntimeEventBus();

export function getRuntimeEventBus(): RuntimeEventBus {
  return singleton;
}

export function emitRuntimeEvent(event: RuntimeEvent): void {
  singleton.emit(event);
}

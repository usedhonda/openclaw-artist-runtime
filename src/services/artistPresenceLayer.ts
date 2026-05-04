// Plan v10.9 Phase F: artist presence layer.
// Surfaces low-frequency presence messages so the artist feels alive, but only
// when there is concrete grounding (high-score observation, producer silence
// after take). Generic "最近どう?" pings are explicitly disallowed (Cdx note).
//
// This layer is intentionally event-driven and stateless beyond the cooldown
// store; the actual transport (Telegram) is injected via `notify`.

import type { RuntimeEvent, RuntimeEventBus } from "./runtimeEventBus.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import type { PersonaMotifBundle } from "./personaMotifExtractor.js";

export type PresenceTrigger = "observation_high_score" | "producer_silent_after_take";

export interface PresenceMessage {
  trigger: PresenceTrigger;
  text: string;
  songId?: string;
  motifMatch?: string;
}

export interface PresenceComposeInput {
  trigger: PresenceTrigger;
  motifs?: PersonaMotifBundle;
  topMotifMatch?: string;
  songId?: string;
}

export type PresenceComposer = (input: PresenceComposeInput) => string | undefined;

export interface PresenceCooldown {
  isOnCooldown(trigger: PresenceTrigger, now: number): boolean;
  markFired(trigger: PresenceTrigger, now: number): void;
}

export interface ArtistPresenceLayerOptions {
  bus: RuntimeEventBus;
  notify: (message: PresenceMessage) => Promise<void> | void;
  cooldown?: PresenceCooldown;
  silentAfterTakeMs?: number;
  observationScoreThreshold?: number;
  isProducerTyping?: () => boolean | Promise<boolean>;
  loadMotifs?: () => Promise<PersonaMotifBundle | undefined> | PersonaMotifBundle | undefined;
  compose?: PresenceComposer;
  now?: () => number;
  scheduler?: (callback: () => void, ms: number) => unknown;
  cancelScheduled?: (handle: unknown) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SILENT_AFTER_TAKE_MS = 4 * 60 * 60 * 1000;
const DEFAULT_OBSERVATION_THRESHOLD = 7;

export class InMemoryPresenceCooldown implements PresenceCooldown {
  private readonly last = new Map<PresenceTrigger, number>();
  private readonly windowMs: number;

  constructor(windowMs: number = DAY_MS) {
    this.windowMs = windowMs;
  }

  isOnCooldown(trigger: PresenceTrigger, now: number): boolean {
    const last = this.last.get(trigger);
    if (last === undefined) return false;
    return now - last < this.windowMs;
  }

  markFired(trigger: PresenceTrigger, now: number): void {
    this.last.set(trigger, now);
  }
}

function defaultCompose(input: PresenceComposeInput): string | undefined {
  const themes = input.motifs?.themes ?? [];
  const geo = input.motifs?.geographies ?? [];
  if (input.trigger === "observation_high_score") {
    if (input.topMotifMatch) {
      return `目に入った。${input.topMotifMatch}。`;
    }
    if (geo.length > 0 && themes.length > 0) {
      return `${geo[0]}の${themes[0]}、目に入った。`;
    }
    if (themes.length > 0) {
      return `${themes[0]}、引っかかった。`;
    }
    return undefined;
  }
  if (input.trigger === "producer_silent_after_take") {
    return "聴いてくれた?";
  }
  return undefined;
}

export interface ArtistPresenceLayerHandle {
  stop: () => void;
}

export function startArtistPresenceLayer(options: ArtistPresenceLayerOptions): ArtistPresenceLayerHandle {
  const cooldown = options.cooldown ?? new InMemoryPresenceCooldown();
  const silentAfterTakeMs = options.silentAfterTakeMs ?? DEFAULT_SILENT_AFTER_TAKE_MS;
  const observationThreshold = options.observationScoreThreshold ?? DEFAULT_OBSERVATION_THRESHOLD;
  const compose = options.compose ?? defaultCompose;
  const nowFn = options.now ?? (() => Date.now());
  const scheduler = options.scheduler ?? ((callback, ms) => setTimeout(callback, ms));
  const cancelScheduled = options.cancelScheduled ?? ((handle) => {
    if (handle && typeof handle === "object" && "ref" in handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    } else {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  });
  const pending = new Set<unknown>();

  const fire = async (
    trigger: PresenceTrigger,
    composeInput: Omit<PresenceComposeInput, "trigger" | "motifs">,
    extra: { songId?: string; motifMatch?: string } = {}
  ): Promise<void> => {
    const now = nowFn();
    if (cooldown.isOnCooldown(trigger, now)) return;
    if (await Promise.resolve(options.isProducerTyping?.())) return;
    const motifs = await Promise.resolve(options.loadMotifs?.());
    const text = compose({ trigger, motifs, ...composeInput });
    if (!text) return;
    cooldown.markFired(trigger, now);
    const message: PresenceMessage = { trigger, text, ...extra };
    emitRuntimeEvent({
      type: "artist_presence",
      trigger,
      text,
      ...(extra.songId ? { songId: extra.songId } : {}),
      timestamp: now
    });
    await options.notify(message);
  };

  const handler = (event: RuntimeEvent): void => {
    if (event.type === "song_take_completed") {
      const songId = event.songId;
      const handle = scheduler(() => {
        pending.delete(handle);
        void fire("producer_silent_after_take", {}, { songId });
      }, silentAfterTakeMs);
      pending.add(handle);
      return;
    }
    if (event.type === "observation_collected") {
      const score = event.topScore ?? 0;
      if (score < observationThreshold) return;
      void fire(
        "observation_high_score",
        { topMotifMatch: event.topMotifMatch },
        { motifMatch: event.topMotifMatch }
      );
    }
  };

  const unsubscribe = options.bus.subscribe(handler);

  return {
    stop: () => {
      unsubscribe();
      for (const handle of pending) cancelScheduled(handle);
      pending.clear();
    }
  };
}

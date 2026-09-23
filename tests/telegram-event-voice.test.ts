import { describe, expect, it } from "vitest";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";
import type { RuntimeEvent } from "../src/services/runtimeEventBus";

function topOf(text: string): string {
  return text.split("─────")[0].trim();
}

function expectVoiceHybrid(text: string): void {
  expect(text).toContain("─────");
  expect(topOf(text)).toMatch(/[ぁ-んァ-ヶ一-龠]/);
}

describe("Telegram event voice formatting", () => {
  it.each<RuntimeEvent>([
    { type: "theme_generated", theme: "再開発の街", reason: "観察と SOUL が重なった", timestamp: 1 },
    { type: "suno_budget_low", songId: "song-001", reason: "daily limit near", used: 3, limit: 4, timestamp: 1 },
    { type: "take_select_pending", songId: "song-001", reason: "waiting for import", timestamp: 1 },
    { type: "budget_exhausted", reason: "monthly exhausted", used: 50, limit: 50, timestamp: 1 },
    { type: "artist_presence", trigger: "observation_high_score", text: "プロデューサー、いま見えたものがある。", timestamp: 1 }
  ])("formats $type as voice top plus detail block", async (event) => {
    const text = await formatRuntimeEvent(event);

    expectVoiceHybrid(text);
  });
});

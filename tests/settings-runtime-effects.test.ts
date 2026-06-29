import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyConfigDefaults } from "../src/config/schema";
import { migrateConfig } from "../src/config/migrations";
import { buildLyricsDraftingPrompt } from "../src/services/lyricsDraftingPrompt";
import { parseLyricsLanguagePolicy } from "../src/services/lyricsLanguagePolicy";
import { evaluateSunoGenerationLimits } from "../src/services/sunoRuns";
import { updateSongState } from "../src/services/artistState";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";

function makeRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function appendRun(root: string, songId: string, createdAt: string, status = "accepted"): Promise<void> {
  await updateSongState(root, songId, { title: songId, status: "suno_running" });
  const path = join(root, "songs", songId, "suno", "runs.jsonl");
  await mkdir(join(root, "songs", songId, "suno"), { recursive: true });
  await writeFile(path, `${JSON.stringify({ runId: `run-${songId}`, status, createdAt })}\n`, "utf8");
}

describe("settings runtime effects", () => {
  it("enforces hard-stop safety settings even when input config disables them", () => {
    const config = applyConfigDefaults({
      music: {
        suno: {
          stopOnLoginChallenge: false,
          stopOnCaptcha: false,
          stopOnPaymentPrompt: false,
          promptLogging: "full"
        }
      },
      safety: {
        forbidCaptchaBypass: false,
        forbidCredentialLogging: false,
        requireApprovalForHighRisk: false
      }
    } as never);

    expect(config.music.suno.stopOnLoginChallenge).toBe(true);
    expect(config.music.suno.stopOnCaptcha).toBe(true);
    expect(config.music.suno.stopOnPaymentPrompt).toBe(true);
    expect(config.music.suno.promptLogging).toBe("full");
    expect(config.safety.forbidCaptchaBypass).toBe(true);
    expect(config.safety.forbidCredentialLogging).toBe(true);
    expect(config.safety.requireApprovalForHighRisk).toBe(true);

    const migrated = migrateConfig({
      music: { suno: { stopOnCaptcha: false, stopOnLoginChallenge: false, stopOnPaymentPrompt: false } },
      safety: { forbidCaptchaBypass: false, forbidCredentialLogging: false, requireApprovalForHighRisk: false }
    }) as ReturnType<typeof migrateConfig>;
    expect(migrated.music?.suno?.stopOnCaptcha).toBe(true);
    expect(migrated.safety?.requireApprovalForHighRisk).toBe(true);
  });

  it("carries artist language ratio into lyrics prompts and Suno YAML", () => {
    const policy = parseLyricsLanguagePolicy("lyrics language: 日本語80% / 英語20%");
    const prompt = buildLyricsDraftingPrompt({
      artistMd: "## Artist Core\nlyrics language: 日本語80% / 英語20%",
      currentState: "",
      briefText: "night terminal song",
      title: "Terminal Light",
      knowledgeDigest: "",
      languagePolicy: policy
    });
    const pack = createSunoPromptPack({
      songId: "song-language",
      songTitle: "Terminal Light",
      artistReason: "night terminal song",
      lyricsText: "[Verse]\nきみのかげを まつ\n[Chorus]\nnight light まだ ここに",
      artistSnapshot: "lyrics language: 日本語80% / 英語20%",
      currentStateSnapshot: ""
    });

    expect(policy.mode).toBe("bilingual");
    expect(prompt).toContain("Language policy:");
    expect(prompt).toContain("80% Japanese and 20% English");
    expect(pack.yamlLyrics).toContain("language: Japanese 80% / English 20%");
    expect(pack.yamlLyrics).toContain("about 80% Japanese and 20% English");
  });

  it("blocks Suno generation by daily, monthly, and cooldown settings", async () => {
    const now = new Date("2026-06-28T12:00:00.000Z");

    const dailyRoot = makeRoot("artist-runtime-suno-daily-");
    await appendRun(dailyRoot, "song-daily", "2026-06-28T10:00:00.000Z");
    const daily = await evaluateSunoGenerationLimits(dailyRoot, applyConfigDefaults({
      music: { suno: { maxGenerationsPerDay: 1, monthlyGenerationBudget: 10, minMinutesBetweenCreates: 1 } }
    }), now);
    expect(daily?.policyDecision).toBe("stop_daily_generation_limit");

    const monthlyRoot = makeRoot("artist-runtime-suno-monthly-");
    await appendRun(monthlyRoot, "song-monthly", "2026-06-10T10:00:00.000Z");
    const monthly = await evaluateSunoGenerationLimits(monthlyRoot, applyConfigDefaults({
      music: { suno: { maxGenerationsPerDay: 10, monthlyGenerationBudget: 1, minMinutesBetweenCreates: 1 } }
    }), now);
    expect(monthly?.policyDecision).toBe("stop_monthly_generation_budget");

    const cooldownRoot = makeRoot("artist-runtime-suno-cooldown-");
    await appendRun(cooldownRoot, "song-cooldown", "2026-06-28T11:50:00.000Z");
    const cooldown = await evaluateSunoGenerationLimits(cooldownRoot, applyConfigDefaults({
      music: { suno: { maxGenerationsPerDay: 10, monthlyGenerationBudget: 10, minMinutesBetweenCreates: 20 } }
    }), now);
    expect(cooldown?.policyDecision).toBe("stop_create_cooldown");

    const failedRoot = makeRoot("artist-runtime-suno-failed-run-");
    await appendRun(failedRoot, "song-failed", "2026-06-28T11:55:00.000Z", "failed");
    const failed = await evaluateSunoGenerationLimits(failedRoot, applyConfigDefaults({
      music: { suno: { maxGenerationsPerDay: 1, monthlyGenerationBudget: 1, minMinutesBetweenCreates: 20 } }
    }), now);
    expect(failed).toBeUndefined();
  });
});

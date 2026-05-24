import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callAiProviderMock } = vi.hoisted(() => ({
  callAiProviderMock: vi.fn()
}));

vi.mock("../src/services/aiProviderClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/aiProviderClient")>();
  return {
    ...actual,
    callAiProvider: callAiProviderMock
  };
});

import { composeVoiceTopOnly } from "../src/services/commandVoiceWrapper";
import { proposeSpawn } from "../src/services/songSpawnProposer";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-cascade-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: 若者、コピー機、夜の会社\nsound: low bass, nu-jazz\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "Producer: ゆずるさん\nfirst_person: 俺\nsentence_endings: だ。/な。/どう?\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "Emotional weather: cold\n", "utf8");
  await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");
  await writeFile(join(root, "observations", "2026-05-24.md"), [
    "- text: \"コピー機の夜に若者の疲れだけが光っていた\"",
    "  author: \"office_watcher\"",
    "  url: \"https://x.com/office_watcher/status/12345\"",
    "  postedAt: \"2026-05-24T00:00:00Z\"",
    "  motifMatch: \"若者/コピー機\"",
    "  motifScore: 9"
  ].join("\n"), "utf8");
  return root;
}

describe("spawn pitch observation cascade", () => {
  beforeEach(() => {
    callAiProviderMock.mockReset();
    callAiProviderMock.mockResolvedValue([
      "spawn: yes",
      "title: コピー機の夜",
      "brief: コピー機の夜に若者の疲れが残る。その白い光を曲の芯にする。",
      "lyricsTheme: コピー機の白い光を、夜の会社の孤独として切る。サビは短く、若者の疲れだけを一行で残す。",
      "mood: cold, office pressure",
      "tempo: 104 BPM",
      "duration: 2:40",
      "style: low bass, dry drums, empty-room vocal",
      "reason: ゆずるさん、コピー機の夜を切るやつ、今やりたい。",
      "sources:",
      "- kind:x url:https://x.com/office_watcher/status/12345 author:@office_watcher quote:コピー機の夜に若者の疲れだけが光っていた"
    ].join("\n"));
  });

  it("puts observation excerpts and motif rank into the pitch prompt, sharing the trigger with voiceTop", async () => {
    const root = await workspace();
    const proposal = await proposeSpawn(root, {
      aiReviewProvider: "openai-codex",
      now: new Date("2026-05-24T00:00:00.000Z")
    });
    const prompt = String(callAiProviderMock.mock.calls[0]?.[0] ?? "");
    const voiceTop = await composeVoiceTopOnly("propose", root, "propose", [], { runId: proposal?.candidateSongId });

    expect(proposal?.spawn).toBe(true);
    expect(prompt).toContain("## Observation Cascade");
    expect(prompt).toContain(`seed: ${proposal?.candidateSongId}`);
    expect(prompt).toContain("motifRank=9");
    expect(prompt).toContain("コピー機の夜");
    expect(prompt).toContain("若者/コピー機");
    expect(voiceTop).toMatch(/コピー機|若者/);
  });
});

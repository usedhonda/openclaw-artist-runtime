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

import { proposeSpawn } from "../src/services/songSpawnProposer";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-not-configured-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: 六本木の再開発、広告の空白、夜の街\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "mood: observational\n", "utf8");
  await writeFile(join(root, "observations", "2026-05-08.md"), "六本木の駅前で、古い看板だけが剥がされずに残っていた。\n", "utf8");
  await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");
  return root;
}

describe("song spawn proposer not-configured fallback", () => {
  beforeEach(() => {
    callAiProviderMock.mockReset();
    callAiProviderMock.mockResolvedValue("AI provider 'openai-codex' is not configured. No external model call was made.");
  });

  it("does not let AI provider error text become the spawned brief", async () => {
    const proposal = await proposeSpawn(await workspace(), {
      aiReviewProvider: "openai-codex",
      now: new Date("2026-05-08T00:00:00.000Z")
    });

    expect(proposal?.spawn).toBe(true);
    const values = [
      proposal?.brief.title,
      proposal?.brief.brief,
      proposal?.brief.mood,
      proposal?.brief.tempo,
      proposal?.brief.duration,
      proposal?.brief.styleNotes,
      proposal?.reason
    ].join("\n");
    expect(values).not.toMatch(/AI provider|not configured|No external model call/i);
    expect(proposal?.brief.title).toContain("六本木");
    expect(proposal?.brief.brief).toContain("古い看板");
    expect(proposal?.brief.mood).toBeTruthy();
    expect(proposal?.brief.tempo).toBeTruthy();
    expect(proposal?.brief.duration).toBeTruthy();
    expect(proposal?.brief.styleNotes).toBeTruthy();
  });
});

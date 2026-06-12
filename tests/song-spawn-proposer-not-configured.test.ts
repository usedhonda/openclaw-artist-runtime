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
  });

  // v10.67 flood guard: a provider fallback echo must not become a proposal at all.
  // The old behavior built a deterministic template brief instead, which flooded
  // Telegram with near-identical junk while the provider was unreachable
  // (2026-06-11: 19 proposals in 2h). Skipping the tick is the fix; a healthy
  // provider on a later tick produces the real proposal.
  it("skips the proposal entirely when the provider is not configured", async () => {
    callAiProviderMock.mockResolvedValue("AI provider 'openai-codex' is not configured. No external model call was made.");

    const proposal = await proposeSpawn(await workspace(), {
      aiReviewProvider: "openai-codex",
      now: new Date("2026-05-08T00:00:00.000Z")
    });

    expect(proposal).toBeNull();
  });

  it("skips the proposal when the provider call fails and echoes a mock fallback", async () => {
    callAiProviderMock.mockResolvedValue("Mock provider fallback (request failed): spawn prompt echo …");

    const proposal = await proposeSpawn(await workspace(), {
      aiReviewProvider: "openai-codex",
      now: new Date("2026-05-08T00:00:00.000Z")
    });

    expect(proposal).toBeNull();
  });
});

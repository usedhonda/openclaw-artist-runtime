import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState } from "../src/services/artistState";
import { writeAutopilotRunState } from "../src/services/autopilotService";
import { composeDraftBoxNextAction, formatDraftBoxNextActionSection } from "../src/services/draftBoxNextAction";
import { appendSpawnProposal, markSpawnProposalBuilding } from "../src/services/spawnProposalQueue";
import type { SpawnProposal } from "../src/types";

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "artist-runtime-draft-box-next-"));
  await ensureArtistWorkspace(root);
  return root;
}

function proposal(id: string, title: string, status: SpawnProposal["status"] = "draft"): SpawnProposal {
  return {
    proposalId: id,
    createdAt: "2026-06-01T00:00:00.000Z",
    status,
    title,
    voiceTop: `${title}で行く案がある。`,
    coreTheme: `${title}の違和感`,
    observationSources: [],
    cascadeTrace: {
      observationSources: [],
      artistVoice: `${title}で行く案がある。`,
      title,
      lyricsTheme: `${title}の違和感`,
      styleLayer: "dry male vocal, 142 BPM"
    }
  };
}

describe("draft box next action", () => {
  it("shows one clear action when drafts exist and nothing is building", async () => {
    const root = await workspace();
    await appendSpawnProposal(root, proposal("spawn_draft", "安全圏の芝"));
    await writeAutopilotRunState(root, {
      stage: "completed",
      paused: false,
      retryCount: 0,
      cycleCount: 1,
      updatedAt: "2026-06-01T00:00:00.000Z"
    });

    const summary = await composeDraftBoxNextAction(root);

    expect(summary.kind).toBe("draft_idle");
    expect(summary.draftCount).toBe(1);
    expect(summary.nextAction).toBe("次: 草稿箱から「作る」を押す。");
    expect(formatDraftBoxNextActionSection(summary)).toContain("草稿箱: draft 1件 / building 0件");
  });

  it("tells the producer to wait when one draft is building", async () => {
    const root = await workspace();
    await ensureSongState(root, "spawn_build", "夜の速度");
    await appendSpawnProposal(root, proposal("spawn_build", "夜の速度"));
    await markSpawnProposalBuilding(root, "spawn_build");
    await writeAutopilotRunState(root, {
      currentSongId: "spawn_build",
      stage: "suno_generation",
      paused: false,
      retryCount: 0,
      cycleCount: 1,
      updatedAt: "2026-06-01T00:00:00.000Z"
    });

    const summary = await composeDraftBoxNextAction(root);

    expect(summary.kind).toBe("building");
    expect(summary.currentLine).toContain("夜の速度");
    expect(summary.nextAction).toContain("完成通知を待つ");
  });

  it("surfaces Suno timeout as the next action instead of silence", async () => {
    const root = await workspace();
    await ensureSongState(root, "spawn_timeout", "ハンズ前、解散");
    await writeAutopilotRunState(root, {
      currentSongId: "spawn_timeout",
      stage: "suno_generation",
      paused: false,
      blockedReason: "suno_generate_retry:playwright_live_timeout",
      lastError: "playwright_live_timeout",
      retryCount: 1,
      cycleCount: 2,
      updatedAt: "2026-06-01T00:00:00.000Z"
    });

    const summary = await composeDraftBoxNextAction(root);

    expect(summary.kind).toBe("suno_trouble");
    expect(summary.currentLine).toContain("Suno 生成で詰まっている");
    expect(summary.nextAction).toContain("Suno 接続を整える");
  });
});

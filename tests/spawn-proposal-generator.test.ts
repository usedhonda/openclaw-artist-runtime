import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { appendSpawnProposal, clearSpawnProposalQueueCacheForTest } from "../src/services/spawnProposalQueue";
import { proposeSpawn } from "../src/services/songSpawnProposer";
import { readSongSpawnState } from "../src/services/songSpawnRateLimiter";
import type { SpawnProposal } from "../src/types";

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

const originalSpawn = process.env.OPENCLAW_SONG_SPAWN_ENABLED;

async function workspace(prefix = "artist-runtime-spawn-generator-"): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  await ensureArtistWorkspace(root);
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: コピー機、若者、夜の会社\nsound: low bass, nu-jazz\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "Producer: ゆずるさん\nsentence_endings: だ。/な。/どう?\n", "utf8");
  await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");
  await writeFile(join(root, "observations", "2026-05-28.md"), "コピー機の夜に若者の疲れだけが光っていた。\n", "utf8");
  return root;
}

function queuedProposal(id: string, title = `queue ${id}`, coreTheme = `theme ${id}`): SpawnProposal {
  return {
    proposalId: id,
    createdAt: `2026-05-28T00:00:0${id.at(-1) ?? "0"}.000Z`,
    status: "draft",
    title,
    voiceTop: "次の案を出している。",
    coreTheme,
    observationSources: [
      { kind: "x", label: "@office", quote: "コピー機の夜に若者の疲れだけが光っていた", url: "https://x.com/office/status/12345" }
    ],
    motifRank: 9,
    cascadeTrace: {
      observationSources: [
        { kind: "x", label: "@office", quote: "コピー機の夜に若者の疲れだけが光っていた", url: "https://x.com/office/status/12345" }
      ],
      artistVoice: "コピー機の夜を見る。",
      title,
      lyricsTheme: coreTheme,
      styleLayer: "low bass, dry drums"
    }
  };
}

function aiOutput(title: string, lyricsTheme: string): string {
  return [
    "spawn: yes",
    `title: ${title}`,
    `brief: ${lyricsTheme}`,
    `lyricsTheme: ${lyricsTheme}`,
    "mood: cold, office pressure",
    "tempo: 104 BPM",
    "duration: 2:40",
    "style: low bass, dry drums, empty-room male vocal",
    `reason: ゆずるさん、${title}を切るやつ、今やりたい。`,
    "sources:",
    "- kind:x url:https://x.com/office/status/12345 author:@office quote:コピー機の夜に若者の疲れだけが光っていた"
  ].join("\n");
}

describe("spawn proposal generator queue integration", () => {
  beforeEach(() => {
    callAiProviderMock.mockReset();
    clearSpawnProposalQueueCacheForTest();
    getRuntimeEventBus().clearForTest();
  });

  afterEach(() => {
    if (originalSpawn === undefined) {
      delete process.env.OPENCLAW_SONG_SPAWN_ENABLED;
    } else {
      process.env.OPENCLAW_SONG_SPAWN_ENABLED = originalSpawn;
    }
    vi.restoreAllMocks();
  });

  it("keeps generating draft ideas even when three drafts already exist", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    callAiProviderMock.mockResolvedValue(aiOutput("四つ目の草稿", "三つの草稿とは別角度で、コピー機の夜を切る。"));
    const root = await workspace();
    await appendSpawnProposal(root, queuedProposal("p1"));
    await appendSpawnProposal(root, queuedProposal("p2"));
    await appendSpawnProposal(root, queuedProposal("p3"));
    getRuntimeEventBus().clearForTest();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, aiReview: { provider: "openai-codex" }, autopilot: { enabled: true, dryRun: true }, songSpawn: { enabled: true } }
    });
    unsubscribe();

    expect(state.blockedReason).toBe("spawn_proposal_ready");
    expect(events.some((event) => event.type === "spawn_proposal_skip_queue_full")).toBe(false);
    expect(events.some((event) => event.type === "song_spawn_proposed")).toBe(true);
  });

  it("marks the spawn rate limiter when autopilot appends a draft proposal", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    callAiProviderMock.mockResolvedValue(aiOutput("夜のコピー機", "コピー機の夜を、若者の疲れとして切る。"));
    const root = await workspace();
    getRuntimeEventBus().clearForTest();

    await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, aiReview: { provider: "openai-codex" }, autopilot: { enabled: true, dryRun: true }, songSpawn: { enabled: true } }
    });

    await expect(readSongSpawnState(root)).resolves.toMatchObject({
      lastSpawnAt: expect.any(String)
    });
  });

  it("passes activeQueueContext into the AI prompt as a negative angle section", async () => {
    callAiProviderMock.mockResolvedValue(aiOutput("地下の余白", "地下の余白を、夜の会社から逃げる若者の歌にする。"));
    const root = await workspace();

    const proposal = await proposeSpawn(root, {
      aiReviewProvider: "openai-codex",
      now: new Date("2026-05-28T00:00:00.000Z"),
      activeQueueContext: [
        {
          title: "改札の朝",
          coreTheme: "始発の改札で、眠い街の沈黙を切る。",
          observationSources: [
            { kind: "news", label: "fixture news", quote: "始発の改札に人だけが増えていた", url: "https://example.com/news" }
          ],
          motifRank: 7
        }
      ]
    });
    const prompt = String(callAiProviderMock.mock.calls[0]?.[0] ?? "");

    expect(proposal?.brief.title).toBe("地下の余白");
    expect(prompt).toContain("## Already proposed (do not duplicate angle)");
    expect(prompt).toContain("- 改札の朝: 始発の改札で、眠い街の沈黙を切る。 motifRank=7");
  });

  it("rejects generated proposals whose theme overlaps an active queue entry", async () => {
    callAiProviderMock.mockResolvedValue(aiOutput("コピー機の夜", "コピー機の白い光を、若者の疲れとして切る。"));
    const root = await workspace();

    await expect(proposeSpawn(root, {
      aiReviewProvider: "openai-codex",
      now: new Date("2026-05-28T00:00:00.000Z"),
      activeQueueContext: [
        {
          title: "コピー機の夜",
          coreTheme: "コピー機の白い光を、若者の疲れとして切る。",
          observationSources: queuedProposal("p1").observationSources,
          motifRank: 9
        }
      ]
    })).resolves.toBeNull();
  });
});

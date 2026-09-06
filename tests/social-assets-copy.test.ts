import { mkdtempSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/aiProviderClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/aiProviderClient.js")>();
  return { ...actual, callAiProvider: vi.fn() };
});

import { callAiProvider } from "../src/services/aiProviderClient.js";
import { updateSongState } from "../src/services/artistState.js";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { prepareSocialAssets } from "../src/services/socialAssets.js";
import { createSongSkeleton } from "../src/repositories/songRepository.js";

const mockedCallAiProvider = vi.mocked(callAiProvider);

async function seedSong(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-social-copy-"));
  await ensureArtistWorkspace(root);
  await createSongSkeleton(root, "song-001");
  await updateSongState(root, "song-001", {
    status: "take_selected",
    title: "Hollow Takes All",
    selectedTakeId: "take-1",
    appendPublicLinks: ["https://suno.com/song/11111111-2222-3333-4444-555555555555"],
    reason: "Suno take URL ready; audio rendering pending"
  });
  return root;
}

const liveConfig = {
  aiReview: { provider: "openclaw" as const },
  distribution: { platforms: { x: { enabled: true } } }
};

describe("prepareSocialAssets X copy", () => {
  beforeEach(() => {
    mockedCallAiProvider.mockReset();
  });

  it("writes the artist-voice body plus the public take link, never internal state text", async () => {
    const root = await seedSong();
    mockedCallAiProvider.mockResolvedValue("「レジの裏の値段まで見えた夜の話。歌にしたら少しだけ静かになった。」 #新曲");

    await prepareSocialAssets({ workspaceRoot: root, songId: "song-001", config: liveConfig });

    const post = await readFile(join(root, "songs", "song-001", "social", "x-post.md"), "utf8");
    expect(post).toBe("レジの裏の値段まで見えた夜の話。歌にしたら少しだけ静かになった。\n\nhttps://suno.com/song/11111111-2222-3333-4444-555555555555\n");
    expect(post).not.toContain("Source take");
    expect(post).not.toContain("audio rendering pending");
    await expect(access(join(root, "songs", "song-001", "social", "x-post.prompt.md"))).resolves.toBeUndefined();
    expect(mockedCallAiProvider.mock.calls[0]?.[0]).toContain("Hollow Takes All");
  });

  it("fails closed on a placeholder provider response instead of writing template copy", async () => {
    const root = await seedSong();
    mockedCallAiProvider.mockResolvedValue("Mock provider fallback (native_runtime_empty_response): Producer task: ...");

    await expect(prepareSocialAssets({ workspaceRoot: root, songId: "song-001", config: liveConfig }))
      .rejects.toThrow("social_copy_ai_unavailable");

    await expect(access(join(root, "songs", "song-001", "social", "x-post.md"))).rejects.toThrow();
  });

  it("keeps the offline template when the AI review provider is mock", async () => {
    const root = await seedSong();

    await prepareSocialAssets({
      workspaceRoot: root,
      songId: "song-001",
      config: { aiReview: { provider: "mock" }, distribution: { platforms: { x: { enabled: true } } } }
    });

    const post = await readFile(join(root, "songs", "song-001", "social", "x-post.md"), "utf8");
    expect(post.startsWith("Hollow Takes All\n")).toBe(true);
    expect(mockedCallAiProvider).not.toHaveBeenCalled();
  });
});

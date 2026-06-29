import { mkdtempSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-song-create-"));
}

async function waitForSong(root: string): Promise<string[]> {
  await vi.waitFor(async () => {
    const entries = await readdir(join(root, "songs"));
    expect(entries.filter((name) => name.startsWith("song-")).length).toBeGreaterThan(0);
  }, { timeout: 30000 });
  return readdir(join(root, "songs"));
}

describe("telegram song create trigger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts runCycle from /song create even when status says disabled", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);

    const response = await routeTelegramCommand({
      text: "/song create 最新ニュースの違和感",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: root,
      autopilotStatus: { enabled: false, dryRun: true, stage: "idle", nextAction: "idle" }
    });

    expect(response.responseText).toContain("最新ニュース");
    expect(response.responseText).toContain("/status");
    expect(await waitForSong(root)).toContain("song-001");
  }, 30000);

  it("starts runCycle from natural language song requests", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);

    const response = await routeTelegramCommand({
      text: "曲作って X でこれこれな話題",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: root
    });

    expect(response.responseText).toContain("X でこれこれな話題");
    expect(response.responseText).toContain("/status");
    expect(await waitForSong(root)).toContain("song-001");
  });

  it("emits a Telegram-visible failure when manual song create cannot start", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    vi.spyOn(ArtistAutopilotService.prototype, "runCycle").mockRejectedValueOnce(new Error("ai_provider_not_configured"));
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const response = await routeTelegramCommand({
      text: "/song create 壊れた街の速い曲",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: root
    });

    expect(response.responseText).toContain("/status");
    await vi.waitFor(() => {
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          source: "telegram_manual_song_create",
          reason: "ai_provider_not_configured"
        })
      ]));
    });
    unsubscribe();
  });
});

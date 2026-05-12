import { mkdir } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { readAutopilotRunState } from "../src/services/autopilotService";
import { classifyTelegramFreeText, readTelegramInbox, routeTelegramCommand } from "../src/services/telegramCommandRouter";

const baseInput = {
  fromUserId: 123,
  chatId: 456
};

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-telegram-router-"));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("telegram command router", () => {
  it("routes /help to the command list", async () => {
    const result = await routeTelegramCommand({ ...baseInput, text: "/help" });

    expect(result.kind).toBe("help");
    expect(result.responseText).toContain("/status");
    expect(result.responseText).toContain("/pause");
    expect(result.responseText).toContain("/review");
    expect(result.shouldStoreFreeText).toBe(false);
  });

  it("routes /status to formatted autopilot status", async () => {
    const result = await routeTelegramCommand({
      ...baseInput,
      text: "/status",
      autopilotStatus: {
        enabled: true,
        dryRun: true,
        stage: "planning",
        nextAction: "decide_next_song",
        currentSongId: "song-001"
      }
    });

    expect(result.kind).toBe("status");
    expect(result.responseText).toContain("Autopilot: enabled (dry-run)");
    expect(result.responseText).toContain("Stage: planning");
    expect(result.shouldStoreFreeText).toBe(false);
  });

  it("lists recent songs", async () => {
    const root = makeRoot();
    await ensureSongState(root, "song-001", "Ash Road");
    await ensureSongState(root, "song-002", "Cold Relay");

    const result = await routeTelegramCommand({ ...baseInput, text: "/songs", workspaceRoot: root, dashboardBaseUrl: "http://127.0.0.1:8787" });

    expect(result.kind).toBe("songs");
    expect(result.responseText).toContain("song-001");
    expect(result.responseText).toContain("Cold Relay");
    expect(result.responseText).toContain("path: songs/song-001/");
    expect(result.responseText).toContain("http://127.0.0.1:8787/ui/#song=song-001");
  });

  it("routes /timeline to recent lifecycle rows with dashboard links", async () => {
    const root = makeRoot();
    await ensureSongState(root, "song-001", "Ash Road");
    await updateSongState(root, "song-001", { status: "suno_running", reason: "test" });
    await ensureSongState(root, "song-002", "Cold Relay");
    await updateSongState(root, "song-002", { status: "published", reason: "test" });

    const result = await routeTelegramCommand({ ...baseInput, text: "/timeline", workspaceRoot: root, dashboardBaseUrl: "http://127.0.0.1:8787" });

    expect(result.kind).toBe("timeline");
    expect(result.responseText).toContain("🎬 Timeline (recent 10 songs)");
    expect(result.responseText).toContain("▶ song-001 | suno_generation | \"Ash Road\"");
    expect(result.responseText).toContain("  song-002 | completed | \"Cold Relay\"");
    expect(result.responseText).toContain("path: songs/song-001/");
    expect(result.responseText).toContain("http://127.0.0.1:8787/ui/#song=song-001");
  });

  it("shows a song detail summary", async () => {
    const root = makeRoot();
    await writeSongBrief(root, "song-001", "# Brief\n\nA cold wire hymn.");
    await updateSongState(root, "song-001", {
      status: "take_selected",
      selectedTakeId: "take-a",
      reason: "test",
      lastImportOutcome: {
        runId: "run-1",
        urlCount: 1,
        pathCount: 1,
        paths: [join(root, "runtime", "suno", "run-1", "take-a.mp3")],
        at: new Date().toISOString()
      }
    });

    const result = await routeTelegramCommand({ ...baseInput, text: "/song song-001", workspaceRoot: root, dashboardBaseUrl: "http://127.0.0.1:8787" });

    expect(result.kind).toBe("song");
    expect(result.responseText).toContain("take-a");
    expect(result.responseText).toContain("Imported assets: 1");
    expect(result.responseText).toContain("A cold wire hymn");
    expect(result.responseText).toContain("brief path: songs/song-001/brief.md");
    expect(result.responseText).toContain("lyrics path: songs/song-001/LYRICS.md");
    expect(result.responseText).toContain("http://127.0.0.1:8787/ui/#song=song-001");
  });

  it("queues /regen as a dry-run inbox request", async () => {
    const root = makeRoot();
    const result = await routeTelegramCommand({ ...baseInput, text: "/regen song-001", workspaceRoot: root });
    const inbox = await readTelegramInbox(root);

    expect(result.kind).toBe("regen");
    expect(result.responseText).toContain("No Suno create was started");
    expect(inbox[0]).toMatchObject({ type: "regen_requested", songId: "song-001" });
  });

  it("routes setup to the conversational artist without writing persona files", async () => {
    const root = makeRoot();
    const result = await routeTelegramCommand({ ...baseInput, text: "/setup", workspaceRoot: root });

    expect(result.kind).toBe("setup");
    expect(result.responseText).not.toContain("I heard this:");
    expect(result.responseText.length).toBeGreaterThan(0);
    expect(result.shouldStoreFreeText).toBe(true);
  });

  it("does not revive the legacy setup wizard when the persona proposer flag is off", async () => {
    vi.stubEnv("OPENCLAW_PERSONA_PROPOSER", "off");
    const root = makeRoot();
    const result = await routeTelegramCommand({ ...baseInput, text: "/setup", workspaceRoot: root });

    expect(result.responseText).not.toContain("I heard this:");
    expect(result.responseText.length).toBeGreaterThan(0);
    expect(result.shouldStoreFreeText).toBe(true);
  });

  it("pauses and resumes autopilot through the control service", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });

    const paused = await routeTelegramCommand({ ...baseInput, text: "/pause", workspaceRoot: root });
    const pausedState = await readAutopilotRunState(root);
    const resumed = await routeTelegramCommand({ ...baseInput, text: "/resume", workspaceRoot: root });
    const resumedState = await readAutopilotRunState(root);

    expect(paused.kind).toBe("pause");
    expect(pausedState.paused).toBe(true);
    expect(pausedState.pausedReason).toBe("telegram:123");
    expect(resumed.kind).toBe("resume");
    expect(resumedState.paused).toBe(false);
  });

  it("returns a safe response for unknown commands", async () => {
    const result = await routeTelegramCommand({ ...baseInput, text: "/wat" });

    expect(result.kind).toBe("unknown");
    expect(result.responseText).toContain("Unknown command");
    expect(result.shouldStoreFreeText).toBe(false);
  });

  it("stages free-text for the local inbox path", async () => {
    const result = await routeTelegramCommand({ ...baseInput, text: "please make the next hook colder" });

    expect(result.kind).toBe("free_text");
    expect(result.responseText).toContain("local artist inbox");
    expect(result.shouldStoreFreeText).toBe(true);
  });

  it("classifies free-text command suggestions without forwarding to CC or Cdx", () => {
    expect(classifyTelegramFreeText("please pause")).toBe("pause");
    expect(classifyTelegramFreeText("resume the artist")).toBe("resume");
    expect(classifyTelegramFreeText("status?")).toBe("status");
    expect(classifyTelegramFreeText("make the hook colder")).toBe("artist_inbox");
  });
});

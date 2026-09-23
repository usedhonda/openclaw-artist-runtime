import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPromptLedgerResponse, buildSongDetailResponse } from "../../src/routes";

describe("route fallback telemetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs intentional song-detail fallback reasons without failing the response", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-route-fallback-detail-"));
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    const detail = await buildSongDetailResponse("song-missing", {
      artist: { workspaceRoot: root }
    });

    expect(detail.brief).toBe("");
    expect(detail.selectedTake).toBeUndefined();
    expect(detail.socialAssets).toEqual([]);
    const messages = debug.mock.calls.map((call) => String(call[0]));
    expect(messages.some((message) => message.includes("song_brief_missing"))).toBe(true);
    expect(messages.some((message) => message.includes("selected_take_missing"))).toBe(true);
    expect(messages.some((message) => message.includes("social_assets_missing"))).toBe(true);
  });

  it("keeps absent optional jsonl ledgers quiet", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-route-fallback-ledger-"));
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    const entries = await buildPromptLedgerResponse("song-missing", {
      artist: { workspaceRoot: root }
    });

    expect(entries).toEqual([]);
    expect(debug.mock.calls.map((call) => String(call[0])).some((message) => message.includes("jsonl_read_fallback"))).toBe(false);
  });

  it("logs parse fallback reasons for malformed prompt ledgers", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-route-fallback-ledger-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ledgerDir = join(root, "songs", "song-bad", "prompts");
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(join(ledgerDir, "prompt-ledger.jsonl"), "{bad-json}\n");

    const entries = await buildPromptLedgerResponse("song-bad", {
      artist: { workspaceRoot: root }
    });

    expect(entries).toEqual([]);
    expect(warn.mock.calls.map((call) => String(call[0])).some((message) => message.includes("jsonl_parse_fallback"))).toBe(true);
  });
});

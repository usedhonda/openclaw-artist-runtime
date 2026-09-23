import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildSongProposerPrompt,
  parseSongProposerResponse,
  proposeSongFields
} from "../src/services/songProposer";
import type { SongUpdateField } from "../src/types";

const allFields: SongUpdateField[] = [
  "status",
  "publicLinksSpotify",
  "publicLinksAppleMusic",
  "publicLinksYoutubeMusic",
  "publicLinksOther",
  "selectedTake",
  "notes",
  "nextAction"
];

const source = {
  songId: "where-it-played",
  songMd: "# Where It Played\n\nStatus: scheduled\nSelected take: take-2",
  briefMd: "# Brief\n\nA social satire track about where the song played.",
  songbookEntry: "- Where It Played | Status=scheduled | Spotify=TBD",
  currentState: "# CURRENT_STATE.md\n\nCurrent obsession: distribution ghosts."
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("song proposer", () => {
  it("returns deterministic default drafts for all mock-provider song fields", async () => {
    const result = await proposeSongFields({ fields: allFields, source: { ...source, roughInput: "rough song update" } });

    expect(result.provider).toBe("mock");
    expect(result.warnings).toEqual([]);
    expect(result.drafts).toHaveLength(8);
    expect(result.drafts.find((draft) => draft.field === "status")).toMatchObject({
      draft: "idea",
      status: "proposed"
    });
    expect(result.drafts.find((draft) => draft.field === "nextAction")).toMatchObject({
      draft: "Review with the producer before writing song files.",
      status: "proposed"
    });
  });

  it("skips only the song field that contains secret-like rough input", async () => {
    const result = await proposeSongFields({
      fields: ["status", "notes"],
      source: {
        ...source,
        roughInput: ["status: published", `notes: ${["TELEGRAM", "BOT", "TOKEN"].join("_")}=do-not-store`].join("\n")
      }
    });

    expect(result.warnings.join("\n")).toContain("notes");
    expect(result.drafts.find((draft) => draft.field === "status")).toMatchObject({
      status: "proposed",
      draft: "idea"
    });
    expect(result.drafts.find((draft) => draft.field === "notes")).toMatchObject({
      status: "skipped",
      draft: ""
    });
  });

  it("includes song context and rough input in the prompt", () => {
    const prompt = buildSongProposerPrompt({
      fields: ["status", "publicLinksSpotify"],
      source: {
        ...source,
        roughInput: "Where It Played is live on Spotify."
      }
    });

    expect(prompt).toContain("Song ID: where-it-played");
    expect(prompt).toContain("Requested fields: status, publicLinksSpotify");
    expect(prompt).toContain("Where It Played is live on Spotify.");
    expect(prompt).toContain("artist/SONGBOOK.md entry:");
    expect(prompt).toContain("songs/<id>/song.md:");
    expect(prompt).toContain("artist/CURRENT_STATE.md:");
  });

  it("parses provider responses with song field aliases and origin reasoning", () => {
    const drafts = parseSongProposerResponse(
      [
        "song status: published (origin: Spotify discography)",
        "spotify url: https://open.spotify.com/track/example (origin: public release page)",
        "selected take: take-2 (origin: song.md)",
        "todo: update SONGBOOK and notify producer (origin: operator note)"
      ].join("\n"),
      ["status", "publicLinksSpotify", "selectedTake", "nextAction"]
    );

    expect(drafts).toEqual([
      { field: "status", draft: "published", reasoning: "Spotify discography", status: "proposed" },
      {
        field: "publicLinksSpotify",
        draft: "https://open.spotify.com/track/example",
        reasoning: "public release page",
        status: "proposed"
      },
      { field: "selectedTake", draft: "take-2", reasoning: "song.md", status: "proposed" },
      {
        field: "nextAction",
        draft: "update SONGBOOK and notify producer",
        reasoning: "operator note",
        status: "proposed"
      }
    ]);
  });

  it("marks provider response fields skipped when they contain secret-like text", () => {
    const drafts = parseSongProposerResponse(
      `notes: ${["TELEGRAM", "BOT", "TOKEN"].join("_")}=do-not-store (origin: unsafe response)`,
      ["notes"]
    );

    expect(drafts[0]).toMatchObject({
      field: "notes",
      status: "skipped",
      reasoning: "unsafe response"
    });
  });

});

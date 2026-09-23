import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseFreeformChangeSetResponse,
  proposeFreeformChangeSet
} from "../src/services/freeformChangesetProposer";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-changeset-propose-"));
}

describe("freeform changeset proposer", () => {
  it("parses field lines with origin reasoning", () => {
    const fields = parseFreeformChangeSetResponse("obsessions: night trains (origin: conversation)", "persona");

    expect(fields).toEqual([{
      domain: "persona",
      targetFile: "ARTIST.md",
      field: "obsessions",
      proposedValue: "night trains",
      reasoning: "conversation",
      status: "proposed"
    }]);
  });

  it("guards secret-like input before proposing changes", async () => {
    const result = await proposeFreeformChangeSet({
      domain: "persona",
      root: makeRoot(),
      userMessage: "PASSWORD=do-not-store"
    });

    expect(result.fields).toEqual([]);
    expect(result.warnings.join("\n")).toContain("secret-like");
  });

  it("proposes persona and song domain changes through existing proposers", async () => {
    const root = makeRoot();
    const persona = await proposeFreeformChangeSet({
      domain: "persona",
      root,
      userMessage: "make the artist colder and more direct",
      artistMd: "Artist name: Ghost Relay",
      soulMd: "Conversation tone: direct"
    });
    const song = await proposeFreeformChangeSet({
      domain: "song",
      root,
      songId: "where-it-played",
      userMessage: "turn this into a release note",
      songMd: "# Where It Played",
      currentState: "ready"
    });

    expect(persona.fields.some((field) => field.domain === "persona" && field.targetFile === "ARTIST.md")).toBe(true);
    expect(song.fields.some((field) => field.domain === "song" && field.targetFile.includes("where-it-played"))).toBe(true);
  });
});

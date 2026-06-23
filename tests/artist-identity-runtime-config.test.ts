import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getArtistIdentity } from "../src/services/runtimeConfig";

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-identity-"));
  mkdirSync(join(root, "runtime"), { recursive: true });
  return root;
}

function writeConfig(root: string, identity: { displayName?: string; producerCallname?: string }): void {
  writeFileSync(join(root, "runtime", "config-overrides.json"), JSON.stringify({
    schemaVersion: 1,
    artist: {
      mode: "public_artist",
      identity
    }
  }, null, 2));
}

function writePersonaFiles(root: string): void {
  writeFileSync(join(root, "ARTIST.md"), [
    "# ARTIST.md",
    "",
    "<!-- artist-runtime:persona:core:start -->",
    "## Public Identity",
    "",
    "Artist name: Fallback Artist",
    "",
    "A public artist built from local observations.",
    "",
    "## Producer Relationship",
    "",
    "Producer steers, artist proposes.",
    "",
    "## Current Artist Core",
    "",
    "- Core obsessions:",
    "  - night infrastructure",
    "",
    "## Sound",
    "",
    "- dry drums",
    "",
    "## Lyrics",
    "",
    "- concrete images",
    "",
    "## Social Voice",
    "",
    "- plain",
    "",
    "## Suno Production Profile",
    "",
    "- male vocal",
    "<!-- artist-runtime:persona:core:end -->",
    ""
  ].join("\n"));
  writeFileSync(join(root, "SOUL.md"), [
    "# SOUL.md",
    "",
    "## Producer (relationship in music-making)",
    "",
    "### Producer call",
    "",
    "- producer_callname: Producer Fallback",
    ""
  ].join("\n"));
}

describe("getArtistIdentity", () => {
  it("prefers configured artist identity", async () => {
    const root = workspace();
    writePersonaFiles(root);
    writeConfig(root, { displayName: "Config Artist", producerCallname: "Config Producer" });

    await expect(getArtistIdentity(root)).resolves.toEqual({
      artistName: "Config Artist",
      producerCallname: "Config Producer"
    });
  });

  it("falls back to ARTIST.md and SOUL.md when config identity is empty", async () => {
    const root = workspace();
    writePersonaFiles(root);
    writeConfig(root, {});

    await expect(getArtistIdentity(root)).resolves.toEqual({
      artistName: "Fallback Artist",
      producerCallname: "Producer Fallback"
    });
  });

  it("returns safe defaults when config and persona files are empty", async () => {
    const root = workspace();

    await expect(getArtistIdentity(root)).resolves.toEqual({
      artistName: "Unnamed OpenClaw Artist",
      producerCallname: "producer"
    });
  });
});

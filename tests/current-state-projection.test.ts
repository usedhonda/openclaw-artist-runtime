import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readArtistMind } from "../src/services/artistState";
import { readArtistVoiceContext } from "../src/services/artistVoiceResponder";
import { readArtistSnapshots } from "../src/services/artistWorkspace";
import { ensureCurrentStateInitialized } from "../src/services/currentStateProjection";
import { readPersonaSetupStatus } from "../src/services/personaSetupDetector";

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "artist-runtime-current-state-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(
    join(root, "ARTIST.md"),
    ["# ARTIST.md", "", "## Artist Concept", "", "A public artist built from local observations."].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "SOUL.md"),
    ["# SOUL.md", "", "Conversation tone: direct", "Refusal style: refuse weak ideas plainly"].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "runtime", "persona-completed.json"),
    `${JSON.stringify({ completedAt: "2026-06-28T00:00:00.000Z", source: "web", version: 1 })}\n`,
    "utf8"
  );
  return root;
}

describe("current-state projection", () => {
  it("replaces blank CURRENT_STATE.md with a runtime-managed safe projection", async () => {
    const root = await workspace();
    await writeFile(join(root, "artist", "CURRENT_STATE.md"), "", "utf8");

    const result = await ensureCurrentStateInitialized(root);
    const physical = await readFile(join(root, "artist", "CURRENT_STATE.md"), "utf8");

    expect(result.replaced).toBe(true);
    expect(physical).toBe(result.text);
    expect(physical).toContain("Runtime-managed current artist state");
    expect(physical).not.toMatch(/\bTBD\b|Quiet\. Watching\./);
  });

  it("keeps stale template placeholders out of artist mind, voice context, and prompt-pack snapshots", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "artist", "CURRENT_STATE.md"),
      ["# CURRENT_STATE.md", "", "## Current Obsessions", "", "- TBD", "", "## Emotional Weather", "", "Quiet. Watching."].join("\n"),
      "utf8"
    );

    const [mind, voiceContext, snapshots] = await Promise.all([
      readArtistMind(root),
      readArtistVoiceContext(root),
      readArtistSnapshots(root)
    ]);

    expect(mind.currentState).not.toMatch(/\bTBD\b|Quiet\. Watching\./);
    expect(voiceContext.currentState).toBe(mind.currentState);
    expect(snapshots.currentStateSnapshot).toBe(mind.currentState);
  });

  it("does not mix producer notes into runtime-managed CURRENT_STATE.md", async () => {
    const root = await workspace();
    await writeFile(join(root, "artist", "CURRENT_STATE.md"), "", "utf8");
    await writeFile(join(root, "artist", "PRODUCER_NOTES.md"), "producer-only phrase: glass deadline\n", "utf8");

    const mind = await readArtistMind(root);

    expect(mind.currentState).not.toContain("glass deadline");
    expect(mind.currentState).toContain("Runtime-managed current artist state");
  });

  it("does not make CURRENT_STATE.md part of setup completion requirements", async () => {
    const root = await workspace();
    await writeFile(join(root, "artist", "CURRENT_STATE.md"), "", "utf8");

    const status = await readPersonaSetupStatus(root);

    expect(status.needsSetup).toBe(false);
    expect(status.reasons).toEqual([]);
  });
});

import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proposeSpawn } from "../src/services/songSpawnProposer";
import { parseVoiceFingerprint } from "../src/services/voiceFingerprintParser";
import { POPULATED_ARTIST_MD, POPULATED_SOUL_MD } from "./helpers/populatedArtistFixtures";

/**
 * Plan v10.11 Phase D-AB:
 * proposeSpawn().reason must be in the artist voice — Japanese only,
 * no English words, and matching SOUL.md voice fingerprint.
 * Replaces the old expectation that reason contained English "budget remains".
 */

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-vc-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });

  await writeFile(join(root, "SOUL.md"), POPULATED_SOUL_MD, "utf8");
  await writeFile(join(root, "ARTIST.md"), POPULATED_ARTIST_MD, "utf8");
  await writeFile(join(root, "IDENTITY.md"), "# IDENTITY.md\n\nConfigured test artist.\n", "utf8");
  await writeFile(join(root, "INNER.md"), "# INNER.md\n\nKeep observation concrete.\n", "utf8");
  await writeFile(join(root, "PRODUCER.md"), "# PRODUCER.md\n\nProducer steers; artist chooses.\n", "utf8");

  await writeFile(
    join(root, "observations", "2026-05-05.md"),
    "再開発で消えたライブハウスの跡地に、 同じ色の看板だけが増えた。 街の温度が一段だけ下がった。\n",
    "utf8"
  );
  await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");
  return root;
}

describe("spawn proposer voice-contract (Plan v10.11)", () => {
  it("mock spawn reason is Japanese, free of long English runs", async () => {
    const root = await workspace();
    const proposal = await proposeSpawn(root, {
      aiReviewProvider: "mock",
      now: new Date("2026-05-05T00:00:00.000Z")
    });

    expect(proposal).not.toBeNull();
    expect(proposal?.reason).toMatch(/[ぁ-ん一-龠]/);
    expect(proposal?.reason).not.toMatch(/\b[a-z]{4,}\b/);
  });

  it("reason is non-empty and short enough to read at a glance", async () => {
    const root = await workspace();
    const proposal = await proposeSpawn(root, {
      aiReviewProvider: "mock",
      now: new Date("2026-05-05T00:00:00.000Z")
    });

    expect(proposal?.reason.length).toBeGreaterThan(0);
    expect(proposal?.reason.length).toBeLessThan(200);
  });

  it("populated SOUL.md exposes producer_callname for the spawn voice", async () => {
    // Sanity check: if this fails, downstream voice anchoring is impossible.
    const fingerprint = parseVoiceFingerprint(POPULATED_SOUL_MD);
    expect(fingerprint.producerCallname).not.toBeNull();
    expect(fingerprint.firstPerson).not.toBeNull();
  });

  it("regenerates IDENTITY.md before building the spawn prompt context", async () => {
    const root = await workspace();
    await writeFile(join(root, "IDENTITY.md"), "# IDENTITY.md\n\nmanual stale identity\n", "utf8");

    await proposeSpawn(root, {
      aiReviewProvider: "mock",
      now: new Date("2026-05-05T00:00:00.000Z")
    });

    const identity = await readFile(join(root, "IDENTITY.md"), "utf8");
    const manifest = await readFile(join(root, "runtime", "persona-legacy", "manifest.jsonl"), "utf8");
    expect(identity).toContain("Derived identity card. Do not edit directly.");
    expect(identity).not.toContain("manual stale identity");
    expect(manifest).toContain("song_spawn_identity_projection_sync");
  });
});

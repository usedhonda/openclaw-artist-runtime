import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proposeSpawn } from "../src/services/songSpawnProposer";
import { parseVoiceFingerprint } from "../src/services/voiceFingerprintParser";

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

  const templateRoot = join(__dirname, "..", "workspace-template");
  const [soul, artist, identity, inner, producer] = await Promise.all([
    readFile(join(templateRoot, "SOUL.md"), "utf8"),
    readFile(join(templateRoot, "ARTIST.md"), "utf8"),
    readFile(join(templateRoot, "IDENTITY.md"), "utf8"),
    readFile(join(templateRoot, "INNER.md"), "utf8"),
    readFile(join(templateRoot, "PRODUCER.md"), "utf8")
  ]);

  await writeFile(join(root, "SOUL.md"), soul, "utf8");
  await writeFile(join(root, "ARTIST.md"), artist, "utf8");
  await writeFile(join(root, "IDENTITY.md"), identity, "utf8");
  await writeFile(join(root, "INNER.md"), inner, "utf8");
  await writeFile(join(root, "PRODUCER.md"), producer, "utf8");

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

  it("workspace-template SOUL.md exposes producer_callname for the spawn voice", async () => {
    // Sanity check: if this fails, downstream voice anchoring is impossible.
    const templateRoot = join(__dirname, "..", "workspace-template");
    const soul = await readFile(join(templateRoot, "SOUL.md"), "utf8");
    const fingerprint = parseVoiceFingerprint(soul);
    expect(fingerprint.producerCallname).not.toBeNull();
    expect(fingerprint.firstPerson).not.toBeNull();
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isVoiceFingerprintReady, parseVoiceFingerprint } from "../src/services/voiceFingerprintParser";

/**
 * Plan v10.10 Phase G: persona file integrity contract
 *
 * Both workspace-template/ (shipped to operators) and the live workspace
 * (when present) must hold a SOUL.md whose voice fingerprint is ready.
 * If a future contributor lets the persona regress to TBD, this contract
 * blocks the build before machinery starts emitting voice fingerprint
 * fail-closed errors at runtime.
 */

const TEMPLATE_ROOT = join(__dirname, "..", "workspace-template");
const LIVE_ROOT = join(__dirname, "..", ".local", "openclaw", "workspace");

describe("persona file integrity contract", () => {
  it("workspace-template/SOUL.md is voice-fingerprint ready", () => {
    const soul = readFileSync(join(TEMPLATE_ROOT, "SOUL.md"), "utf8");
    const bundle = parseVoiceFingerprint(soul);
    const readiness = isVoiceFingerprintReady(bundle);

    expect(readiness.ok).toBe(true);
    expect(readiness.missing).toEqual([]);
  });

  it("workspace-template carries the 5-file persona schema", () => {
    expect(existsSync(join(TEMPLATE_ROOT, "SOUL.md"))).toBe(true);
    expect(existsSync(join(TEMPLATE_ROOT, "ARTIST.md"))).toBe(true);
    expect(existsSync(join(TEMPLATE_ROOT, "IDENTITY.md"))).toBe(true);
    expect(existsSync(join(TEMPLATE_ROOT, "INNER.md"))).toBe(true);
    expect(existsSync(join(TEMPLATE_ROOT, "PRODUCER.md"))).toBe(true);
  });

  it("workspace-template/SOUL.md exposes producer call info and 10+ forbidden phrases", () => {
    const soul = readFileSync(join(TEMPLATE_ROOT, "SOUL.md"), "utf8");
    const bundle = parseVoiceFingerprint(soul);

    expect(bundle.producerCallname).not.toBeNull();
    expect(bundle.firstPerson).not.toBeNull();
    expect(bundle.forbiddenPhrases.length).toBeGreaterThanOrEqual(10);
    expect(bundle.signatureMoves.length).toBeGreaterThanOrEqual(5);
  });

  it("when the live workspace is populated, its SOUL.md must also be ready", () => {
    const livePath = join(LIVE_ROOT, "SOUL.md");
    if (!existsSync(livePath)) {
      // The live workspace is gitignored; this test is a no-op outside developer machines.
      expect(true).toBe(true);
      return;
    }
    const soul = readFileSync(livePath, "utf8");
    const bundle = parseVoiceFingerprint(soul);
    const readiness = isVoiceFingerprintReady(bundle);
    expect(readiness.ok).toBe(true);
    expect(readiness.missing).toEqual([]);
  });
});

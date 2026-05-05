import { describe, expect, it } from "vitest";
import { isVoiceFingerprintReady, parseVoiceFingerprint } from "../src/services/voiceFingerprintParser";
import { validateAgainstVoiceContract } from "../src/services/voiceContractValidator";

const TBD_SOUL = `# SOUL.md

_TBD_

## My Heart
TBD

## Core Truths
### 1. TBD
TBD

## Internal Tensions
TBD

## Boundaries
- TBD

**優先順位**: TBD

## What I'm Not
TBD

## The Vibe
TBD

### Signature Moves
- "TBD"

## 文体 variation rule

### forbidden_phrases
- "TBD"

### sentence_endings
- "TBD"

## Producer (relationship in music-making)
TBD

### Producer call
- producer_callname: TBD
- first_person: TBD
`;

describe("voice fingerprint fail-closed contract (Plan v10.10 Phase G)", () => {
  it("isVoiceFingerprintReady reports specific missing fields when SOUL.md is full of TBD", () => {
    const bundle = parseVoiceFingerprint(TBD_SOUL);
    const readiness = isVoiceFingerprintReady(bundle);

    expect(readiness.ok).toBe(false);
    expect(readiness.missing).toContain("manifesto");
    expect(readiness.missing).toContain("myHeart");
    expect(readiness.missing).toContain("producerCallname");
    expect(readiness.missing).toContain("firstPerson");
    expect(readiness.missing).toContain("forbiddenPhrases");
    expect(readiness.missing).toContain("sentenceEndings");
    expect(readiness.missing).toContain("signatureMoves");
  });

  it("isVoiceFingerprintReady is also fail-closed for empty SOUL.md", () => {
    const bundle = parseVoiceFingerprint("");
    const readiness = isVoiceFingerprintReady(bundle);

    expect(readiness.ok).toBe(false);
    expect(readiness.missing.length).toBeGreaterThan(5);
  });

  it("validator does not crash on empty fingerprint and returns ok when there are no rules", () => {
    const bundle = parseVoiceFingerprint("");
    const result = validateAgainstVoiceContract("any text without forbidden phrases", { fingerprint: bundle });
    // empty fingerprint means no rules to enforce, so validator stays permissive (fail-closed handled by readiness, not validator)
    expect(result.ok).toBe(true);
  });

  it("partial SOUL.md with only producer_callname stays not-ready", () => {
    const partial = `# SOUL.md

## Producer (relationship in music-making)

### Producer call
- producer_callname: ゆずるさん
- first_person: 俺
`;
    const bundle = parseVoiceFingerprint(partial);
    const readiness = isVoiceFingerprintReady(bundle);
    expect(readiness.ok).toBe(false);
    expect(readiness.missing).not.toContain("producerCallname");
    expect(readiness.missing).not.toContain("firstPerson");
    expect(readiness.missing).toContain("manifesto");
    expect(readiness.missing).toContain("signatureMoves");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isVoiceFingerprintReady,
  parseVoiceFingerprint,
  summarizeFingerprint
} from "../src/services/voiceFingerprintParser";

function loadTemplateSoul(): string {
  return readFileSync(join(__dirname, "..", "workspace-template", "SOUL.md"), "utf8");
}

describe("voiceFingerprintParser", () => {
  it("extracts the one-line manifesto from the italic header", () => {
    const bundle = parseVoiceFingerprint(loadTemplateSoul());
    expect(bundle.manifesto).not.toBeNull();
    expect(bundle.manifesto).toMatch(/used::honda/);
  });

  it("captures producer_callname and first_person from the Producer call subsection", () => {
    const bundle = parseVoiceFingerprint(loadTemplateSoul());
    expect(bundle.producerCallname).toBe("ゆずるさん");
    expect(bundle.firstPerson).toBe("俺");
  });

  it("collects forbidden_phrases as a deduplicated list", () => {
    const bundle = parseVoiceFingerprint(loadTemplateSoul());
    expect(bundle.forbiddenPhrases.length).toBeGreaterThanOrEqual(10);
    expect(bundle.forbiddenPhrases).toContain("了解しました");
    expect(bundle.forbiddenPhrases.some((p) => p.includes("ご確認ください"))).toBe(true);
  });

  it("collects sentence_endings and reaction_phrases", () => {
    const bundle = parseVoiceFingerprint(loadTemplateSoul());
    expect(bundle.sentenceEndings).toContain("。");
    expect(bundle.sentenceEndings).toContain("だろ。");
    expect(bundle.reactionPhrases).toContain("わかる");
    expect(bundle.reactionPhrases).toContain("刺さる");
  });

  it("captures signature moves with quote-stripping", () => {
    const bundle = parseVoiceFingerprint(loadTemplateSoul());
    expect(bundle.signatureMoves.length).toBeGreaterThanOrEqual(5);
    expect(bundle.signatureMoves[0]).not.toMatch(/^"/);
    expect(bundle.signatureMoves[0]).not.toMatch(/"$/);
  });

  it("extracts priority order from the Boundaries section", () => {
    const bundle = parseVoiceFingerprint(loadTemplateSoul());
    expect(bundle.priorityOrder).toEqual(["Boundaries", "真実性", "美学", "Vibe"]);
  });

  it("captures core truth headings (4 truths plus optional extras)", () => {
    const bundle = parseVoiceFingerprint(loadTemplateSoul());
    expect(bundle.coreTruths.length).toBeGreaterThanOrEqual(4);
    expect(bundle.coreTruths[0]).toMatch(/景色で切れ/);
  });

  it("preserves My Heart and Producer relationship as free text", () => {
    const bundle = parseVoiceFingerprint(loadTemplateSoul());
    expect(bundle.myHeart.length).toBeGreaterThan(80);
    expect(bundle.producerRelationship).toMatch(/ゆずるさん/);
  });

  it("declares ready when the template is fully populated", () => {
    const bundle = parseVoiceFingerprint(loadTemplateSoul());
    const readiness = isVoiceFingerprintReady(bundle);
    expect(readiness.ok).toBe(true);
    expect(readiness.missing).toEqual([]);
  });

  it("declares not ready when manifesto and producer_callname are TBD", () => {
    const tbdSoul = `# SOUL.md

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
    const bundle = parseVoiceFingerprint(tbdSoul);
    const readiness = isVoiceFingerprintReady(bundle);
    expect(readiness.ok).toBe(false);
    expect(readiness.missing).toContain("manifesto");
    expect(readiness.missing).toContain("producerCallname");
    expect(readiness.missing).toContain("firstPerson");
    expect(readiness.missing).toContain("forbiddenPhrases");
  });

  it("summarizes fingerprint for prompt embedding", () => {
    const bundle = parseVoiceFingerprint(loadTemplateSoul());
    const summary = summarizeFingerprint(bundle);
    expect(summary).toContain("producer_callname: ゆずるさん");
    expect(summary).toContain("first_person: 俺");
    expect(summary).toContain("sentence_endings:");
    expect(summary).toContain("forbidden (sample):");
    expect(summary).toContain("signature sample:");
  });
});

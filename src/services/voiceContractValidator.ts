/**
 * voiceContractValidator — Plan v10.10 Phase B/C 共有
 *
 * artist response (composer or AI 経由) が SOUL.md voice fingerprint に
 * 沿ってるか出力後検査する。
 *
 * 検査項目:
 * - forbidden_phrases が text に含まれてない (must)
 * - producer_callname drift (用途による、optional)
 * - sentence ending pattern が許可 set に含まれる (should)
 * - last N reply の語尾と連続使用してない (should)
 *
 * Phase G で contract test として強化される基盤。
 */

import type { VoiceFingerprintBundle } from "./voiceFingerprintParser.js";

export interface VoiceContractViolation {
  rule: "forbidden_phrase" | "sentence_ending" | "ending_repetition" | "producer_callname_drift";
  detail: string;
  matchedText?: string;
}

export interface VoiceContractValidationResult {
  ok: boolean;
  violations: VoiceContractViolation[];
}

export interface VoiceContractValidationOptions {
  fingerprint: VoiceFingerprintBundle;
  lastEndings?: string[];
  requiredCallname?: boolean;
}

const ENDING_TAIL_LENGTH = 8;

function lastNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : "";
}

function endsWithAny(line: string, candidates: string[]): string | null {
  for (const ending of candidates) {
    if (ending.length > 0 && line.endsWith(ending)) return ending;
  }
  return null;
}

function tailSlice(line: string): string {
  return line.slice(Math.max(0, line.length - ENDING_TAIL_LENGTH));
}

export function validateAgainstVoiceContract(
  responseText: string,
  options: VoiceContractValidationOptions
): VoiceContractValidationResult {
  const { fingerprint, lastEndings = [], requiredCallname = false } = options;
  const violations: VoiceContractViolation[] = [];

  for (const phrase of fingerprint.forbiddenPhrases) {
    if (!phrase) continue;
    if (responseText.includes(phrase)) {
      violations.push({
        rule: "forbidden_phrase",
        detail: `forbidden phrase appeared: "${phrase}"`,
        matchedText: phrase
      });
    }
  }

  if (requiredCallname && fingerprint.producerCallname) {
    if (!responseText.includes(fingerprint.producerCallname)) {
      violations.push({
        rule: "producer_callname_drift",
        detail: `producer callname "${fingerprint.producerCallname}" expected but missing`
      });
    }
  }

  if (fingerprint.sentenceEndings.length > 0) {
    const lastLine = lastNonEmptyLine(responseText);
    if (lastLine.length > 0) {
      const matched = endsWithAny(lastLine, fingerprint.sentenceEndings);
      if (!matched) {
        violations.push({
          rule: "sentence_ending",
          detail: `final line ending "${tailSlice(lastLine)}" not in allowed sentence_endings`,
          matchedText: tailSlice(lastLine)
        });
      } else if (lastEndings.length > 0) {
        const recent = lastEndings.slice(-5);
        if (recent.length === 5 && recent.every((e) => e === matched)) {
          violations.push({
            rule: "ending_repetition",
            detail: `ending "${matched}" repeated for 5+ consecutive replies`,
            matchedText: matched
          });
        }
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations
  };
}

export function detectEnding(responseText: string, fingerprint: VoiceFingerprintBundle): string | null {
  const lastLine = lastNonEmptyLine(responseText);
  if (!lastLine) return null;
  return endsWithAny(lastLine, fingerprint.sentenceEndings);
}

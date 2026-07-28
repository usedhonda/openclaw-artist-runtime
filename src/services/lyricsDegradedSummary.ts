// Turns a raw prompt-pack / lyrics validation failure string — which carries
// internal lint identifiers like "residual_kanji:逃:line_20" — into one plain-JA
// sentence for the producer: which class of problem, how many, and a couple of
// examples. It never emits the raw tokens or line numbers. The full validator
// dump stays in the ledger/log; only this summary is meant to reach Telegram.
const EXAMPLE_LIMIT = 3;

// Callers pass the same offending-token list twice (once in `reason`, once in
// `detail`), so dedupe on the full "<kind>:<token>:line_<n>" identity to avoid
// double-counting. Returns the surviving tokens in first-seen order.
function collectTokens(source: string, kind: string): string[] {
  const matches = source.matchAll(new RegExp(`${kind}:([^:;\\n]+):line_(\\d+)`, "g"));
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const match of matches) {
    const token = match[1].trim();
    if (!token) {
      continue;
    }
    const identity = `${token}:${match[2]}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    tokens.push(token);
  }
  return tokens;
}

function uniqueExamples(tokens: string[]): string {
  const seen: string[] = [];
  for (const token of tokens) {
    if (!seen.includes(token)) {
      seen.push(token);
    }
    if (seen.length >= EXAMPLE_LIMIT) {
      break;
    }
  }
  return seen.join(" / ");
}

export function summarizeLyricsDegradedReason(reason: string, detail?: string): string {
  const source = `${reason ?? ""} ${detail ?? ""}`;
  const parts: string[] = [];

  const kanji = collectTokens(source, "residual_kanji");
  if (kanji.length > 0) {
    const examples = uniqueExamples(kanji);
    parts.push(`歌詞の漢字${kanji.length}箇所をひらがなにできなかった${examples ? `（例: ${examples}）` : ""}`);
  }

  const numbers = collectTokens(source, "ascii_number");
  if (numbers.length > 0) {
    const examples = uniqueExamples(numbers);
    parts.push(`数字${numbers.length}箇所をひらがな読みにできなかった${examples ? `（例: ${examples}）` : ""}`);
  }

  if (parts.length === 0) {
    if (/lyrics_too_long_for_suno_box|YAML overflow|lyrics box limit/i.test(source)) {
      parts.push("歌詞がSunoの入力上限を超えた");
    } else if (/styleAndFeel.*(?:exceeds|cap)/i.test(source)) {
      parts.push("曲の雰囲気メモが規定の長さを超えた");
    } else if (/lyrics_too_short/i.test(source)) {
      parts.push("歌詞が予定の長さに届かなかった");
    } else if (/ai_provider_not_configured|provider fallback/i.test(source)) {
      parts.push("歌詞AIにつながらなかった（トークン失効か未設定の可能性）");
    } else {
      parts.push("歌詞の仕上げチェックで直せない点が残った");
    }
  }

  return parts.join("、");
}

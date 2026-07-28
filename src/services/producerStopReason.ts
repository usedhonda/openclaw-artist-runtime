// Maps a raw runtime/Suno failure string — which often carries internal tokens
// like "playwright_live_timeout" or "suno_worker_not_ready" — to one plain-JA
// clause for the producer. The full raw reason still lives in the ledger/log;
// only this summary is meant to reach Telegram. Unknown reasons fall back to a
// length-capped, identifier-scrubbed copy so nothing internal leaks verbatim.
const STOP_REASON_RULES: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /captcha/i, message: "captcha（人間確認）が出た" },
  { pattern: /(?:payment|credit|billing)/i, message: "Suno の支払い / credit 確認が必要" },
  { pattern: /(?:login|session|auth|reauth|expired|unauthor)/i, message: "Suno のログインが切れた" },
  { pattern: /(?:schema[_ -]?drift|selector|ui[_ -]?mismatch|dom)/i, message: "Suno の画面が想定と変わっている" },
  { pattern: /(?:not[_ -]?ready|not[_ -]?connected|disconnect|worker[_ -]?not)/i, message: "Suno にまだ接続できていない" },
  { pattern: /(?:timeout|timed[_ -]?out|deadline)/i, message: "時間切れ（Suno の応答が返ってこなかった）" },
  { pattern: /(?:quota|budget|limit|exhaust)/i, message: "利用上限に達した" },
  { pattern: /(?:no[_ -]?(?:imported[_ -]?)?takes?|no[_ -]?urls?|empty[_ -]?takes?)/i, message: "生成結果（take）が取得できなかった" },
  { pattern: /(?:asset|render|image|visual).*(?:fail|error|stall)/i, message: "素材（画像/クリップ）の生成に失敗した" },
  { pattern: /rate[_ -]?limit/i, message: "アクセスが混み合っている（rate limit）" }
];

function scrubInternalIdentifiers(value: string): string {
  return value
    // Drop lint identifiers like residual_kanji:逃:line_20 entirely.
    .replace(/\b(?:residual_kanji|ascii_number|english_fragment):[^\s;]+/gi, "")
    // Drop absolute paths.
    .replace(/\/[^\s;]+\/[^\s;]+/g, "")
    // Drop long hex/hash-like blobs.
    .replace(/\b[0-9a-f]{16,}\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s;：:]+|[\s;：:]+$/g, "")
    .trim();
}

export function summarizeStopReason(reason: string | undefined): string {
  const raw = (reason ?? "").trim();
  if (!raw) {
    return "原因は記録に残した";
  }
  const matched = STOP_REASON_RULES.find((rule) => rule.pattern.test(raw));
  if (matched) {
    return matched.message;
  }
  const scrubbed = scrubInternalIdentifiers(raw);
  if (!scrubbed) {
    return "原因は記録に残した";
  }
  const chars = Array.from(scrubbed);
  return chars.length > 100 ? `${chars.slice(0, 99).join("").trim()}…` : scrubbed;
}

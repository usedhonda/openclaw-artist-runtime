export interface LyricsLanguageWarning {
  token: string;
  line: number;
}

export function lintJapaneseLyricsEnglishFragments(lyrics: string): LyricsLanguageWarning[] {
  const warnings: LyricsLanguageWarning[] = [];
  const lines = lyrics.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) return;
    const matches = line.matchAll(/\b[A-Za-z]{4,}\b/g);
    for (const match of matches) {
      warnings.push({ token: match[0], line: index + 1 });
    }
  });
  return warnings;
}

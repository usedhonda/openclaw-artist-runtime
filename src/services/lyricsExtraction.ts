const markerPairs = [
  ["=== LYRICS START ===", "=== LYRICS END ==="],
  ["LYRICS START", "LYRICS END"]
] as const;

export function extractLyricsBody(yaml: string): string {
  for (const [startMarker, endMarker] of markerPairs) {
    const startIndex = yaml.indexOf(startMarker);
    if (startIndex === -1) {
      continue;
    }

    const bodyStart = startIndex + startMarker.length;
    const endIndex = yaml.indexOf(endMarker, bodyStart);
    if (endIndex === -1) {
      continue;
    }

    return yaml.slice(bodyStart, endIndex).trim();
  }

  return yaml;
}

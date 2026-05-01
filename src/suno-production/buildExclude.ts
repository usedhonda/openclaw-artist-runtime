export interface BuildExcludeInput {
  artistAvoid?: string[];
  genre?: string;
  voices?: string[];
  copyrightSourceNameDenylist?: string[];
}

export interface BuildExcludeResult {
  items: string[];
  text: string;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function containsSourceName(value: string, denylist: string[]): boolean {
  const lower = value.toLowerCase();
  return denylist.some((name) => {
    const normalized = normalize(name).toLowerCase();
    return normalized.length >= 3 && lower.includes(normalized);
  });
}

export function buildExclude(input: BuildExcludeInput = {}): BuildExcludeResult {
  const denylist = input.copyrightSourceNameDenylist ?? [];
  const genre = (input.genre ?? "").toLowerCase();
  const base = [
    ...(input.artistAvoid ?? []),
    genre.includes("rap") ? "opera vibrato" : undefined,
    genre.includes("jazz") ? "festival EDM drop" : undefined,
    genre.includes("edm") ? "acoustic campfire strum" : undefined,
    (input.voices ?? []).length > 0 ? "celebrity voice imitation" : "source-name imitation",
    "muddy master"
  ].filter((item): item is string => Boolean(item));
  const items = [...new Set(base.map(normalize))]
    .filter((item) => !containsSourceName(item, denylist))
    .slice(0, 5);
  const safeItems = items.length >= 2 ? items : [...items, "copyrighted artist cloning", "generic stock loop"].slice(0, 5);
  return {
    items: safeItems,
    text: safeItems.join(", ").slice(0, 200)
  };
}

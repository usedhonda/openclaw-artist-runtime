export type SunoImportedAssetView = {
  url: string;
  path: string;
  format: "mp3" | "m4a";
  title?: string;
  durationSec?: number;
};

type ImportedAssetsViewSource = {
  runId: string;
  paths?: string[];
  metadata?: SunoImportedAssetView[];
};

export function buildImportedAssetRows(outcome?: ImportedAssetsViewSource): SunoImportedAssetView[] {
  if (!outcome) {
    return [];
  }

  if (outcome.metadata?.length) {
    return outcome.metadata;
  }

  return (outcome.paths ?? []).map((path, index) => ({
    url: outcome.runId,
    path,
    format: path.toLowerCase().endsWith(".m4a") ? "m4a" : "mp3",
    title: `Imported asset ${index + 1}`
  }));
}

export function importedAssetsPlaceholder(outcome?: ImportedAssetsViewSource): string | null {
  return buildImportedAssetRows(outcome).length === 0 ? "No imported assets yet." : null;
}

export function filterImportedAssetsByUrlPrefix(rows: SunoImportedAssetView[], prefix: string): SunoImportedAssetView[] {
  const normalized = prefix.trim();
  if (!normalized) {
    return rows;
  }
  return rows.filter((row) => row.url.startsWith(normalized));
}

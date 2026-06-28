import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSoulPersonaBlock, soulPersonaBlockEnd, soulPersonaBlockStart } from "./soulFileBuilder.js";
import { extractManagedPersonaBlock } from "./personaFileBuilder.js";

export interface PersonaCanonicalCleanupResult {
  changed: boolean;
  archivedPaths: string[];
}

function utcStamp(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function canonicalSoulContents(existing: string): string {
  const existingBlock = extractManagedPersonaBlock(existing, soulPersonaBlockStart, soulPersonaBlockEnd);
  const block = existingBlock ?? buildSoulPersonaBlock({ conversationTone: "", refusalStyle: "" });
  return `# SOUL.md\n\n${block}\n`;
}

async function archiveLegacyPersonaFile(root: string, file: "SOUL.md", contents: string, reason: string): Promise<string> {
  const archiveRoot = join(root, "runtime", "persona-legacy");
  await mkdir(archiveRoot, { recursive: true });
  const archivePath = join(archiveRoot, `${utcStamp()}-${file}`);
  await writeFile(archivePath, contents.endsWith("\n") ? contents : `${contents}\n`, { encoding: "utf8", mode: 0o600 });
  await appendFile(
    join(archiveRoot, "manifest.jsonl"),
    `${JSON.stringify({ file, archivePath, reason, archivedAt: new Date().toISOString() })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return archivePath;
}

export async function cleanupCanonicalPersonaSources(root: string): Promise<PersonaCanonicalCleanupResult> {
  const soulPath = join(root, "SOUL.md");
  const soulContents = await readFile(soulPath, "utf8").catch(() => "");
  if (!soulContents.trim()) {
    return { changed: false, archivedPaths: [] };
  }

  const nextSoul = canonicalSoulContents(soulContents);
  if (soulContents.trim() === nextSoul.trim()) {
    return { changed: false, archivedPaths: [] };
  }

  const archivePath = await archiveLegacyPersonaFile(root, "SOUL.md", soulContents, "canonical_setup_source_cleanup");
  await writeFile(soulPath, nextSoul, "utf8");
  return { changed: true, archivedPaths: [archivePath] };
}

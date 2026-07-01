import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSoulPersonaBlock, soulPersonaBlockEnd, soulPersonaBlockStart } from "./soulFileBuilder.js";
import { artistPersonaBlockEnd, artistPersonaBlockStart, extractManagedPersonaBlock } from "./personaFileBuilder.js";
import { buildProducerPersonaBlock, producerPersonaBlockEnd, producerPersonaBlockStart } from "./producerFileBuilder.js";

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

function canonicalProducerContents(existing: string): string {
  const existingBlock = extractManagedPersonaBlock(existing, producerPersonaBlockStart, producerPersonaBlockEnd);
  const block = existingBlock ?? buildProducerPersonaBlock({ producerFacts: "" });
  return `# PRODUCER.md\n\n${block}\n`;
}

const staleArtistOwnerPatterns = [
  /^\s*artist\s*name\s*:/i,
  /^\s*artistName\s*:/i,
  /^\s*display\s*name\s*:/i,
  /^\s*producer\s*callname\s*:/i,
  /^\s*producer_callname\s*:/i,
  /^\s*-\s*(artist\s*name|artistName|display\s*name|producer\s*callname|producer_callname)\s*:/i
];

function collapseBlankLines(contents: string): string {
  return contents.replace(/\n{3,}/g, "\n\n").trimEnd();
}

function cleanArtistOwnerDriftOutsideManagedBlock(existing: string): string {
  const block = extractManagedPersonaBlock(existing, artistPersonaBlockStart, artistPersonaBlockEnd);
  if (!block) {
    return existing;
  }
  const blockStart = existing.indexOf(block);
  const blockEnd = blockStart + block.length;
  const cleanOutside = (segment: string) =>
    collapseBlankLines(segment
      .split("\n")
      .filter((line) => !staleArtistOwnerPatterns.some((pattern) => pattern.test(line)))
      .join("\n"));
  const before = cleanOutside(existing.slice(0, blockStart));
  const after = cleanOutside(existing.slice(blockEnd));
  return collapseBlankLines([before, block, after].filter((part) => part.trim()).join("\n\n")) + "\n";
}

async function archiveLegacyPersonaFile(root: string, file: "ARTIST.md" | "SOUL.md" | "PRODUCER.md", contents: string, reason: string): Promise<string> {
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
  const archivedPaths: string[] = [];
  const artistPath = join(root, "ARTIST.md");
  const artistContents = await readFile(artistPath, "utf8").catch(() => "");
  if (artistContents.trim()) {
    const nextArtist = cleanArtistOwnerDriftOutsideManagedBlock(artistContents);
    if (artistContents.trim() !== nextArtist.trim()) {
      archivedPaths.push(await archiveLegacyPersonaFile(root, "ARTIST.md", artistContents, "canonical_setup_source_cleanup"));
      await writeFile(artistPath, nextArtist, "utf8");
    }
  }

  const soulPath = join(root, "SOUL.md");
  const soulContents = await readFile(soulPath, "utf8").catch(() => "");
  if (soulContents.trim()) {
    const nextSoul = canonicalSoulContents(soulContents);
    if (soulContents.trim() !== nextSoul.trim()) {
      archivedPaths.push(await archiveLegacyPersonaFile(root, "SOUL.md", soulContents, "canonical_setup_source_cleanup"));
      await writeFile(soulPath, nextSoul, "utf8");
    }
  }

  const producerPath = join(root, "PRODUCER.md");
  const producerContents = await readFile(producerPath, "utf8").catch(() => "");
  if (producerContents.trim()) {
    const nextProducer = canonicalProducerContents(producerContents);
    if (producerContents.trim() !== nextProducer.trim()) {
      archivedPaths.push(await archiveLegacyPersonaFile(root, "PRODUCER.md", producerContents, "canonical_setup_source_cleanup"));
      await writeFile(producerPath, nextProducer, "utf8");
    }
  }

  return { changed: archivedPaths.length > 0, archivedPaths };
}

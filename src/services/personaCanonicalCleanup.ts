import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSoulPersonaBlock, soulPersonaBlockEnd, soulPersonaBlockStart } from "./soulFileBuilder.js";
import { extractManagedPersonaBlock } from "./personaFileBuilder.js";
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

async function archiveLegacyPersonaFile(root: string, file: "SOUL.md" | "PRODUCER.md", contents: string, reason: string): Promise<string> {
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

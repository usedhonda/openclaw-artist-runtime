import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertPersonaBlockSafe, extractManagedPersonaBlock } from "./personaFileBuilder.js";

export interface ProducerPersonaSummary {
  producerFacts: string;
}

export const producerPersonaBlockStart = "<!-- artist-runtime:persona:producer:start -->";
export const producerPersonaBlockEnd = "<!-- artist-runtime:persona:producer:end -->";

function producerPath(root: string): string {
  return join(root, "PRODUCER.md");
}

export function buildProducerPersonaBlock(summary: ProducerPersonaSummary): string {
  assertPersonaBlockSafe(summary.producerFacts);
  return [
    producerPersonaBlockStart,
    "## Producer Context",
    "",
    `Producer decision notes: ${summary.producerFacts.trim()}`,
    "",
    "Only keep producer preferences, boundaries, and decision context here. Do not store contact details, secrets, callnames, or artist voice.",
    producerPersonaBlockEnd
  ].join("\n");
}

export async function readProducerPersonaSummary(root: string): Promise<ProducerPersonaSummary> {
  const contents = await readFile(producerPath(root), "utf8").catch(() => "");
  return {
    producerFacts: contents.match(/^Producer decision notes:[ \t]*(.*)$/m)?.[1]?.trim() || ""
  };
}

export async function writeProducerPersona(root: string, summary: ProducerPersonaSummary): Promise<{ path: string; bytes: number }> {
  const path = producerPath(root);
  const block = buildProducerPersonaBlock(summary);
  const contents = await readFile(path, "utf8").catch(() => "");
  const existingBlock = extractManagedPersonaBlock(contents, producerPersonaBlockStart, producerPersonaBlockEnd);
  const nextContents = existingBlock
    ? contents.replace(existingBlock, block)
    : `# PRODUCER.md\n\n${block}\n`;
  await mkdir(root, { recursive: true });
  await writeFile(path, nextContents, "utf8");
  return { path, bytes: Buffer.byteLength(nextContents, "utf8") };
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertPersonaBlockSafe } from "./personaFileBuilder.js";

export type SnapshotPersonaLayer = "identity" | "producer" | "inner";
export type SnapshotPersonaFilename = "IDENTITY.md" | "PRODUCER.md" | "INNER.md";

export const snapshotPersonaFilenames: Record<SnapshotPersonaLayer, SnapshotPersonaFilename> = {
  identity: "IDENTITY.md",
  producer: "PRODUCER.md",
  inner: "INNER.md"
};

const snapshotPersonaMaxChars = 20_000;

function snapshotPersonaPath(root: string, filename: SnapshotPersonaFilename): string {
  return join(root, filename);
}

function normalizeSnapshotPersonaText(text: string): string {
  if (text.length > snapshotPersonaMaxChars) {
    throw new Error("snapshot_persona_too_long");
  }
  assertPersonaBlockSafe(text);
  return text.endsWith("\n") ? text : `${text}\n`;
}

export async function readSnapshotPersonaFile(root: string, filename: SnapshotPersonaFilename): Promise<string> {
  return readFile(snapshotPersonaPath(root, filename), "utf8").catch((error: unknown) => {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
}

export async function writeSnapshotPersonaFile(
  root: string,
  filename: SnapshotPersonaFilename,
  fullText: string
): Promise<{ path: string; bytes: number }> {
  if (filename !== "PRODUCER.md") {
    throw new Error(filename === "IDENTITY.md" ? "identity_projection_read_only" : "inner_projection_read_only");
  }
  const path = snapshotPersonaPath(root, filename);
  const normalized = normalizeSnapshotPersonaText(fullText);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, normalized, "utf8");
  return { path, bytes: Buffer.byteLength(normalized, "utf8") };
}

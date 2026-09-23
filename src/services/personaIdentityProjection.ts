import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtistRuntimeConfig } from "../types.js";
import { readArtistPersonaSummary, type ArtistPersonaSummary } from "./personaFileBuilder.js";
import { readSoulPersonaSummary, type SoulPersonaSummary } from "./soulFileBuilder.js";

export interface IdentityProjectionWriteResult {
  path: string;
  text: string;
  bytes: number;
  overwritten: boolean;
  archivedPath?: string;
}

const identityFilename = "IDENTITY.md";
const managedIdentityLine = "Derived identity card. Do not edit directly.";

function utcStamp(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function identityPath(root: string): string {
  return join(root, identityFilename);
}

function managedIdentityText(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function isManagedIdentityProjection(contents: string): boolean {
  return contents.includes(managedIdentityLine);
}

async function archiveLegacyIdentityProjection(root: string, contents: string, reason: string): Promise<string> {
  const archiveRoot = join(root, "runtime", "persona-legacy");
  await mkdir(archiveRoot, { recursive: true });
  const archivePath = join(archiveRoot, `${utcStamp()}-${identityFilename}`);
  await writeFile(archivePath, managedIdentityText(contents), { encoding: "utf8", mode: 0o600 });
  await appendFile(
    join(archiveRoot, "manifest.jsonl"),
    `${JSON.stringify({ file: identityFilename, archivePath, reason, archivedAt: new Date().toISOString() })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return archivePath;
}

export function buildDerivedIdentityProjection(
  config: ArtistRuntimeConfig,
  artist: ArtistPersonaSummary,
  soul: SoulPersonaSummary
): string {
  const displayName = config.artist.identity.displayName?.trim() || artist.artistName || "Unnamed OpenClaw Artist";
  const producerCallname = config.artist.identity.producerCallname?.trim() || "producer";
  return [
    "# IDENTITY.md",
    "",
    managedIdentityLine,
    "",
    `- Display name: ${displayName}`,
    `- Producer callname: ${producerCallname}`,
    `- Artist concept: ${artist.identityLine || "(not set)"}`,
    `- Speaking anchor: ${soul.conversationTone || "(not set)"}`,
    ""
  ].join("\n");
}

export async function readDerivedIdentityProjection(root: string, config: ArtistRuntimeConfig): Promise<string> {
  const [artist, soul] = await Promise.all([
    readArtistPersonaSummary(root),
    readSoulPersonaSummary(root)
  ]);
  return buildDerivedIdentityProjection(config, artist, soul);
}

export async function writeDerivedIdentityProjection(
  root: string,
  config: ArtistRuntimeConfig,
  reason = "identity_projection_refresh"
): Promise<IdentityProjectionWriteResult> {
  const path = identityPath(root);
  const text = await readDerivedIdentityProjection(root, config);
  const normalized = managedIdentityText(text);
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing.trim() === normalized.trim()) {
    return { path, text: normalized, bytes: Buffer.byteLength(normalized, "utf8"), overwritten: false };
  }

  const archivedPath = existing.trim() && !isManagedIdentityProjection(existing)
    ? await archiveLegacyIdentityProjection(root, existing, reason)
    : undefined;
  await mkdir(root, { recursive: true });
  await writeFile(path, normalized, "utf8");
  return {
    path,
    text: normalized,
    bytes: Buffer.byteLength(normalized, "utf8"),
    overwritten: true,
    archivedPath
  };
}

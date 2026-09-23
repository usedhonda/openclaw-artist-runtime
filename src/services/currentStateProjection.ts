import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const defaultCurrentStateProjection = [
  "# CURRENT_STATE.md",
  "",
  "Runtime-managed current artist state. Do not use this as a setup input.",
  "",
  "## Current Obsessions",
  "",
  "- Watching public signals until they become song material.",
  "",
  "## Current Work",
  "",
  "- No active song yet.",
  "",
  "## Emotional Weather",
  "",
  "Focused and observant.",
  "",
  "## Refusals This Week",
  "",
  "- No generic hype.",
  "- No direct imitation of named artists.",
  "- No public controversy unless explicitly part of the work.",
  ""
].join("\n");

const currentStateRelativePath = join("artist", "CURRENT_STATE.md");

function currentStatePath(root: string): string {
  return join(root, currentStateRelativePath);
}

function normalizeCurrentState(contents: string): string {
  return contents.endsWith("\n") ? contents : `${contents}\n`;
}

export function isPlaceholderCurrentState(contents: string): boolean {
  const trimmed = contents.trim();
  if (!trimmed) return true;
  if (/^\s*[-*]\s*TBD\s*$/im.test(contents)) return true;
  if (/^Quiet\.\s+Watching\.\s*$/im.test(contents)) return true;
  if (/未定|未記入|\btodo\b|\bfixme\b/i.test(contents)) return true;
  return false;
}

export async function ensureCurrentStateInitialized(root: string): Promise<{ path: string; text: string; replaced: boolean }> {
  const path = currentStatePath(root);
  const existing = await readFile(path, "utf8").catch(() => "");
  if (!isPlaceholderCurrentState(existing)) {
    return { path, text: normalizeCurrentState(existing), replaced: false };
  }
  const next = normalizeCurrentState(defaultCurrentStateProjection);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, next, "utf8");
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error.code === "EEXIST" || error.code === "ENOTDIR")) {
      return { path, text: next, replaced: true };
    }
    throw error;
  }
  return { path, text: next, replaced: true };
}

export async function readManagedCurrentState(root: string): Promise<string> {
  return (await ensureCurrentStateInitialized(root)).text;
}

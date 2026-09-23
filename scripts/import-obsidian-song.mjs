#!/usr/bin/env node
// Import a single song from an Obsidian-style vault into the runtime workspace.
//
// Usage:
//   node scripts/import-obsidian-song.mjs \
//     [--source <obsidian-music-root>] \
//     [--target <workspace-root>] \
//     [--song <slug>] \
//     [--song-id <id>] \
//     [--dry-run] [--force]

import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

function parseArgs(argv) {
  const opts = {
    source: process.env.OPENCLAW_OBSIDIAN_SOURCE || "~/obsidian-music-vault",
    target: process.env.OPENCLAW_LOCAL_WORKSPACE || join(REPO_ROOT, ".local/openclaw/workspace"),
    song: process.env.OPENCLAW_DEFAULT_SONG_SLUG || "my-song",
    songId: undefined,
    dryRun: false,
    force: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source") opts.source = argv[++i];
    else if (arg === "--target") opts.target = argv[++i];
    else if (arg === "--song") opts.song = argv[++i];
    else if (arg === "--song-id") opts.songId = argv[++i];
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: import-obsidian-song.mjs [--source <path>] [--target <path>] [--song <slug>] [--song-id <id>] [--dry-run] [--force]");
      process.exit(0);
    }
  }
  if (!opts.songId) opts.songId = opts.song;
  return opts;
}

export function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const body = raw.slice(match[0].length);
  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, valueRaw] = kv;
    let value = valueRaw.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (value.startsWith("\"") && value.endsWith("\"")) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

export function splitTopSections(body) {
  // Split by top-level `# Heading` boundaries (not `## ...`).
  const sections = new Map();
  const lines = body.split("\n");
  let currentTitle = "_preamble";
  let buffer = [];
  for (const line of lines) {
    const heading = line.match(/^#\s+(.+?)\s*$/);
    if (heading) {
      if (buffer.length > 0 || currentTitle !== "_preamble") {
        sections.set(currentTitle, buffer.join("\n").trim());
      }
      currentTitle = heading[1].replace(/\s*\([^)]*chars?\)$/i, "").trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length > 0 || !sections.has(currentTitle)) {
    sections.set(currentTitle, buffer.join("\n").trim());
  }
  return sections;
}

export function parseSlidersTable(text) {
  const rows = text
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.match(/^\|[-\s|]+\|$/) && !line.match(/^\|\s*Parameter/i));
  const sliders = {};
  for (const row of rows) {
    const cells = row.split("|").map((cell) => cell.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cells.length < 2) continue;
    const [name, valueRaw] = cells;
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) continue;
    const key = name
      .toLowerCase()
      .replace(/\s+(.)/g, (_, ch) => ch.toUpperCase());
    sliders[key] = value;
  }
  return sliders;
}

export function buildSongMd({ songId, title, status }) {
  const now = new Date().toISOString();
  return [
    `# ${title}`,
    "",
    "<!-- artist-runtime:song-state:start -->",
    `- Song ID: ${songId}`,
    `- Status: ${status}`,
    `- Created At: ${now}`,
    `- Updated At: ${now}`,
    `- Lyrics Version: 1`,
    `- Run Count: 0`,
    `- Selected Take: `,
    `- Public Links:`,
    `  - (none)`,
    `- Last Reason: imported from obsidian`,
    `- Last Import Outcome: `,
    "<!-- artist-runtime:song-state:end -->",
    "",
    `Status: imported`,
    ""
  ].join("\n");
}

export function buildBriefMd({ title, reference, styleSummary }) {
  return [
    `# Brief for ${title}`,
    "",
    "## Why this song exists",
    "",
    `Imported from Obsidian vault. Reference: ${reference || "(none)"}`,
    "",
    "## Direction",
    "",
    `- Reference: ${reference || "(none)"}`,
    `- Style summary: ${styleSummary || "(none)"}`,
    ""
  ].join("\n");
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readExistingSongStatus(songMdPath) {
  try {
    const text = await readFile(songMdPath, "utf8");
    const match = text.match(/^-\s*Status:\s*(\S+)/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function readIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function backupIfPresent(path, opts) {
  if (!(await fileExists(path))) return null;
  if (opts.force) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${path}.backup-${stamp}`;
  if (opts.dryRun) {
    console.log(`[dry-run] would back up ${path} -> ${backup}`);
    return backup;
  }
  await copyFile(path, backup);
  console.log(`backup: ${path} -> ${backup}`);
  return backup;
}

async function writeFileSafe(path, contents, opts) {
  if (opts.dryRun) {
    console.log(`[dry-run] would write ${path} (${contents.length} bytes)`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  console.log(`wrote ${path}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sourceSongDir = join(opts.source, "songs", opts.song);
  if (!(await fileExists(sourceSongDir))) {
    console.error(`source song not found: ${sourceSongDir}`);
    process.exit(1);
  }
  if (!(await fileExists(opts.target))) {
    console.error(`target workspace not found: ${opts.target}`);
    process.exit(1);
  }

  const lyricsRaw = await readFile(join(sourceSongDir, "lyrics.md"), "utf8");
  const styleRaw = await readFile(join(sourceSongDir, "style.md"), "utf8");
  const yamlSunoRaw = await readFile(join(sourceSongDir, "yaml-suno.md"), "utf8");
  const lyricsSunoRaw = await readIfExists(join(sourceSongDir, "lyrics-suno.md"));
  const referencesRaw = await readIfExists(join(sourceSongDir, "references.md"));

  const lyricsParsed = parseFrontmatter(lyricsRaw);
  const styleParsed = parseFrontmatter(styleRaw);
  const styleSections = splitTopSections(styleParsed.body);
  const styleBody = styleSections.get("Style") ?? "";
  const excludeBody = styleSections.get("Exclude Styles") ?? "";
  const slidersBody = styleSections.get("Sliders") ?? "";
  const sliders = parseSlidersTable(slidersBody);

  const title = (lyricsParsed.frontmatter.title || styleParsed.frontmatter.title || opts.song).toString();
  const reference = (styleParsed.frontmatter.reference || "").toString();
  const styleSummary = styleBody.split("\n").find((line) => line.trim().length > 0) ?? "";

  const songRoot = join(opts.target, "songs", opts.songId);
  const targets = {
    songMd: join(songRoot, "song.md"),
    briefMd: join(songRoot, "brief.md"),
    lyricsV1: join(songRoot, "lyrics", "lyrics.v1.md"),
    yamlSuno: join(songRoot, "lyrics", "yaml-suno.md"),
    lyricsSuno: join(songRoot, "lyrics", "lyrics-suno.md"),
    sunoStyle: join(songRoot, "suno", "style.md"),
    sunoExclude: join(songRoot, "suno", "exclude.md"),
    sunoSliders: join(songRoot, "suno", "sliders.json"),
    references: join(songRoot, "references.md")
  };

  const songMdExists = await fileExists(targets.songMd);

  for (const [key, path] of Object.entries(targets)) {
    if (key === "songMd" && songMdExists) continue;
    await backupIfPresent(path, opts);
  }

  if (songMdExists) {
    console.log(`skip: ${targets.songMd} (existing workspace state preserved — status, public_links, last_reason, run_count, body kept intact)`);
  } else {
    await writeFileSafe(targets.songMd, buildSongMd({ songId: opts.songId, title, status: "lyrics" }), opts);
  }
  await writeFileSafe(targets.briefMd, buildBriefMd({ title, reference, styleSummary }), opts);
  await writeFileSafe(targets.lyricsV1, `${lyricsParsed.body.trim()}\n`, opts);
  await writeFileSafe(targets.yamlSuno, yamlSunoRaw, opts);
  if (lyricsSunoRaw) {
    const { body: lyricsSunoBody } = parseFrontmatter(lyricsSunoRaw);
    await writeFileSafe(targets.lyricsSuno, `${lyricsSunoBody.trim()}\n`, opts);
  }
  await writeFileSafe(targets.sunoStyle, `${styleBody.trim()}\n`, opts);
  await writeFileSafe(targets.sunoExclude, `${excludeBody.trim()}\n`, opts);
  await writeFileSafe(targets.sunoSliders, `${JSON.stringify(sliders, null, 2)}\n`, opts);
  if (referencesRaw) {
    const { body: refsBody } = parseFrontmatter(referencesRaw);
    await writeFileSafe(targets.references, `${refsBody.trim()}\n`, opts);
  }

  console.log(`done. song-id=${opts.songId} title=${title}`);
}

const isDirectInvocation = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "");
if (isDirectInvocation) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}

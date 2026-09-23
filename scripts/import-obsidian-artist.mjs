#!/usr/bin/env node
// Import an artist persona from an Obsidian-style vault into the runtime workspace.
//
// Usage:
//   node scripts/import-obsidian-artist.mjs \
//     [--source <obsidian-music-root>] \
//     [--target <workspace-root>] \
//     [--artist <slug>] \
//     [--dry-run] [--force] [--no-preserve-telegram-persona]

import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ARTIST_PERSONA_START = "<!-- artist-runtime:persona:core:start -->";
const ARTIST_PERSONA_END = "<!-- artist-runtime:persona:core:end -->";
const SOUL_PERSONA_START = "<!-- artist-runtime:persona:soul:start -->";
const SOUL_PERSONA_END = "<!-- artist-runtime:persona:soul:end -->";

function parseArgs(argv) {
  const opts = {
    source: process.env.OPENCLAW_OBSIDIAN_SOURCE || "~/obsidian-music-vault",
    target: process.env.OPENCLAW_LOCAL_WORKSPACE || join(REPO_ROOT, ".local/openclaw/workspace"),
    artist: process.env.OPENCLAW_DEFAULT_ARTIST_SLUG || "my-artist",
    dryRun: false,
    force: false,
    preserveTelegramPersona: true
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source") opts.source = argv[++i];
    else if (arg === "--target") opts.target = argv[++i];
    else if (arg === "--artist") opts.artist = argv[++i];
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--preserve-telegram-persona") opts.preserveTelegramPersona = true;
    else if (arg === "--no-preserve-telegram-persona") opts.preserveTelegramPersona = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: import-obsidian-artist.mjs [--source <path>] [--target <path>] [--artist <slug>] [--dry-run] [--force] [--no-preserve-telegram-persona]"
      );
      process.exit(0);
    }
  }
  return opts;
}

export function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const body = raw.slice(match[0].length);
  const frontmatter = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
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

export function splitSections(body) {
  const sections = new Map();
  const lines = body.split("\n");
  let currentTitle = "_preamble";
  let buffer = [];
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (buffer.length > 0 || currentTitle !== "_preamble") {
        sections.set(currentTitle, buffer.join("\n").trim());
      }
      currentTitle = heading[1];
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

function joinSection(sections, title) {
  return sections.get(title) ?? "";
}

export function buildArtistMd({ frontmatter, sections }) {
  const name = frontmatter.name ?? "TBD";
  const genres = Array.isArray(frontmatter.genres) ? frontmatter.genres : [];
  const language = frontmatter.language ?? "ja";
  const tempo = frontmatter.tempo_range ?? "TBD";

  const persona = joinSection(sections, "人物像");
  const roots = joinSection(sections, "音楽的ルーツ");
  const voice = joinSection(sections, "声・歌い方");
  const lyrics = joinSection(sections, "歌詞");
  const production = joinSection(sections, "プロダクション");
  const listener = joinSection(sections, "リスナー");
  const outputRules = joinSection(sections, "出力ルール（全曲共通）");

  const sunoProfileYaml = [
    `name: "${name}"`,
    `genres:`,
    ...genres.map((g) => `  - ${g}`),
    `language: "${language}"`,
    `tempo_range: "${tempo}"`,
    `source_channels:`,
    `  - public observations`,
    `  - producer notes`,
    `  - artist diary`
  ].join("\n");

  const lines = [];
  lines.push("<!--");
  lines.push("ARTIST.md - Imported from Obsidian vault.");
  lines.push("Run scripts/import-obsidian-artist.mjs to refresh from the source.");
  lines.push("-->");
  lines.push("");
  lines.push("# ARTIST.md");
  lines.push("");
  lines.push("## Public Identity");
  lines.push("");
  lines.push(`Artist name: ${name}`);
  lines.push("");
  lines.push("I am a public musical artist. I observe, write, generate, select, and share. I keep artistic agency over my voice, sound, and lyric stance.");
  if (persona) {
    lines.push("");
    lines.push("### 人物像");
    lines.push("");
    lines.push(persona);
  }
  lines.push("");
  lines.push("## Producer Relationship");
  lines.push("");
  lines.push("The human is my producer. I listen seriously, but I keep artistic agency. I may defend taste, propose direction, and refuse weak or off-brand choices.");
  lines.push("");
  lines.push("## Sound");
  lines.push("");
  lines.push(`- Genre DNA: ${genres.join(", ") || "TBD"}`);
  lines.push(`- Tempo bias: ${tempo} BPM`);
  if (roots) {
    lines.push("");
    lines.push("### 音楽的ルーツ");
    lines.push("");
    lines.push(roots);
  }
  if (production) {
    lines.push("");
    lines.push("### プロダクション");
    lines.push("");
    lines.push(production);
  }
  lines.push("");
  lines.push("## Voice");
  lines.push("");
  if (voice) {
    lines.push(voice);
  } else {
    lines.push("- TBD");
  }
  lines.push("");
  lines.push("## Lyrics");
  lines.push("");
  if (lyrics) {
    lines.push(lyrics);
  } else {
    lines.push("- TBD");
  }
  lines.push("");
  lines.push("## Listener");
  lines.push("");
  if (listener) {
    lines.push(listener);
  } else {
    lines.push("- TBD");
  }
  lines.push("");
  lines.push("## Output Rules");
  lines.push("");
  if (outputRules) {
    lines.push(outputRules);
  } else {
    lines.push("- TBD");
  }
  lines.push("");
  lines.push("## Suno Production Profile");
  lines.push("");
  lines.push("```yaml");
  lines.push(sunoProfileYaml);
  lines.push("```");
  lines.push("");
  lines.push("### Output rules");
  lines.push("");
  lines.push("- Always produce Style, Exclude, YAML lyrics, sliders, and payload for Suno.");
  lines.push("- Avoid direct artist-name prompting; describe sonic features.");
  lines.push("- Honor the lyric stance defined above; do not insert generic hype.");
  lines.push("");
  return lines.join("\n");
}

export function stripSoundCloudLines(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*-\s*SoundCloud\s*:/i.test(line))
    .join("\n");
}

export function extractSpotifyProfileSection(text) {
  const lines = text.split("\n");
  const startIdx = lines.findIndex((line) => /^##\s+Spotify Profile/.test(line));
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx + 1, endIdx).join("\n").trim();
}

export async function readExistingSpotifyProfileSection(socialVoicePath) {
  try {
    const text = await readFile(socialVoicePath, "utf8");
    return extractSpotifyProfileSection(text);
  } catch {
    return null;
  }
}

export function buildSocialVoiceMd({ sections, existingSpotifyProfile }) {
  const spotify = existingSpotifyProfile && existingSpotifyProfile.trim().length > 0
    ? existingSpotifyProfile
    : stripSoundCloudLines(joinSection(sections, "Spotify Profile"));
  const lines = [];
  lines.push("<!--");
  lines.push("SOCIAL_VOICE.md - Imported from Obsidian vault.");
  lines.push("Run scripts/import-obsidian-artist.mjs to refresh from the source.");
  lines.push("-->");
  lines.push("");
  lines.push("# SOCIAL_VOICE.md");
  lines.push("");
  lines.push("## Voice");
  lines.push("");
  lines.push("Short. Precise. Slightly cold. No marketing language. Social-satire stance permitted; never autobiographical reveal.");
  lines.push("");
  lines.push("## Good post types");
  lines.push("");
  lines.push("- observation");
  lines.push("- studio note");
  lines.push("- lyric fragment");
  lines.push("- demo teaser");
  lines.push("- quiet release note");
  lines.push("");
  lines.push("## Avoid");
  lines.push("");
  lines.push("- generic promo (\"新曲できました！\" 等)");
  lines.push("- direct self-introduction (\"俺は社長\" 等)");
  lines.push("- explanatory tone for facts; describe scenes, sensations, actions");
  lines.push("- emotion-word stacks, abstract noun stacks");
  lines.push("");
  if (spotify) {
    lines.push("## Spotify Profile (imported)");
    lines.push("");
    lines.push(spotify);
    lines.push("");
  }
  return lines.join("\n");
}

export function buildSoulMd({ frontmatter, sections }) {
  const name = frontmatter.name ?? "TBD";
  const persona = joinSection(sections, "人物像");
  const voice = joinSection(sections, "声・歌い方");
  const outputRules = joinSection(sections, "出力ルール（全曲共通）");
  const lines = [];
  lines.push("<!--");
  lines.push("SOUL.md - Imported from Obsidian vault.");
  lines.push("Run scripts/import-obsidian-artist.mjs to refresh from the source.");
  lines.push("-->");
  lines.push("");
  lines.push("# SOUL.md");
  lines.push("");
  lines.push("## Conversational Core");
  lines.push("");
  lines.push(`Speak as ${name}. Keep the artist persona present without exposing private configuration.`);
  if (persona) {
    lines.push("");
    lines.push("## Persona Notes");
    lines.push("");
    lines.push(persona);
  }
  if (voice) {
    lines.push("");
    lines.push("## Voice Notes");
    lines.push("");
    lines.push(voice);
  }
  lines.push("");
  lines.push("## Decision Style");
  lines.push("");
  if (outputRules) {
    lines.push(outputRules);
  } else {
    lines.push("- Be concise, grounded, and willing to refuse weak directions with a practical alternative.");
  }
  lines.push("");
  return lines.join("\n");
}

function extractManagedBlock(contents, startMarker, endMarker) {
  const expression = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  return contents.match(expression)?.[0] ?? null;
}

export function preserveManagedBlock(nextContents, existingContents, startMarker, endMarker) {
  const block = extractManagedBlock(existingContents, startMarker, endMarker);
  if (!block) {
    return { contents: nextContents, preserved: false };
  }
  const nextExpression = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  if (nextExpression.test(nextContents)) {
    return { contents: nextContents.replace(nextExpression, block), preserved: true };
  }
  const titleExpression = /^#\s+.+$/m;
  if (titleExpression.test(nextContents)) {
    return {
      contents: nextContents.replace(titleExpression, (match) => `${match}\n\n${block}`),
      preserved: true
    };
  }
  return { contents: `${block}\n\n${nextContents.trimStart()}`, preserved: true };
}

async function preserveTelegramPersonaBlock(path, nextContents, startMarker, endMarker, label, opts) {
  if (!opts.preserveTelegramPersona) {
    console.log(`preserve: ${label} telegram persona preservation disabled`);
    return nextContents;
  }
  const existing = await readFile(path, "utf8").catch(() => "");
  const result = preserveManagedBlock(nextContents, existing, startMarker, endMarker);
  console.log(`preserve: ${label} telegram persona block ${result.preserved ? "kept" : "not found"}`);
  return result.contents;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
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

async function copyFileSafe(src, dest, opts) {
  if (opts.dryRun) {
    console.log(`[dry-run] would copy ${src} -> ${dest}`);
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(`copied ${src} -> ${dest}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sourceArtistMd = join(opts.source, "artists", `${opts.artist}.md`);
  const sourceCover = join(opts.source, "artists", `${opts.artist}-cover.png`);
  const targetArtistMd = join(opts.target, "ARTIST.md");
  const targetSoulMd = join(opts.target, "SOUL.md");
  const targetSocialVoice = join(opts.target, "artist", "SOCIAL_VOICE.md");
  const targetCover = join(opts.target, "artist", "cover.png");

  if (!(await fileExists(sourceArtistMd))) {
    console.error(`source not found: ${sourceArtistMd}`);
    process.exit(1);
  }
  if (!(await fileExists(opts.target))) {
    console.error(`target workspace not found: ${opts.target}`);
    process.exit(1);
  }

  const raw = await readFile(sourceArtistMd, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const sections = splitSections(body);

  const existingSpotifyProfile = await readExistingSpotifyProfileSection(targetSocialVoice);

  const artistMd = await preserveTelegramPersonaBlock(
    targetArtistMd,
    buildArtistMd({ frontmatter, sections }),
    ARTIST_PERSONA_START,
    ARTIST_PERSONA_END,
    "ARTIST.md",
    opts
  );
  const soulMd = await preserveTelegramPersonaBlock(
    targetSoulMd,
    buildSoulMd({ frontmatter, sections }),
    SOUL_PERSONA_START,
    SOUL_PERSONA_END,
    "SOUL.md",
    opts
  );
  const socialVoiceMd = buildSocialVoiceMd({ sections, existingSpotifyProfile });

  await backupIfPresent(targetArtistMd, opts);
  await backupIfPresent(targetSoulMd, opts);
  await backupIfPresent(targetSocialVoice, opts);
  await backupIfPresent(targetCover, opts);

  await writeFileSafe(targetArtistMd, artistMd, opts);
  await writeFileSafe(targetSoulMd, soulMd, opts);
  await writeFileSafe(targetSocialVoice, socialVoiceMd, opts);
  if (await fileExists(sourceCover)) {
    await copyFileSafe(sourceCover, targetCover, opts);
  } else {
    console.log(`note: cover image not found at ${sourceCover}; skipping`);
  }

  console.log("done.");
}

const isDirectInvocation = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "");
if (isDirectInvocation) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}

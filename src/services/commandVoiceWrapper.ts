import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { composeArtistFallback, type UserIntent } from "./artistVoiceComposer.js";
import { extractPersonaMotifs, type PersonaMotifBundle } from "./personaMotifExtractor.js";
import { parseVoiceFingerprint } from "./voiceFingerprintParser.js";
import { secretLikePattern } from "./personaMigrator.js";

export type CommandVoiceKind = "help" | "status" | "songs" | "song" | "observations" | "error" | "ack" | "propose";

export interface CommandVoiceInput {
  kind: CommandVoiceKind;
  info: string;
  workspaceRoot?: string;
  userMessage?: string;
  lastEndings?: string[];
}

const separator = "─────";

const fallbackTop: Record<CommandVoiceKind, string> = {
  help: "使える合図だけ置く。細かい表は下に分ける。",
  status: "いまの動き、短く見る。",
  songs: "最近の曲、並べる。",
  song: "その曲の中身、下に出す。",
  observations: "見てきたものを置く。",
  error: "止まった。ここは無理に進めない。",
  ack: "聞いた。",
  propose: "次の曲、こんな感じで切るやつ、どう?"
};

const commandTheme: Record<CommandVoiceKind, string> = {
  help: "使える合図",
  status: "いまの状態",
  songs: "最近の曲",
  song: "その曲",
  observations: "観察",
  error: "止まったところ",
  ack: "受け取ったこと",
  propose: "次の曲の提案"
};

const unsafeTopPattern = /(https?:\/\/|(?:^|\b)(?:song|take|run)-[A-Za-z0-9_-]+|\b[A-Fa-f0-9]{8,}\b|\b\d{4,}\b)/;

function emptyMotifs(kind: CommandVoiceKind): PersonaMotifBundle {
  return {
    themes: [commandTheme[kind]],
    vocabulary: [],
    geographies: [],
    sound: [],
    avoid: ["業務連絡"],
    raw: ""
  };
}

async function readVoiceFiles(root: string | undefined): Promise<{ artistMd: string; soulMd: string; currentState: string }> {
  if (!root) return { artistMd: "", soulMd: "", currentState: "" };
  const [artistMd, soulMd, currentState] = await Promise.all([
    readFile(join(root, "ARTIST.md"), "utf8").catch(() => ""),
    readFile(join(root, "SOUL.md"), "utf8").catch(() => ""),
    readFile(join(root, "artist", "CURRENT_STATE.md"), "utf8").catch(() => "")
  ]);
  return { artistMd, soulMd, currentState };
}

function sanitizeTop(top: string, kind: CommandVoiceKind): string {
  const firstLines = top.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2).join("\n");
  if (!firstLines || unsafeTopPattern.test(firstLines) || secretLikePattern.test(firstLines)) {
    return fallbackTop[kind];
  }
  return firstLines;
}

function intentFor(kind: CommandVoiceKind): UserIntent {
  return kind === "ack" ? "ack" : kind === "propose" ? "propose" : "report";
}

export async function composeVoiceTopOnly(kind: CommandVoiceKind, root?: string, userMessage?: string, lastEndings: string[] = []): Promise<string> {
  return composeCommandVoiceTop({ kind, info: "", workspaceRoot: root, userMessage, lastEndings });
}

async function composeCommandVoiceTop(input: CommandVoiceInput): Promise<string> {
  const { artistMd, soulMd, currentState } = await readVoiceFiles(input.workspaceRoot);
  const motifs = extractPersonaMotifs([artistMd, soulMd].join("\n"));
  const text = composeArtistFallback({
    userMessage: input.userMessage ?? input.kind,
    motifs: motifs.themes.length + motifs.geographies.length + motifs.vocabulary.length > 0 ? motifs : emptyMotifs(input.kind),
    currentMood: currentState.match(/Emotional weather:\s*(.+)/i)?.[1]?.trim(),
    userIntent: intentFor(input.kind),
    voiceFingerprint: soulMd ? parseVoiceFingerprint(soulMd) : undefined,
    lastEndings: input.lastEndings ?? []
  });
  return sanitizeTop(text, input.kind);
}

export async function wrapCommandVoice(input: CommandVoiceInput): Promise<string> {
  const top = await composeCommandVoiceTop(input);
  return [top, "", separator, "info", input.info].join("\n");
}

export function isUnsafeCommandVoiceTopForTest(text: string): boolean {
  return unsafeTopPattern.test(text) || secretLikePattern.test(text);
}

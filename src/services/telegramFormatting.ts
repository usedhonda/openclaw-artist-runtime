import type { CascadeTrace } from "../types.js";
import { formatCascadeTrace } from "./cascadeTrace.js";

export const TELEGRAM_SECTION_DIVIDER = "─────";
export const TELEGRAM_MESSAGE_SAFE_LIMIT = 3900;

export function formatTelegramCascadeTrace(trace: CascadeTrace): string {
  return formatCascadeTrace(trace);
}

export function formatTelegramUrlList(urls: string[]): string {
  return urls.length
    ? urls.map((url, index) => `${index + 1}. ${url}`).join("\n")
    : "(URL なし)";
}

export function joinTelegramDetailSection(top: string, detail: string): string {
  return [top, "", TELEGRAM_SECTION_DIVIDER, detail].join("\n");
}

export function appendTelegramSection(body: string, content: string): string {
  return `${body}\n\n${TELEGRAM_SECTION_DIVIDER}\n${content}`;
}

export function stripTelegramHtmlComments(text: string): string {
  if (!text.includes("<!--")) return text;
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncatePlain(text: string | undefined, max: number): string {
  const clean = (text ?? "").replace(/<\/?[A-Za-z][^>\n]{0,64}>/g, "").replace(/\s+/g, " ").trim();
  if (max <= 0) return "";
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  return `${chars.slice(0, Math.max(0, max - 1)).join("").trim()}…`;
}

export function compactLines(lines: Array<string | undefined | null | false>, maxTotal: number): string {
  const joined = lines
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const chars = Array.from(joined);
  if (chars.length <= maxTotal) return joined;
  return `${chars.slice(0, Math.max(0, maxTotal - 1)).join("").trim()}…`;
}

function hardSplitParagraph(paragraph: string, max: number): string[] {
  const chars = Array.from(paragraph);
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += max) {
    chunks.push(chars.slice(index, index + max).join("").trim());
  }
  return chunks.filter(Boolean);
}

export function splitTelegramText(text: string, max = TELEGRAM_MESSAGE_SAFE_LIMIT): string[] {
  const clean = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [""];
  if (Array.from(clean).length <= max) return [clean];

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of clean.split(/\n{2,}/)) {
    const block = paragraph.trim();
    if (!block) continue;
    if (Array.from(block).length > max) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...hardSplitParagraph(block, max));
      continue;
    }
    const next = current ? `${current}\n\n${block}` : block;
    if (Array.from(next).length <= max) {
      current = next;
    } else {
      if (current) chunks.push(current);
      current = block;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [clean];
}

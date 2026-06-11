import type { CascadeTrace } from "../types.js";
import { formatCascadeTrace } from "./cascadeTrace.js";

export const TELEGRAM_SECTION_DIVIDER = "─────";

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

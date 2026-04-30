import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page } from "playwright";

export interface SunoFailureSnapshot {
  screenshotPath?: string;
  htmlPath?: string;
  url?: string;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function resolveSunoFailureLogsDir(workspaceRoot: string): string {
  return workspaceRoot.endsWith("/workspace")
    ? join(dirname(workspaceRoot), "logs")
    : join(workspaceRoot, "logs");
}

export async function captureSunoFailure(
  page: Page,
  opts: { logsDir: string; reason: string; songId?: string; runId?: string }
): Promise<SunoFailureSnapshot> {
  try {
    await mkdir(opts.logsDir, { recursive: true });
    const parts = ["suno-failure", timestamp(), slug(opts.reason), opts.songId ? slug(opts.songId) : undefined, opts.runId ? slug(opts.runId) : undefined]
      .filter(Boolean);
    const prefix = join(opts.logsDir, parts.join("-"));
    const screenshotPath = `${prefix}.png`;
    const htmlPath = `${prefix}.html`;
    const urlPath = `${prefix}.url.txt`;
    const url = page.url();
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await writeFile(htmlPath, await page.content(), "utf8");
    await writeFile(urlPath, `${url}\n`, "utf8");
    return { screenshotPath, htmlPath, url };
  } catch (error) {
    console.warn(`[artist-runtime] Suno failure snapshot skipped: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

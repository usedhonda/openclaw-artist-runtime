import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page } from "playwright";
import { sanitizeSunoDiagnosticText, sanitizeSunoDiagnosticUrl } from "./sunoDiagnosticSafety.js";

export interface SunoFailureSnapshot {
  screenshotPath?: string;
  diagnosticsPath?: string;
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
    const diagnosticsPath = `${prefix}.diagnostics.json`;
    const urlPath = `${prefix}.url.txt`;
    const url = sanitizeSunoDiagnosticUrl(page.url());
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const safeSelectors = {
      lyricsEditor: '[role="textbox"][aria-label*="Lyric" i]',
      styleWrapper: '[data-testid="create-form-styles-wrapper"]',
      createButton: 'button[aria-label*="Create" i]',
      customMode: 'button[aria-label*="Custom" i]',
      captcha: 'iframe[src*="hcaptcha"], iframe[src*="turnstile"], [id*="hcaptcha"]',
      dialog: '[role="dialog"]'
    } as const;
    const selectorCounts = Object.fromEntries(
      await Promise.all(
        Object.entries(safeSelectors).map(async ([name, selector]) => [
          name,
          typeof page.locator === "function" ? await page.locator(selector).count().catch(() => 0) : 0
        ])
      )
    );
    const title = typeof page.title === "function" ? await page.title().catch(() => "") : "";
    const diagnostics = {
      capturedAt: new Date().toISOString(),
      url,
      title: sanitizeSunoDiagnosticText(title),
      selectorCounts
    };
    await writeFile(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
    await writeFile(urlPath, `${url}\n`, "utf8");
    return { screenshotPath, diagnosticsPath, url };
  } catch (error) {
    console.warn(
      `[artist-runtime] Suno failure snapshot skipped: ${sanitizeSunoDiagnosticText(error instanceof Error ? error.message : String(error))}`
    );
    return {};
  }
}

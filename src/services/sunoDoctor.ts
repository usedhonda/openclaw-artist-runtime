import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { sunoCdpEndpoint } from "./runtimeConfig.js";

export const SUNO_DOCTOR_DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";
export const SUNO_DOCTOR_VERSION_PATH = "/json/version";
export const SUNO_DOCTOR_CREATE_URL = "https://suno.com/create";

export interface SunoDoctorOptions {
  cdpEndpoint?: string;
  createUrl?: string;
  timeoutMs?: number;
}

export interface SunoDoctorCheck {
  name: string;
  status: "ok" | "fail";
  detail: string;
}

export interface SunoDoctorResult {
  ok: boolean;
  cdpEndpoint: string;
  createUrl: string;
  checks: SunoDoctorCheck[];
}

const TITLE_SELECTOR = "input[placeholder=\"Song Title (Optional)\"]:visible";
const LYRICS_SELECTOR = "textarea[data-testid=\"lyrics-textarea\"]";
const LYRICS_TOGGLE_SELECTOR = "button[aria-label=\"Add your own lyrics\"]";
const STYLE_SELECTOR =
  "[data-testid=\"create-form-styles-wrapper\"] textarea, textarea[placeholder=\"Describe the sound you want\"], textarea[placeholder*=\"クラシック音楽\"], textarea[placeholder*=\"バイキングメタル\"], textarea[placeholder*=\"sound you want\"]";

export async function runSunoDoctor(options: SunoDoctorOptions = {}): Promise<SunoDoctorResult> {
  const cdpEndpoint = normalizeEndpoint(options.cdpEndpoint);
  const createUrl = options.createUrl ?? SUNO_DOCTOR_CREATE_URL;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const checks: SunoDoctorCheck[] = [];
  let browser: Browser | undefined;

  const versionUrl = versionEndpoint(cdpEndpoint);
  try {
    const response = await fetch(versionUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      checks.push({
        name: "cdp_version",
        status: "fail",
        detail: `${versionUrl} returned HTTP ${response.status}`
      });
      return result(cdpEndpoint, createUrl, checks);
    }
    checks.push({ name: "cdp_version", status: "ok", detail: `${versionUrl} is reachable` });
  } catch (error) {
    checks.push({
      name: "cdp_version",
      status: "fail",
      detail: `${versionUrl} is not reachable: ${errorMessage(error)}`
    });
    return result(cdpEndpoint, createUrl, checks);
  }

  try {
    const { chromium } = await import("playwright");
    browser = await chromium.connectOverCDP(cdpEndpoint);
    checks.push({ name: "cdp_attach", status: "ok", detail: `attached to ${cdpEndpoint}` });

    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = await resolveSunoPage(context);
    await page.goto(createUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    checks.push({ name: "create_page", status: "ok", detail: `opened ${page.url()}` });

    const title = page.locator(TITLE_SELECTOR).first();
    checks.push(await checkWritableLocator("title_input", title, timeoutMs));

    await ensureLyricsTextareaVisible(page, timeoutMs);
    const lyrics = page.locator(LYRICS_SELECTOR).first();
    checks.push(await checkWritableLocator("lyrics_textarea", lyrics, timeoutMs));

    const style = page.locator(STYLE_SELECTOR).first();
    checks.push(await checkWritableLocator("style_textarea", style, timeoutMs));
  } catch (error) {
    checks.push({ name: "playwright_probe", status: "fail", detail: errorMessage(error) });
  } finally {
    (browser as unknown as { disconnect?: () => void } | undefined)?.disconnect?.();
  }

  return result(cdpEndpoint, createUrl, checks);
}

function normalizeEndpoint(endpoint: string | undefined): string {
  return (endpoint?.trim() || sunoCdpEndpoint() || SUNO_DOCTOR_DEFAULT_CDP_ENDPOINT)
    .replace(/\/+$/, "");
}

function versionEndpoint(cdpEndpoint: string): string {
  return `${cdpEndpoint}${SUNO_DOCTOR_VERSION_PATH}`;
}

async function resolveSunoPage(context: BrowserContext): Promise<Page> {
  const sunoPage = context.pages().find((page) => {
    try {
      return page.url().includes("suno.com");
    } catch {
      return false;
    }
  });
  return sunoPage ?? context.pages()[0] ?? await context.newPage();
}

async function ensureLyricsTextareaVisible(page: Page, timeoutMs: number): Promise<void> {
  const textarea = page.locator(LYRICS_SELECTOR).first();
  if (await textarea.isVisible({ timeout: Math.min(timeoutMs, 5_000) }).catch(() => false)) {
    return;
  }

  const toggle = page.locator(LYRICS_TOGGLE_SELECTOR).first();
  if (await toggle.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await toggle.click();
  }
}

async function checkWritableLocator(name: string, locator: Locator, timeoutMs: number): Promise<SunoDoctorCheck> {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    const editable = await locator.isEditable({ timeout: Math.min(timeoutMs, 5_000) });
    if (!editable) {
      return { name, status: "fail", detail: `${name} is visible but not editable` };
    }
    return { name, status: "ok", detail: `${name} is visible and editable` };
  } catch (error) {
    return { name, status: "fail", detail: `${name} check failed: ${errorMessage(error)}` };
  }
}

function result(cdpEndpoint: string, createUrl: string, checks: SunoDoctorCheck[]): SunoDoctorResult {
  return {
    ok: checks.every((check) => check.status === "ok"),
    cdpEndpoint,
    createUrl,
    checks
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatSunoDoctorResult(result: SunoDoctorResult): string {
  const lines = [
    `Suno CDP doctor: ${result.ok ? "ok" : "fail"}`,
    `CDP endpoint: ${result.cdpEndpoint}`,
    `Create URL: ${result.createUrl}`,
    ...result.checks.map((check) => `${check.status.toUpperCase()} ${check.name}: ${check.detail}`)
  ];
  if (!result.ok) {
    lines.push("Action: start Chrome with scripts/start-chrome-cdp.sh, complete Suno login, then rerun this doctor.");
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const endpointArg = readArg(args, "--cdp-endpoint") ?? readArg(args, "--endpoint");
  const createUrl = readArg(args, "--create-url");
  const result = await runSunoDoctor({ cdpEndpoint: endpointArg, createUrl });
  process.stdout.write(formatSunoDoctorResult(result));
  process.exitCode = result.ok ? 0 : 1;
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

if (process.argv[1]?.endsWith("sunoDoctor.js")) {
  await main();
}

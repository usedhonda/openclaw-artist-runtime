import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  SunoCreateRequest,
  SunoCreateResult,
  SunoImportRequest,
  SunoImportResult,
  SunoImportedAssetMetadata,
  SunoSubmitMode
} from "../types.js";
import type { SunoBrowserDriver, SunoBrowserDriverProbe } from "./sunoBrowserWorker.js";
import type { BrowserContext, Locator, Page } from "playwright";
import { captureSunoFailure, resolveSunoFailureLogsDir } from "./sunoFailureSnapshot.js";
import { isSunoCdpEnabled, sunoBrowserArgs, sunoCdpEndpoint, sunoChromeExecutablePath } from "./runtimeConfig.js";
import { extractLyricsBody } from "./lyricsExtraction.js";

export const DEFAULT_SUNO_PROFILE_PATH = ".openclaw-browser-profiles/suno";
export const SUNO_CREATE_URL = "https://suno.com/create";
export const SUNO_LIBRARY_URL = "https://suno.com/me";
export const PLAYWRIGHT_DRIVER_NOT_INSTALLED_DETAIL =
  "playwright module not installed — run `npm install` in project root";
export const PLAYWRIGHT_DRIVER_LOGIN_REQUIRED_DETAIL =
  "Suno login required in persistent profile — run `scripts/openclaw-suno-login.sh` and complete operator login";
export const PLAYWRIGHT_CREATE_SKIPPED_REASON = "submit_skipped";
export const PLAYWRIGHT_LIVE_TIMEOUT_REASON = "playwright_live_timeout";
export const PLAYWRIGHT_IMPORT_NO_URLS_REASON = "playwright_import_no_urls";
export const PLAYWRIGHT_POLL_INTERVAL_MS = 3_000;
export const PLAYWRIGHT_POLL_TIMEOUT_MS = 10 * 60 * 1_000;
export const PLAYWRIGHT_CREATE_CARD_TIMEOUT_MS = 3 * 60 * 1_000;
export const PLAYWRIGHT_CREATE_CARD_REASON = "submitted_via_create_card";
export const PLAYWRIGHT_CREATE_TIMEOUT_REASON = "playwright_create_timeout";
export const PLAYWRIGHT_CREATE_NETWORK_REASON = "playwright_create_network_error";
export const PLAYWRIGHT_CREATE_DOM_MISSING_REASON = "playwright_create_dom_missing";
export const PLAYWRIGHT_CREATE_LOGIN_EXPIRED_REASON = "playwright_create_login_expired";
export const PLAYWRIGHT_CREATE_RATE_LIMITED_REASON = "playwright_create_rate_limited";

interface OpenedSunoContext {
  context: BrowserContext;
  preferredPage: Page;
  close: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Round 38 adds probe automation.
 * Round 39 adds create/import automation, and Round 40 adds audio download
 * flow. Each step still requires explicit GO.
 */
export class PlaywrightSunoDriver implements SunoBrowserDriver {
  constructor(
    readonly profilePath: string,
    readonly submitMode: SunoSubmitMode = "skip",
    private readonly workspaceRoot = ".",
    private readonly polling = {
      intervalMs: PLAYWRIGHT_POLL_INTERVAL_MS,
      timeoutMs: PLAYWRIGHT_POLL_TIMEOUT_MS,
      createCardTimeoutMs: PLAYWRIGHT_CREATE_CARD_TIMEOUT_MS
    }
  ) {}

  async probe(): Promise<SunoBrowserDriverProbe> {
    let opened: OpenedSunoContext | undefined;

    try {
      opened = await this.openContext();

      const page = opened.preferredPage;
      await page.goto(SUNO_CREATE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);

      const url = page.url();
      if (await this.isLoginRequired(page, url)) {
        return {
          state: "login_required",
          detail: PLAYWRIGHT_DRIVER_LOGIN_REQUIRED_DETAIL
        };
      }

      if (await this.isConnected(page, url)) {
        return {
          state: "connected",
          detail: `Suno session detected in ${this.profilePath}`
        };
      }

      return {
        state: "disconnected",
        detail: `Suno probe could not confirm login state at ${url}`
      };
    } catch (error) {
      if (this.isModuleNotInstalled(error)) {
        return {
          state: "disconnected",
          detail: PLAYWRIGHT_DRIVER_NOT_INSTALLED_DETAIL
        };
      }

      return {
        state: "disconnected",
        detail: `playwright probe failed: ${this.errorMessage(error)}`
      };
    } finally {
      await opened?.close().catch(() => undefined);
    }
  }

  async create(request: SunoCreateRequest): Promise<SunoCreateResult> {
    let opened: OpenedSunoContext | undefined;
    let page: Page | undefined;
    const runId = request.runId ?? `playwright_${Date.now().toString(36)}`;

    try {
      opened = await this.openContext();

      page = opened.preferredPage;
      await page.goto(SUNO_CREATE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);

      const payload = request.payload ?? {};
      const lyrics = this.extractPayloadLyrics(payload);
      const style = this.readPayloadText(payload.styleAndFeel);
      const exclude = this.readPayloadText(payload.excludeStyles);
      const instrumental = Boolean(payload.instrumental);
      const title = this.readPayloadText(payload.songName);
      const baselineCreateUrls = new Set(await this.readCreateCardSongUrls(page));

      await this.fillCreateForm(page, { lyrics, style, exclude, instrumental, title });

      if (this.submitMode === "skip") {
        return {
          accepted: false,
          runId,
          reason: PLAYWRIGHT_CREATE_SKIPPED_REASON,
          urls: [],
          dryRun: request.dryRun
        };
      }

      await page.locator('button[aria-label="Create song"]').click({ timeout: 10_000 });
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      const generated = await this.pollForGeneratedSongs(page, baselineCreateUrls, title);
      if (generated.urls.length > 0) {
        return {
          accepted: true,
          runId,
          reason: generated.reason ?? PLAYWRIGHT_CREATE_CARD_REASON,
          urls: generated.urls,
          dryRun: request.dryRun
        };
      }

      await this.captureCreateFailure(page, PLAYWRIGHT_LIVE_TIMEOUT_REASON, request, runId);
      return {
        accepted: false,
        runId,
        reason: PLAYWRIGHT_LIVE_TIMEOUT_REASON,
        urls: [],
        dryRun: request.dryRun
      };
    } catch (error) {
      if (this.isModuleNotInstalled(error)) {
        return {
          accepted: false,
          runId,
          reason: PLAYWRIGHT_DRIVER_NOT_INSTALLED_DETAIL,
          urls: [],
          dryRun: request.dryRun
        };
      }

      const classifiedReason = this.classifyCreateFailure(error);
      await this.captureCreateFailure(page, classifiedReason, request, runId);
      return {
        accepted: false,
        runId,
        reason: `${classifiedReason}: ${this.errorMessage(error)}`,
        urls: [],
        dryRun: request.dryRun
      };
    } finally {
      await opened?.close().catch(() => undefined);
    }
  }

  async importResults(request: SunoImportRequest): Promise<SunoImportResult> {
    if (request.urls.length === 0) {
      return {
        accepted: false,
        runId: request.runId,
        urls: [],
        paths: [],
        reason: PLAYWRIGHT_IMPORT_NO_URLS_REASON,
        dryRun: false
      };
    }

    let opened: OpenedSunoContext | undefined;

    try {
      opened = await this.openContext();

      const page = opened.preferredPage;
      const outputDir = join(this.workspaceRoot, "runtime", "suno", request.runId);
      await mkdir(outputDir, { recursive: true });

      const successfulUrls: string[] = [];
      const savedPaths: string[] = [];
      const metadata: SunoImportedAssetMetadata[] = [];
      const failures: string[] = [];

      for (const songUrl of request.urls) {
        try {
          await page.goto(songUrl, {
            waitUntil: "domcontentloaded",
            timeout: 20_000
          });
          await page.waitForLoadState("domcontentloaded").catch(() => undefined);

          const asset = await this.extractSongAudio(page, songUrl);
          if (!asset) {
            failures.push(`${songUrl}: audio asset not found`);
            continue;
          }

          const response = await fetch(asset.audioUrl);
          if (!response.ok) {
            failures.push(`${songUrl}: download failed with HTTP ${response.status}`);
            continue;
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          const outputPath = join(outputDir, `${asset.trackId}.${asset.format}`);
          await writeFile(outputPath, buffer);
          successfulUrls.push(songUrl);
          savedPaths.push(outputPath);
          metadata.push({
            url: songUrl,
            path: outputPath,
            title: asset.title,
            durationSec: asset.durationSec,
            format: asset.format
          });
        } catch (error) {
          failures.push(`${songUrl}: ${this.errorMessage(error)}`);
        }
      }

      return {
        accepted: savedPaths.length > 0,
        runId: request.runId,
        urls: successfulUrls,
        paths: savedPaths,
        metadata,
        reason: failures.length > 0 ? failures.join("; ") : "imported",
        dryRun: false
      };
    } catch (error) {
      if (this.isModuleNotInstalled(error)) {
        return {
          accepted: false,
          runId: request.runId,
          urls: [],
          paths: [],
          reason: PLAYWRIGHT_DRIVER_NOT_INSTALLED_DETAIL,
          dryRun: false
        };
      }

      return {
        accepted: false,
        runId: request.runId,
        urls: [],
        paths: [],
        reason: `playwright_import_failed: ${this.errorMessage(error)}`,
        dryRun: false
      };
    } finally {
      await opened?.close().catch(() => undefined);
    }
  }

  private async openContext(): Promise<OpenedSunoContext> {
    if (isSunoCdpEnabled()) {
      const { chromium } = await import("playwright");
      const browser = await chromium.connectOverCDP(sunoCdpEndpoint());
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const preferredPage = await this.resolvePreferredSunoPage(context);
      return {
        context,
        preferredPage,
        close: async () => undefined
      };
    }

    const { chromium } = await import("playwright-extra");
    const stealth = (await import("puppeteer-extra-plugin-stealth")).default;
    chromium.use(stealth());
    await mkdir(this.profilePath, { recursive: true });
    const executablePath = sunoChromeExecutablePath();
    const context = await chromium.launchPersistentContext(this.profilePath, {
      headless: false,
      ...(executablePath ? { executablePath } : { channel: "chrome" as const }),
      args: sunoBrowserArgs(),
      ignoreDefaultArgs: ["--enable-automation"]
    });
    const preferredPage = await this.resolvePreferredSunoPage(context);
    return {
      context,
      preferredPage,
      close: () => context.close()
    };
  }

  private async resolvePreferredSunoPage(context: BrowserContext): Promise<Page> {
    const pages = context.pages();
    const preferredPage =
      this.findPageByUrl(pages, SUNO_CREATE_URL) ??
      this.findPageByUrl(pages, SUNO_LIBRARY_URL) ??
      pages.find((page) => {
        try {
          return page.url().includes("suno.com");
        } catch {
          return false;
        }
      }) ??
      pages[0] ??
      (await context.newPage());
    await preferredPage.bringToFront?.();
    return preferredPage;
  }

  private findPageByUrl(pages: Page[], expectedUrl: string): Page | undefined {
    return pages.find((page) => {
      try {
        return page.url().startsWith(expectedUrl);
      } catch {
        return false;
      }
    });
  }

  private async isLoginRequired(page: Page, currentUrl: string): Promise<boolean> {
    if (/(sign[-_ ]?in|login|auth)/i.test(currentUrl)) {
      return true;
    }

    const loginSelectors = [
      "input[type='password']",
      "input[name='password']",
      "form[action*='login']",
      "form[action*='sign']"
    ];
    for (const selector of loginSelectors) {
      if (
        await page
          .locator(selector)
          .count()
          .catch(() => 0)
      ) {
        return true;
      }
    }

    return false;
  }

  private async isConnected(page: Page, currentUrl: string): Promise<boolean> {
    if (/^https:\/\/suno\.com\/(create|library|me|explore|$)/.test(currentUrl)) {
      return true;
    }

    const connectedSelectors = [
      "[data-testid*='avatar']",
      "[aria-label*='Account']",
      "a[href='/create']",
      "a[href='/library']"
    ];
    for (const selector of connectedSelectors) {
      if (
        await page
          .locator(selector)
          .count()
          .catch(() => 0)
      ) {
        return true;
      }
    }

    return false;
  }

  private readPayloadText(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  private extractPayloadLyrics(payload: Record<string, unknown>): string | undefined {
    const source =
      this.readPayloadText(payload.payloadYaml) ??
      this.readPayloadText(payload.lyrics) ??
      this.readPayloadText(payload.lyricsText);
    if (!source) {
      return undefined;
    }

    return this.readPayloadText(extractLyricsBody(source)) ?? source;
  }

  private async fillCreateForm(
    page: Page,
    input: {
      lyrics?: string;
      style?: string;
      exclude?: string;
      instrumental: boolean;
      title?: string;
    }
  ): Promise<void> {
    if (input.lyrics) {
      await this.ensureLyricsMode(page);
      await this.fillTextAndAssert(page.locator('textarea[data-testid="lyrics-textarea"]'), "lyrics", input.lyrics);
    }

    if (input.style) {
      await this.fillTextAndAssert(this.styleLocator(page), "style", input.style);
    }

    if (input.title) {
      await this.fillTextAndAssert(
        page.locator('input[placeholder="Song Title (Optional)"]:visible'),
        "title",
        input.title
      );
    }

    if (input.exclude) {
      await this.fillTextAndAssert(page.locator('input[placeholder="Exclude styles"]'), "exclude", input.exclude);
    }

    if (input.instrumental) {
      const button = page.locator('button[aria-label="Check this to generate an instrumental only song"]').first();
      const buttonWithOptionalMethods = button as unknown as {
        getAttribute?: (name: string) => Promise<string | null>;
        isEnabled?: () => Promise<boolean>;
        waitFor?: (options: { state: "visible"; timeout: number }) => Promise<void>;
      };
      if (buttonWithOptionalMethods.waitFor) {
        try {
          await buttonWithOptionalMethods.waitFor({ state: "visible", timeout: 5_000 });
        } catch (error) {
          if (buttonWithOptionalMethods.isEnabled) {
            throw error;
          }
        }
      }
      if (buttonWithOptionalMethods.isEnabled && !(await buttonWithOptionalMethods.isEnabled())) {
        throw new Error("suno_create_instrumental_unavailable: instrumental toggle is disabled");
      }
      const pressed = buttonWithOptionalMethods.getAttribute
        ? await buttonWithOptionalMethods.getAttribute("aria-pressed").catch(() => null)
        : "false";
      if (pressed !== "true") {
        await button.click();
      }
    }
  }

  private async fillTextAndAssert(locator: Locator, fieldName: string, expected: string): Promise<void> {
    const locatorWithOptionalMethods = locator as unknown as { first?: () => Locator };
    const field = locatorWithOptionalMethods.first ? locatorWithOptionalMethods.first() : locator;
    const fieldWithOptionalMethods = field as unknown as {
      waitFor?: (options: { state: "visible"; timeout: number }) => Promise<void>;
      evaluate?: <Result, Arg>(pageFunction: (element: Element, arg: Arg) => Result, arg: Arg) => Promise<Result>;
    };
    if (fieldWithOptionalMethods.waitFor) {
      try {
        await fieldWithOptionalMethods.waitFor({ state: "visible", timeout: 5_000 });
      } catch (error) {
        if (fieldWithOptionalMethods.evaluate) {
          throw error;
        }
      }
    }

    let reflected = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await field.fill(expected);
      if (!fieldWithOptionalMethods.evaluate) {
        return;
      }

      reflected = await fieldWithOptionalMethods.evaluate((element, _value) => {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          return element.value;
        }
        return element.textContent ?? "";
      }, expected);

      if (reflected.startsWith(expected) || (reflected.length > 0 && expected.startsWith(reflected))) {
        return;
      }
    }

    throw new Error(
      `suno_create_fill_mismatch: ${fieldName} reflected value did not match (Suno UI may have truncated); expected=${JSON.stringify(expected.slice(0, 80))} actual=${JSON.stringify(reflected.slice(0, 80))}`
    );
  }

  private async ensureLyricsMode(page: Page): Promise<void> {
    const textarea = page.locator('textarea[data-testid="lyrics-textarea"]');
    try {
      await textarea.first().waitFor({ state: "visible", timeout: 5_000 });
      return;
    } catch {
      // Suno's React mount can lag after domcontentloaded; fall through only if the toggle is usable.
    }
    const button = page.locator('button[aria-label="Add your own lyrics"]');
    if (
      await button
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await button.first().click();
    }
  }

  private styleLocator(page: Page) {
    return page.locator(
      '[data-testid="create-form-styles-wrapper"] textarea, textarea[placeholder="Describe the sound you want"], textarea[placeholder*="クラシック音楽"], textarea[placeholder*="バイキングメタル"], textarea[placeholder*="sound you want"]'
    );
  }

  private async pollForGeneratedSongs(
    page: Page,
    baselineUrls: Set<string>,
    expectedTitle?: string
  ): Promise<{ urls: string[]; reason?: string }> {
    const createCardAttempts = Math.max(
      1,
      Math.ceil((this.polling.createCardTimeoutMs ?? PLAYWRIGHT_CREATE_CARD_TIMEOUT_MS) / this.polling.intervalMs)
    );

    const createCardUrls = await this.pollCreateCards(page, baselineUrls, createCardAttempts, expectedTitle);
    if (createCardUrls.length > 0) {
      return { urls: createCardUrls, reason: PLAYWRIGHT_CREATE_CARD_REASON };
    }

    return { urls: [] };
  }

  private async readCreateCardSongUrls(page: Page, expectedTitle?: string): Promise<string[]> {
    const titleFilter = expectedTitle ? `[aria-label="${this.escapeAttributeValue(expectedTitle)}"]` : "";
    return page
      .locator(`[data-testid="clip-row"][data-clip-status="complete"]${titleFilter} a[href*='/song/']`)
      .evaluateAll((elements) =>
        elements
          .map((element) => (element as HTMLAnchorElement).href)
          .filter((href) => href.startsWith("https://suno.com/song/"))
      );
  }

  private escapeAttributeValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private async pollCreateCards(
    page: Page,
    baselineUrls: Set<string>,
    maxAttempts: number,
    expectedTitle?: string
  ): Promise<string[]> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const createCardUrls = await this.readCreateCardSongUrls(page, expectedTitle);
      const newUrls = createCardUrls.filter((url) => !baselineUrls.has(url));
      if (newUrls.length > 0) {
        return newUrls;
      }
      if (attempt < maxAttempts - 1) {
        await sleep(this.polling.intervalMs);
      }
    }
    return [];
  }

  private async extractSongAudio(
    page: Page,
    sourceUrl: string
  ): Promise<
    | {
        trackId: string;
        audioUrl: string;
        format: "mp3" | "m4a";
        title?: string;
        durationSec?: number;
      }
    | undefined
  > {
    return page.evaluate((currentSongUrl) => {
      const title = document.querySelector("h1")?.textContent?.trim() || document.title || undefined;
      const audioTags = Array.from(document.querySelectorAll("audio")) as HTMLAudioElement[];
      const normalize = (audioUrl: string | undefined) => {
        if (!audioUrl || audioUrl.includes("sil-100.mp3")) {
          return undefined;
        }

        const songMatch = currentSongUrl.match(/\/song\/([^/?#]+)/);
        const audioMatch = audioUrl.match(/\/([^/?#]+)\.(mp3|m4a)(?:\?|$)/);
        const trackId = songMatch?.[1] ?? audioMatch?.[1];
        const format = audioMatch?.[2] as "mp3" | "m4a" | undefined;
        if (!trackId || !format) {
          return undefined;
        }

        const matchingAudio = audioTags.find((element) => (element.currentSrc || element.src) === audioUrl);
        const rawDuration = matchingAudio?.duration;
        const durationSec =
          typeof rawDuration === "number" && Number.isFinite(rawDuration) && rawDuration > 0
            ? Math.round(rawDuration)
            : undefined;
        return { trackId, audioUrl, format, title, durationSec };
      };

      const directMp3 = normalize(
        audioTags
          .map((element) => element.currentSrc || element.src)
          .find((src) => src.includes(".mp3") && !src.includes("sil-100.mp3"))
      );
      if (directMp3) {
        return directMp3;
      }

      const directM4a = normalize(
        audioTags.map((element) => element.currentSrc || element.src).find((src) => src.includes(".m4a"))
      );
      if (directM4a) {
        return directM4a;
      }

      const scriptTexts = Array.from(document.scripts)
        .map((script) => script.textContent ?? "")
        .filter(Boolean);
      const scriptMp3 = normalize(
        scriptTexts
          .flatMap((text) =>
            Array.from(text.matchAll(/https:\/\/cdn1\.suno\.ai\/[^"'\\\s]+\.mp3(?:\?[^"'\\\s]*)?/g)).map(
              (match) => match[0]
            )
          )
          .find((url) => !url.includes("sil-100.mp3"))
      );
      if (scriptMp3) {
        return scriptMp3;
      }

      return normalize(
        scriptTexts.flatMap((text) =>
          Array.from(text.matchAll(/https:\/\/cdn1\.suno\.ai\/[^"'\\\s]+\.m4a(?:\?[^"'\\\s]*)?/g)).map(
            (match) => match[0]
          )
        )[0]
      );
    }, sourceUrl);
  }

  private isModuleNotInstalled(error: unknown): boolean {
    const message = this.errorMessage(error);
    return message.includes("Cannot find package 'playwright'") || message.includes("Cannot find module 'playwright'");
  }

  private classifyCreateFailure(error: unknown): string {
    const message = this.errorMessage(error);
    if (/(rate limit|too many requests|http 429|\b429\b)/i.test(message)) {
      return PLAYWRIGHT_CREATE_RATE_LIMITED_REASON;
    }
    if (/(login|required|expired|sign[-_ ]?in|auth)/i.test(message)) {
      return PLAYWRIGHT_CREATE_LOGIN_EXPIRED_REASON;
    }
    if (/(selector|locator|not found|strict mode violation|no element|element.*missing)/i.test(message)) {
      return PLAYWRIGHT_CREATE_DOM_MISSING_REASON;
    }
    if (/(timeout|timed out)/i.test(message)) {
      return PLAYWRIGHT_CREATE_TIMEOUT_REASON;
    }
    if (/(network|net::|econn|enotfound|socket|navigation failed)/i.test(message)) {
      return PLAYWRIGHT_CREATE_NETWORK_REASON;
    }
    return "playwright_create_failed";
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async captureCreateFailure(
    page: Page | undefined,
    reason: string,
    request: SunoCreateRequest,
    runId: string
  ): Promise<void> {
    if (!page) {
      return;
    }
    await captureSunoFailure(page, {
      logsDir: resolveSunoFailureLogsDir(this.workspaceRoot),
      reason,
      songId: request.songId,
      runId
    });
  }
}

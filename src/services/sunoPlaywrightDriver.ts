import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  SunoCreateRequest,
  SunoCreateResult,
  SunoImportRequest,
  SunoImportResult,
  SunoImportedAssetMetadata,
  SunoLyricsSubmitTelemetry,
  SunoSubmitMode
} from "../types.js";
import type { SunoBrowserDriver, SunoBrowserDriverProbe } from "./sunoBrowserWorker.js";
import type { BrowserContext, Locator, Page } from "playwright";
import { captureSunoFailure, resolveSunoFailureLogsDir } from "./sunoFailureSnapshot.js";
import { effectiveLyricsBoxLimit, isSunoCdpEnabled, sunoBrowserArgs, sunoBrowserChannel, sunoCdpEndpoint, sunoChromeExecutablePath } from "./runtimeConfig.js";
import { checkSunoBrowserBinaryHealth, isSunoBrowserLaunchFailure, reinstallPlaywrightChromium } from "./sunoBinaryHealthCheck.js";
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
export const PLAYWRIGHT_TITLE_REQUIRED_REASON = "playwright_title_required";
export const PLAYWRIGHT_IMPORT_NO_URLS_REASON = "playwright_import_no_urls";
export const PLAYWRIGHT_POLL_INTERVAL_MS = 3_000;
export const PLAYWRIGHT_POLL_TIMEOUT_MS = 10 * 60 * 1_000;
export const PLAYWRIGHT_CREATE_CARD_TIMEOUT_MS = 3 * 60 * 1_000;
export const PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT = 2;
export const PLAYWRIGHT_CREATE_CARD_REASON = "submitted_via_create_card";
export const PLAYWRIGHT_CREATE_TIMEOUT_REASON = "playwright_create_timeout";
export const PLAYWRIGHT_CREATE_NETWORK_REASON = "playwright_create_network_error";
export const PLAYWRIGHT_CREATE_DOM_MISSING_REASON = "playwright_create_dom_missing";
export const PLAYWRIGHT_CREATE_LOGIN_EXPIRED_REASON = "playwright_create_login_expired";
export const PLAYWRIGHT_CREATE_RATE_LIMITED_REASON = "playwright_create_rate_limited";
// Suno's lyrics textarea maxLength fluctuates between the normal box (5000) and a
// transient degraded box (1250) depending on UI state / gradual rollout
// (knowledge/suno_v55_reference.md). A correct payload that fits the real box must NOT
// hard-fail when Suno momentarily serves the 1250 cap — it is retryable, so a reload
// (driver) and a soft backoff retry (autopilot) can land the take once the box returns.
export const PLAYWRIGHT_LYRICS_BOX_DEGRADED_REASON = "suno_lyrics_box_degraded";
export const PLAYWRIGHT_LYRICS_BOX_DEGRADED_RELOAD_ATTEMPTS = 2;

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
    let lyricsTelemetry: SunoLyricsSubmitTelemetry | undefined;

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

      lyricsTelemetry = await this.fillCreateForm(page, { lyrics, style, exclude, instrumental, title });

      if (this.submitMode === "skip") {
        return {
          accepted: false,
          runId,
          reason: PLAYWRIGHT_CREATE_SKIPPED_REASON,
          urls: [],
          lyricsTelemetry,
          dryRun: request.dryRun
        };
      }

      if (!title) {
        await this.captureCreateFailure(page, PLAYWRIGHT_TITLE_REQUIRED_REASON, request, runId);
        return {
          accepted: false,
          runId,
          reason: PLAYWRIGHT_TITLE_REQUIRED_REASON,
          urls: [],
          lyricsTelemetry,
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
          lyricsTelemetry,
          dryRun: request.dryRun
        };
      }

      await this.captureCreateFailure(page, PLAYWRIGHT_LIVE_TIMEOUT_REASON, request, runId);
      return {
        accepted: false,
        runId,
        reason: PLAYWRIGHT_LIVE_TIMEOUT_REASON,
        urls: [],
        lyricsTelemetry,
        dryRun: request.dryRun
      };
    } catch (error) {
      if (this.isModuleNotInstalled(error)) {
        return {
          accepted: false,
          runId,
          reason: PLAYWRIGHT_DRIVER_NOT_INSTALLED_DETAIL,
          urls: [],
          lyricsTelemetry,
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
        lyricsTelemetry,
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
      const dryRun = request.dryRun === true;
      const outputDir = join(this.workspaceRoot, "runtime", dryRun ? "suno-dryrun" : "suno", request.runId);
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
        dryRun
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
    const channel = executablePath ? undefined : sunoBrowserChannel();
    const usesBundledChromium = !executablePath && !channel;
    const launchOptions = {
      headless: false,
      ...(executablePath ? { executablePath } : {}),
      ...(channel ? { channel } : {}),
      args: sunoBrowserArgs(),
      ignoreDefaultArgs: ["--enable-automation"]
    };
    if (usesBundledChromium) {
      const health = await checkSunoBrowserBinaryHealth().catch((error) => ({
        ok: false,
        detail: `playwright_chromium_health_check_failed: ${this.errorMessage(error)}`,
        checkedAt: new Date().toISOString()
      }));
      if (!health.ok) {
        console.warn(`[artist-runtime] ${health.detail ?? "playwright_chromium_binary_unhealthy"}; reinstalling Chromium`);
        await reinstallPlaywrightChromium("playwright_chromium_health_check_failed");
      }
    }
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(this.profilePath, launchOptions);
    } catch (error) {
      if (!usesBundledChromium || !isSunoBrowserLaunchFailure(error)) {
        throw error;
      }
      console.warn(`[artist-runtime] playwright Chromium launch failed; reinstalling and retrying once: ${this.errorMessage(error)}`);
      await reinstallPlaywrightChromium("playwright_chromium_launch_failed");
      context = await chromium.launchPersistentContext(this.profilePath, launchOptions);
    }
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
    return (
      this.readPayloadText(payload.payloadYaml) ??
      this.readPayloadText(payload.lyrics) ??
      this.readPayloadText(payload.lyricsText)
    );
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
  ): Promise<SunoLyricsSubmitTelemetry | undefined> {
    let lyricsTelemetry: SunoLyricsSubmitTelemetry | undefined;
    if (input.lyrics) {
      lyricsTelemetry = await this.fillLyricsWithDegradedRecovery(page, input.lyrics);
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

    return lyricsTelemetry;
  }

  // Suno can momentarily serve a degraded 1250-char lyrics box (see
  // PLAYWRIGHT_LYRICS_BOX_DEGRADED_REASON). When that happens for a payload that fits the
  // real box, reload the create page to re-measure a fresh maxLength and catch the normal
  // 5000 box within a bounded number of attempts. Lyrics are filled first in
  // fillCreateForm, so a reload here cannot clobber already-filled style/title/exclude.
  private async fillLyricsWithDegradedRecovery(page: Page, lyrics: string): Promise<SunoLyricsSubmitTelemetry> {
    for (let attempt = 0; attempt <= PLAYWRIGHT_LYRICS_BOX_DEGRADED_RELOAD_ATTEMPTS; attempt += 1) {
      await this.ensureLyricsMode(page);
      try {
        return await this.fillLyricsTextAndMeasure(
          page.locator('textarea[data-testid="lyrics-textarea"]'),
          lyrics
        );
      } catch (error) {
        const message = this.errorMessage(error);
        if (
          !message.includes(PLAYWRIGHT_LYRICS_BOX_DEGRADED_REASON) ||
          attempt === PLAYWRIGHT_LYRICS_BOX_DEGRADED_RELOAD_ATTEMPTS
        ) {
          throw error;
        }
        // Transient degraded box: reload to force Suno to re-render the editor so the
        // next attempt measures a fresh maxLength (usually back to the normal box).
        const reloadablePage = page as unknown as {
          goto?: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
          waitForLoadState?: (state?: string) => Promise<unknown>;
        };
        if (reloadablePage.goto) {
          await reloadablePage
            .goto(SUNO_CREATE_URL, { waitUntil: "domcontentloaded", timeout: 20_000 })
            .catch(() => undefined);
        }
        if (reloadablePage.waitForLoadState) {
          await reloadablePage.waitForLoadState("domcontentloaded").catch(() => undefined);
        }
        await sleep(this.polling.intervalMs);
      }
    }
    throw new Error(`${PLAYWRIGHT_LYRICS_BOX_DEGRADED_REASON}: exhausted reload attempts`);
  }

  private async fillLyricsTextAndMeasure(locator: Locator, expected: string): Promise<SunoLyricsSubmitTelemetry> {
    const result = await this.fillTextAndAssert(locator, "lyrics", expected);
    const bareLyricsChars = extractLyricsBody(expected).length;
    const submittedPayloadChars = expected.length;
    return {
      bareLyricsChars,
      markerChars: Math.max(0, submittedPayloadChars - bareLyricsChars),
      submittedPayloadChars,
      effectiveLyricsBoxLimit: effectiveLyricsBoxLimit({ domMaxLength: result.maxLength }),
      textareaMaxLength: result.maxLength,
      textareaReadbackChars: result.reflected.length,
      readbackMatches: result.reflected === expected
    };
  }

  private async fillTextAndAssert(locator: Locator, fieldName: string, expected: string): Promise<{ reflected: string; maxLength?: number }> {
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
    let maxLength: number | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (fieldName === "lyrics" && fieldWithOptionalMethods.evaluate) {
        maxLength = await fieldWithOptionalMethods.evaluate((element) => {
          if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
            return element.maxLength > 0 ? element.maxLength : undefined;
          }
          return undefined;
        }, undefined);
        const realBox = effectiveLyricsBoxLimit({});
        const effectiveLimit = effectiveLyricsBoxLimit({ domMaxLength: maxLength });
        if (expected.length > realBox) {
          // Genuine oversize payload (exceeds the real Suno box) — hard fail-closed.
          throw new Error(
            `lyrics_payload_truncated_before_submit: payload exceeds Suno lyrics textarea limit; expectedLength=${expected.length} effectiveLimit=${realBox} textareaMaxLength=${maxLength ?? "unknown"}`
          );
        }
        if (maxLength && maxLength > 0 && expected.length > effectiveLimit) {
          // Payload fits the real box but Suno is serving a transient degraded cap.
          // Retryable: a reload usually restores the normal box.
          throw new Error(
            `${PLAYWRIGHT_LYRICS_BOX_DEGRADED_REASON}: transient Suno lyrics textarea cap; expectedLength=${expected.length} textareaMaxLength=${maxLength} realBox=${realBox}`
          );
        }
      }
      await field.fill(expected);
      if (!fieldWithOptionalMethods.evaluate) {
        return { reflected: expected };
      }

      reflected = await fieldWithOptionalMethods.evaluate((element, _value) => {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          return element.value;
        }
        return element.textContent ?? "";
      }, expected);

      if (fieldName === "lyrics" && reflected === expected) {
        return { reflected, maxLength };
      }
      if (fieldName !== "lyrics" && (reflected.startsWith(expected) || (reflected.length > 0 && expected.startsWith(reflected)))) {
        return { reflected, maxLength };
      }
    }

    if (fieldName === "lyrics" && reflected.length > 0 && expected.startsWith(reflected)) {
      const realBox = effectiveLyricsBoxLimit({});
      if (expected.length <= realBox && maxLength && maxLength > 0 && reflected.length <= maxLength) {
        // Payload fits the real box but the DOM truncated to a transient degraded cap.
        throw new Error(
          `${PLAYWRIGHT_LYRICS_BOX_DEGRADED_REASON}: reflected lyrics shorter than payload under degraded box; expectedLength=${expected.length} actualLength=${reflected.length} textareaMaxLength=${maxLength}`
        );
      }
      throw new Error(
        `lyrics_payload_truncated_before_submit: reflected lyrics value shorter than payload; expectedLength=${expected.length} actualLength=${reflected.length}`
      );
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

    const createCardUrls = await this.pollCreateCards(
      page,
      baselineUrls,
      createCardAttempts,
      expectedTitle,
      PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT
    );
    if (createCardUrls.length > 0) {
      return { urls: createCardUrls, reason: PLAYWRIGHT_CREATE_CARD_REASON };
    }

    return { urls: [] };
  }

  private async readCreateCardSongUrls(page: Page, expectedTitle?: string): Promise<string[]> {
    // Suno's create-page workspace no longer exposes data-testid="clip-row" /
    // data-clip-status, nor /song/ anchors (confirmed against a captured create-page
    // DOM where finished takes were present but undetectable by the old selector — the
    // root cause of false playwright_live_timeout). A finished song now surfaces as a
    // play control (aria-label="Play <title>" or "Play <title> from start") whose nearby thumbnail image URL carries the song
    // id (cdn2.suno.ai/image[_large]_<uuid>.jpeg). Title-scope via the play button and
    // derive the song URL from that id. Create-page-only; no library navigation, so the
    // Plan v10.42 take-attribution fail-closed contract is preserved.
    const selector = expectedTitle
      ? [
          `[aria-label="Play ${this.escapeAttributeValue(expectedTitle)}"]`,
          `[aria-label^="Play ${this.escapeAttributeValue(expectedTitle)} "]`
        ].join(", ")
      : `[aria-label^="Play "]`;
    return page.locator(selector).evaluateAll((controls) => {
      const urls = new Set<string>();
      for (const control of controls) {
        let current: Element | null = control;
        let img: Element | null = null;
        for (let depth = 0; current && depth < 6; depth += 1) {
          img = current.querySelector("img[src*='suno.ai/image'], img[data-src*='suno.ai/image']");
          if (img) {
            break;
          }
          current = current.parentElement;
        }
        const source = img?.getAttribute("data-src") ?? img?.getAttribute("src") ?? "";
        const match = source.match(
          /image(?:_large)?_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
        );
        if (match) {
          urls.add(`https://suno.com/song/${match[1]}`);
        }
      }
      return Array.from(urls);
    });
  }

  private escapeAttributeValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private async pollCreateCards(
    page: Page,
    baselineUrls: Set<string>,
    maxAttempts: number,
    expectedTitle?: string,
    expectedCount = PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT
  ): Promise<string[]> {
    if (!expectedTitle) {
      return [];
    }
    let bestUrls: string[] = [];
    let stablePolls = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const titleMatchedUrls = Array.from(
        new Set((await this.readCreateCardSongUrls(page, expectedTitle)).filter((url) => !baselineUrls.has(url)))
      );
      if (titleMatchedUrls.length > bestUrls.length) {
        bestUrls = titleMatchedUrls;
        stablePolls = 0;
      } else if (bestUrls.length > 0) {
        stablePolls += 1;
      }
      if (bestUrls.length >= expectedCount) {
        return bestUrls;
      }
      if (stablePolls > 0) {
        return bestUrls;
      }
      if (attempt < maxAttempts - 1) {
        await sleep(this.polling.intervalMs);
      }
    }
    return bestUrls;
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
    if (message.includes(PLAYWRIGHT_LYRICS_BOX_DEGRADED_REASON)) {
      return PLAYWRIGHT_LYRICS_BOX_DEGRADED_REASON;
    }
    if (/(rate limit|too many requests|http 429|\b429\b)/i.test(message)) {
      return PLAYWRIGHT_CREATE_RATE_LIMITED_REASON;
    }
    if (/(login|required|expired|sign[-_ ]?in|auth)/i.test(message)) {
      return PLAYWRIGHT_CREATE_LOGIN_EXPIRED_REASON;
    }
    if (/(selector|locator|not found|strict mode violation|no element|element.*missing)/i.test(message)) {
      return PLAYWRIGHT_CREATE_DOM_MISSING_REASON;
    }
    if (message.includes("lyrics_payload_truncated_before_submit")) {
      return "lyrics_payload_truncated_before_submit";
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

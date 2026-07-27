import type { Locator, Page } from "playwright";
import type { SunoCreatePayload } from "../types.js";
import { SunoBrowserService, sunoBrowserService } from "./sunoBrowserService.js";
import type { SunoBrowserConfigView } from "./runtimeConfig.js";
import { SUNO_CREATE_URL } from "./sunoPlaywrightDriver.js";
import {
  SUNO_CREATE_FALLBACKS,
  SUNO_EXPECTED_TAKE_COUNT,
  ensureSunoLyricsMode,
  filterFreshTakeUrls,
  readSunoCreateCardSongUrls,
  resolveFirstVisibleLocator,
  sunoStyleLocator,
  waitForSunoCreateFormReady
} from "./sunoCreateForm.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import type {
  HumanAssistBrowserDriver,
  HumanAssistSubmitOutcome,
  HumanAssistWaitOutcome
} from "./sunoHumanAssist.js";

/**
 * Best-effort implementation of HumanAssistBrowserDriver for the captcha human-assist
 * fallback on the operator machine.
 *
 * It obtains the logged-in Suno browser from the plugin-owned SunoBrowserService (which
 * launches the persistent `suno` profile, or attaches to a legacy CDP Chrome), auto-fills
 * the create form, and tries a machine Create click. If a captcha challenge appears, it
 * closes the challenge overlay
 * (Escape only -- it never solves or bypasses it) and polls for the producer's manual
 * Create click. Suno is contacted only here; this module is deliberately NOT unit
 * tested against a live DOM (selectors are validated on the real machine at the next
 * live create). The tested contract lives in the state machine (sunoHumanAssist.ts)
 * and the connector decorator, which both drive this class through the injectable
 * HumanAssistBrowserDriver interface.
 */

const CAPTCHA_MARKERS = 'iframe[src*="hcaptcha"], iframe[title*="hCaptcha"], iframe[src*="turnstile"], [id*="hcaptcha"]';

const FORM_READY_TIMEOUT_MS = 25_000;
const CLICK_TIMEOUT_MS = 25_000;
const POST_CLICK_SETTLE_MS = 6_000;
const POLL_INTERVAL_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractLyrics(payload: SunoCreatePayload): string | undefined {
  return readText(payload.payloadYaml) ?? readText(payload.lyrics) ?? readText(payload.lyricsText);
}

export interface CdpHumanAssistDriverInput {
  payload: SunoCreatePayload;
  service?: SunoBrowserService;
  config?: SunoBrowserConfigView;
}

export class CdpHumanAssistDriver implements HumanAssistBrowserDriver {
  private page: Page | undefined;
  private baselineSongUrls = new Set<string>();
  private readonly service: SunoBrowserService;

  constructor(private readonly input: CdpHumanAssistDriverInput) {
    this.service = input.service ?? sunoBrowserService;
  }

  async openAndFill(): Promise<void> {
    const { context } = await this.service.ensureRunning(this.input.config);
    const existing = context.pages().find((page) => {
      try {
        return page.url().includes("suno.com");
      } catch {
        return false;
      }
    });
    const page = existing ?? (await context.newPage());
    await page.goto(SUNO_CREATE_URL, { waitUntil: "domcontentloaded", timeout: FORM_READY_TIMEOUT_MS });
    // Wait for the form to render past the Clerk handshake using any-of form-ready
    // selectors (not just the Create button) so a single relabel does not defeat the gate.
    await waitForSunoCreateFormReady(page, FORM_READY_TIMEOUT_MS);
    this.page = page;
    // Baseline is title-scoped so pre-existing takes of the SAME title (earlier
    // attempts today) are excluded and only genuinely new takes count as fresh.
    this.baselineSongUrls = new Set(await this.readTakeUrls());

    const payload = this.input.payload;
    const lyrics = extractLyrics(payload);
    if (lyrics && !payload.instrumental) {
      // The create page opens in "Simple" mode with no lyrics textarea. Switch to
      // custom mode first, otherwise the fill waits forever on an unmounted element.
      const lyricsField = await ensureSunoLyricsMode(page, FORM_READY_TIMEOUT_MS);
      await lyricsField.fill(lyrics, { timeout: FORM_READY_TIMEOUT_MS });
    }
    const style = readText(payload.styleAndFeel);
    if (style) {
      await sunoStyleLocator(page).first().fill(style, { timeout: FORM_READY_TIMEOUT_MS });
    }
    const title = readText(payload.songName);
    if (title) {
      await this.fillCandidates(SUNO_CREATE_FALLBACKS.titleInput, "title", title);
    }
    const exclude = readText(payload.excludeStyles);
    if (exclude) {
      await this.fillCandidates(SUNO_CREATE_FALLBACKS.excludeInput, "exclude styles", exclude);
    }
  }

  async attemptMachineSubmit(): Promise<HumanAssistSubmitOutcome> {
    const page = this.requirePage();
    const createButton = await resolveFirstVisibleLocator(
      page,
      SUNO_CREATE_FALLBACKS.createButton,
      CLICK_TIMEOUT_MS,
      "Create song button"
    );
    await createButton.click({ timeout: CLICK_TIMEOUT_MS });
    await sleep(POST_CLICK_SETTLE_MS);
    // Captcha is checked FIRST and, when present, the flow hands off to the human
    // WITHOUT harvesting URLs — a captcha means the submit did not go through, so any
    // song links on the page belong to the existing workspace, not to a new take.
    if (await this.hasCaptchaChallenge()) {
      return { kind: "captcha_challenge" };
    }
    const fresh = await this.freshTakeUrls();
    if (fresh.length > 0) {
      return { kind: "accepted", urls: fresh };
    }
    // No captcha visible and no new take yet: give Suno a brief settle window before
    // deciding, then treat a lingering captcha as a challenge, otherwise fall back to
    // the human path (safer than declaring an error and hard-stopping).
    await sleep(POST_CLICK_SETTLE_MS);
    if (await this.hasCaptchaChallenge()) {
      return { kind: "captcha_challenge" };
    }
    const settled = await this.freshTakeUrls();
    if (settled.length > 0) {
      return { kind: "accepted", urls: settled };
    }
    return { kind: "captcha_challenge" };
  }

  async closeChallengeOverlay(): Promise<void> {
    const page = this.requirePage();
    // Close only -- never interact with the captcha to solve it. Escape dismisses the
    // Suno challenge modal while leaving the filled form intact for the manual click.
    await page.keyboard.press("Escape").catch(() => undefined);
  }

  async bringToFront(): Promise<void> {
    await this.page?.bringToFront?.().catch(() => undefined);
  }

  async waitForHumanSubmit(timeoutMs: number): Promise<HumanAssistWaitOutcome> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Only a NEW title-scoped take (the producer's manual Create actually starting a
      // generation) counts as success. Workspace bleed / over-count is rejected inside
      // freshTakeUrls, so this never accepts unrelated existing songs.
      const fresh = await this.freshTakeUrls().catch(() => [] as string[]);
      if (fresh.length > 0) {
        return { kind: "accepted", urls: fresh };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { kind: "timeout" };
  }

  async close(): Promise<void> {
    // Drop our page reference and release the SunoBrowserService hold. The service
    // idle-closes the plugin-launched browser once the last holder releases (a legacy
    // CDP attach is left running); a later attempt re-acquires cleanly.
    this.page = undefined;
    await this.service.release();
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error("human_assist_page_not_open: call openAndFill first");
    }
    return this.page;
  }

  private async fillCandidates(
    candidates: readonly string[],
    fieldName: string,
    value: string
  ): Promise<void> {
    const field: Locator = await resolveFirstVisibleLocator(
      this.requirePage(),
      candidates,
      FORM_READY_TIMEOUT_MS,
      fieldName
    );
    await field.fill(value, { timeout: FORM_READY_TIMEOUT_MS });
  }

  private async hasCaptchaChallenge(): Promise<boolean> {
    const page = this.page;
    if (!page) return false;
    const count = await page.locator(CAPTCHA_MARKERS).count().catch(() => 0);
    return count > 0;
  }

  private expectedTitle(): string {
    return readText(this.input.payload.songName) ?? "";
  }

  private async readTakeUrls(): Promise<string[]> {
    const page = this.page;
    if (!page) return [];
    // Title-scoped create-card detection (shared with the Playwright lane). An empty
    // title yields [] so an untitled create never mis-attributes workspace songs.
    return readSunoCreateCardSongUrls(page, this.expectedTitle());
  }

  /**
   * New title-scoped takes since baseline, capped at the expected take count. When more
   * than the expected number appear (scope leak / workspace bleed), the batch is
   * rejected and a warning event is emitted — never returned as a fake success.
   */
  private async freshTakeUrls(): Promise<string[]> {
    const current = await this.readTakeUrls();
    const { urls, overCount } = filterFreshTakeUrls(current, this.baselineSongUrls, SUNO_EXPECTED_TAKE_COUNT);
    if (overCount) {
      emitRuntimeEvent({
        type: "error",
        source: "suno_human_assist",
        reason: `take_urls_over_expected: ${current.length} title-scoped urls for "${this.expectedTitle()}" exceed expected ${SUNO_EXPECTED_TAKE_COUNT}; rejecting as scope leak`,
        timestamp: Date.now()
      });
    }
    return urls;
  }
}

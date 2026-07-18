import type { Page } from "playwright";
import type { SunoCreatePayload } from "../types.js";
import { isSunoCdpEnabled, sunoCdpEndpoint } from "./runtimeConfig.js";
import { SUNO_CREATE_URL } from "./sunoPlaywrightDriver.js";
import type {
  HumanAssistBrowserDriver,
  HumanAssistSubmitOutcome,
  HumanAssistWaitOutcome
} from "./sunoHumanAssist.js";

/**
 * Best-effort CDP-attached implementation of HumanAssistBrowserDriver for the
 * captcha human-assist fallback on the operator machine.
 *
 * It ATTACHES to the already-running CDP Chrome (scripts/start-chrome-cdp.sh) so it
 * reuses the logged-in Suno profile, auto-fills the create form, and tries a machine
 * Create click. If a captcha challenge appears, it closes the challenge overlay
 * (Escape only -- it never solves or bypasses it) and polls for the producer's manual
 * Create click. Suno is contacted only here; this module is deliberately NOT unit
 * tested against a live DOM (selectors are validated on the real machine at the next
 * live create). The tested contract lives in the state machine (sunoHumanAssist.ts)
 * and the connector decorator, which both drive this class through the injectable
 * HumanAssistBrowserDriver interface.
 */

const CREATE_BUTTON = 'button[aria-label="Create song"]';
const LYRICS_TEXTAREA = 'textarea[data-testid="lyrics-textarea"]';
const STYLE_TEXTAREA =
  '[data-testid="create-form-styles-wrapper"] textarea, textarea[placeholder="Describe the sound you want"], textarea[placeholder*="sound you want"]';
const TITLE_INPUT = 'input[placeholder="Song Title (Optional)"]:visible';
const EXCLUDE_INPUT = 'input[placeholder="Exclude styles"]';
const SONG_LINK = 'a[href*="/song/"]';
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
}

export class CdpHumanAssistDriver implements HumanAssistBrowserDriver {
  private page: Page | undefined;
  private baselineSongUrls = new Set<string>();

  constructor(private readonly input: CdpHumanAssistDriverInput) {}

  async openAndFill(): Promise<void> {
    if (!isSunoCdpEnabled()) {
      throw new Error("cdp_not_enabled: set OPENCLAW_SUNO_USE_CDP=1 and start scripts/start-chrome-cdp.sh");
    }
    const { chromium } = await import("playwright");
    const browser = await chromium.connectOverCDP(sunoCdpEndpoint());
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const existing = context.pages().find((page) => {
      try {
        return page.url().includes("suno.com");
      } catch {
        return false;
      }
    });
    const page = existing ?? (await context.newPage());
    await page.goto(SUNO_CREATE_URL, { waitUntil: "domcontentloaded", timeout: FORM_READY_TIMEOUT_MS });
    await page.locator(CREATE_BUTTON).first().waitFor({ state: "visible", timeout: FORM_READY_TIMEOUT_MS });
    this.page = page;
    this.baselineSongUrls = new Set(await this.readSongUrls());

    const payload = this.input.payload;
    const lyrics = extractLyrics(payload);
    if (lyrics && !payload.instrumental) {
      await this.fill(LYRICS_TEXTAREA, lyrics);
    }
    const style = readText(payload.styleAndFeel);
    if (style) {
      await this.fill(STYLE_TEXTAREA, style);
    }
    const title = readText(payload.songName);
    if (title) {
      await this.fill(TITLE_INPUT, title);
    }
    const exclude = readText(payload.excludeStyles);
    if (exclude) {
      await this.fill(EXCLUDE_INPUT, exclude);
    }
  }

  async attemptMachineSubmit(): Promise<HumanAssistSubmitOutcome> {
    const page = this.requirePage();
    await page.locator(CREATE_BUTTON).first().click({ timeout: CLICK_TIMEOUT_MS });
    await sleep(POST_CLICK_SETTLE_MS);
    if (await this.hasCaptchaChallenge()) {
      return { kind: "captcha_challenge" };
    }
    const fresh = await this.freshSongUrls();
    if (fresh.length > 0) {
      return { kind: "accepted", urls: fresh };
    }
    // No captcha visible and no new song yet: give Suno a brief settle window before
    // deciding, then treat a lingering captcha as a challenge, otherwise fall back to
    // the human path (safer than declaring an error and hard-stopping).
    await sleep(POST_CLICK_SETTLE_MS);
    if (await this.hasCaptchaChallenge()) {
      return { kind: "captcha_challenge" };
    }
    const settled = await this.freshSongUrls();
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
      const fresh = await this.freshSongUrls().catch(() => [] as string[]);
      if (fresh.length > 0) {
        return { kind: "accepted", urls: fresh };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { kind: "timeout" };
  }

  async close(): Promise<void> {
    // CDP-attached: leave the operator's Chrome and logged-in profile running; only
    // drop our reference so a later attempt reconnects cleanly.
    this.page = undefined;
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error("human_assist_page_not_open: call openAndFill first");
    }
    return this.page;
  }

  private async fill(selector: string, value: string): Promise<void> {
    const field = this.requirePage().locator(selector).first();
    await field.fill(value, { timeout: FORM_READY_TIMEOUT_MS });
  }

  private async hasCaptchaChallenge(): Promise<boolean> {
    const page = this.page;
    if (!page) return false;
    const count = await page.locator(CAPTCHA_MARKERS).count().catch(() => 0);
    return count > 0;
  }

  private async readSongUrls(): Promise<string[]> {
    const page = this.page;
    if (!page) return [];
    return page
      .locator(SONG_LINK)
      .evaluateAll((anchors) =>
        (anchors as HTMLAnchorElement[])
          .map((anchor) => anchor.href)
          .filter((href) => /\/song\/[0-9a-f-]{16,}/i.test(href))
      )
      .catch(() => [] as string[]);
  }

  private async freshSongUrls(): Promise<string[]> {
    const urls = await this.readSongUrls();
    return urls.filter((url) => !this.baselineSongUrls.has(url));
  }
}

import type { BrowserContext, Page } from "playwright";
import { SunoBrowserService, sunoBrowserService } from "./sunoBrowserService.js";
import type { SunoBrowserConfigView } from "./runtimeConfig.js";
import { isSunoConnected, isSunoLoginRequired } from "./sunoLoginDetection.js";
import { SUNO_CREATE_URL } from "./sunoPlaywrightDriver.js";
import type { SunoBrowserDriver, SunoBrowserDriverProbe } from "./sunoBrowserWorker.js";

const NAV_TIMEOUT_MS = 25_000;

async function resolveSunoPage(context: BrowserContext): Promise<Page> {
  const existing = context.pages().find((page) => {
    try {
      return page.url().includes("suno.com");
    } catch {
      return false;
    }
  });
  const page = existing ?? (await context.newPage());
  await page.goto(SUNO_CREATE_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await page.waitForLoadState?.("domcontentloaded").catch(() => undefined);
  await page.bringToFront?.().catch(() => undefined);
  return page;
}

/**
 * SunoBrowserDriver whose probe() opens the plugin-owned browser via SunoBrowserService
 * (holding it open for the operator to log in) and judges login state with the shared
 * detection heuristics. stop() closes the operator session. Used by the suno_cli lane so
 * Producer Console connect/reconnect no longer depend on the manual login script.
 *
 * It only ever probes/opens on an explicit operator connect (never at boot or on a status
 * read), preserving the boot read-only invariant.
 */
export class SunoBrowserServiceProbeDriver implements SunoBrowserDriver {
  private readonly service: Pick<SunoBrowserService, "openOperatorSession" | "closeOperatorSession">;
  private readonly resolvePage: (context: BrowserContext) => Promise<Page>;

  constructor(
    private readonly config?: SunoBrowserConfigView,
    deps: {
      service?: Pick<SunoBrowserService, "openOperatorSession" | "closeOperatorSession">;
      resolvePage?: (context: BrowserContext) => Promise<Page>;
    } = {}
  ) {
    this.service = deps.service ?? sunoBrowserService;
    this.resolvePage = deps.resolvePage ?? resolveSunoPage;
  }

  async probe(): Promise<SunoBrowserDriverProbe> {
    const { context } = await this.service.openOperatorSession(this.config);
    const page = await this.resolvePage(context);
    const url = page.url();
    if (await isSunoLoginRequired(page, url)) {
      return { state: "login_required", detail: "Suno login required in the opened browser window." };
    }
    if (await isSunoConnected(page, url)) {
      return { state: "connected", detail: "Suno session detected in the plugin browser." };
    }
    return { state: "disconnected", detail: `Suno connect could not confirm login state at ${url}` };
  }

  async stop(): Promise<void> {
    await this.service.closeOperatorSession();
  }
}

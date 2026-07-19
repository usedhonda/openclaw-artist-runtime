import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext } from "playwright";
import { launchSunoPersistentContext } from "./sunoBrowserLaunch.js";
import { isSunoCdpEnabled, sunoCdpEndpoint, sunoChromeProfileDest, type SunoBrowserConfigView } from "./runtimeConfig.js";

const DEVTOOLS_PORT_POLL_INTERVAL_MS = 200;
const DEVTOOLS_PORT_POLL_TIMEOUT_MS = 5_000;

export interface SunoBrowserHandle {
  cdpEndpoint: string;
  context: BrowserContext;
}

interface RunningBrowser {
  cdpEndpoint: string;
  context: BrowserContext;
  // Legacy CDP attach: the browser is owned by an external process, so release must
  // never close it. A plugin-launched browser is ours to close when the last holder
  // releases.
  attached: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Plugin-owned lifecycle for the single Suno browser.
 *
 * One headful persistent context (the operator's logged-in `suno` profile) is
 * launched with --remote-debugging-port=0. Chromium writes the real port to
 * <profile>/DevToolsActivePort, which we read to derive the CDP endpoint. That one
 * launch serves both the human-assist Playwright driver (via `context`) and the
 * suno-cli captcha mint (via `cdpEndpoint`), so there is no fixed 9222 port, no manual
 * start-chrome-cdp.sh, and no second profile.
 *
 * Reference-counted: every ensureRunning() holder must call release() exactly once; the
 * browser closes once the last holder releases (idle-close). A single in-flight launch
 * promise prevents a double launch under concurrent holders. If DevToolsActivePort never
 * appears, the launch fails closed with a clear reason rather than silently succeeding.
 *
 * A legacy env override (OPENCLAW_SUNO_USE_CDP + OPENCLAW_SUNO_CDP_ENDPOINT) attaches to
 * an already-running Chrome instead of launching, and is never closed on release — the
 * advanced/emergency escape hatch that keeps the current attach lane working.
 */
export class SunoBrowserService {
  private running: RunningBrowser | undefined;
  private startInFlight: Promise<RunningBrowser> | undefined;
  private refCount = 0;

  async ensureRunning(config?: SunoBrowserConfigView, env: NodeJS.ProcessEnv = process.env): Promise<SunoBrowserHandle> {
    if (!this.running && !this.startInFlight) {
      this.startInFlight = this.launch(config, env).finally(() => {
        this.startInFlight = undefined;
      });
    }
    const running = this.running ?? (await this.startInFlight!);
    this.running = running;
    this.refCount += 1;
    return { cdpEndpoint: running.cdpEndpoint, context: running.context };
  }

  /**
   * Return a CDP endpoint IF one is available WITHOUT launching a browser: a legacy env
   * override, or a browser already running from ensureRunning. Used by the suno-cli mint
   * bridge, which must never spawn a window on boot or on a status query — only reuse a
   * browser the human-assist/create flow already brought up (or the legacy attach).
   */
  getCdpEndpoint(config?: SunoBrowserConfigView, env: NodeJS.ProcessEnv = process.env): string | undefined {
    if (isSunoCdpEnabled(config, env)) {
      return sunoCdpEndpoint(config, env);
    }
    return this.running?.cdpEndpoint;
  }

  async release(): Promise<void> {
    if (this.refCount > 0) {
      this.refCount -= 1;
    }
    if (this.refCount > 0 || !this.running) {
      return;
    }
    const running = this.running;
    this.running = undefined;
    if (running.attached) {
      // Legacy attach: leave the externally-owned Chrome running.
      return;
    }
    await running.context.close().catch(() => undefined);
  }

  private async launch(config: SunoBrowserConfigView | undefined, env: NodeJS.ProcessEnv): Promise<RunningBrowser> {
    if (isSunoCdpEnabled(config, env)) {
      const endpoint = sunoCdpEndpoint(config, env);
      const { chromium } = await import("playwright");
      const browser = await chromium.connectOverCDP(endpoint);
      const context = browser.contexts()[0] ?? (await browser.newContext());
      return { cdpEndpoint: endpoint, context, attached: true };
    }
    const profilePath = sunoChromeProfileDest(config, env);
    const context = await launchSunoPersistentContext(profilePath, {
      extraArgs: ["--remote-debugging-port=0"],
      config
    });
    const cdpEndpoint = await this.resolveCdpEndpoint(profilePath, context);
    return { cdpEndpoint, context, attached: false };
  }

  private async resolveCdpEndpoint(profilePath: string, context: BrowserContext): Promise<string> {
    const portFile = join(profilePath, "DevToolsActivePort");
    const deadline = Date.now() + DEVTOOLS_PORT_POLL_TIMEOUT_MS;
    let lastDetail = "file_not_found";
    while (Date.now() < deadline) {
      const contents = await readFile(portFile, "utf8").catch((error) => {
        lastDetail = error instanceof Error ? error.message : String(error);
        return "";
      });
      const firstLine = contents.split(/\r?\n/, 1)[0]?.trim();
      const port = firstLine ? Number(firstLine) : Number.NaN;
      if (Number.isSafeInteger(port) && port > 0) {
        return `http://127.0.0.1:${port}`;
      }
      await sleep(DEVTOOLS_PORT_POLL_INTERVAL_MS);
    }
    // Fail closed: close the just-launched context so we do not leak a browser the
    // caller can never reach, and surface a clear, non-silent reason.
    await context.close().catch(() => undefined);
    throw new Error(
      `suno_browser_devtools_port_unavailable: DevToolsActivePort not readable at ${portFile} within ${DEVTOOLS_PORT_POLL_TIMEOUT_MS}ms (${lastDetail})`
    );
  }
}

export const sunoBrowserService = new SunoBrowserService();

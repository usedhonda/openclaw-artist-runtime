import { mkdir } from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { sunoBrowserArgs, sunoBrowserChannel, sunoChromeExecutablePath, type SunoBrowserConfigView } from "./runtimeConfig.js";
import { checkSunoBrowserBinaryHealth, isSunoBrowserLaunchFailure, reinstallPlaywrightChromium } from "./sunoBinaryHealthCheck.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Resolve the rebrowser-preferred chromium launcher for the Suno profile.
//
// A fixed non-zero --remote-debugging-port keeps navigator.webdriver=false, but that
// alone does not pass Cloudflare Turnstile on suno.com/create: stock Playwright's CDP
// `Runtime.enable` still leaks an automation signal the invisible captcha reads (verified
// live 2026-07-29 — the machine submit was captcha-blocked despite webdriver=false).
// rebrowser-playwright patches that leak (REBROWSER_PATCHES_RUNTIME_FIX_MODE=addBinding);
// it is an OPTIONAL dependency, so when it is not installed we fall back to the stock
// playwright-extra launcher and the plugin still runs (with the pre-fix detection risk).
//
// We deliberately DO NOT layer puppeteer-extra-plugin-stealth here. Stealth's evasions inject
// through `Page.addScriptToEvaluateOnNewDocument` and isolated worlds, which collide with
// rebrowser-patches' addBinding Runtime fix and crash every create with
// `cannot get world (Page.createIsolatedWorld / addScriptToEvaluateOnNewDocument): session
// closed` — reproduced live 2026-07-30 on clean, unlocked profiles. The vendored suno-cli
// captcha path (vendor/suno-cli/dist/src/browser/captcha.js `loadPlaywright`) runs
// rebrowser-playwright ALONE under the same addBinding mode and passes Turnstile, so
// rebrowser's own CDP patches — not stealth — are the load-bearing evasion.
async function resolveSunoChromium(): Promise<{ launchPersistentContext: (...args: unknown[]) => Promise<BrowserContext> }> {
  if (!process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE) {
    process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE = "addBinding";
  }
  const playwrightExtra = (await import("playwright-extra")) as {
    chromium: { launchPersistentContext: (...args: unknown[]) => Promise<BrowserContext> };
    addExtra?: (launcher: unknown) => { launchPersistentContext: (...args: unknown[]) => Promise<BrowserContext> };
  };
  let chromium = playwrightExtra.chromium;
  try {
    // Indirect import so TypeScript/bundlers do not hard-require the optional package.
    const dynamicImport = new Function("specifier", "return import(specifier)") as (s: string) => Promise<unknown>;
    const rebrowser = (await dynamicImport("rebrowser-playwright")) as {
      chromium?: unknown;
      default?: { chromium?: unknown };
    };
    const rebrowserChromium = rebrowser.chromium ?? rebrowser.default?.chromium;
    if (rebrowserChromium && typeof playwrightExtra.addExtra === "function") {
      chromium = playwrightExtra.addExtra(rebrowserChromium);
    }
  } catch {
    // rebrowser-playwright is not installed; keep the stock playwright-extra launcher.
  }
  return chromium;
}

/**
 * Launch a headful, stealth persistent Chromium context on the Suno profile via the
 * rebrowser-preferred launcher (see resolveStealthChromium), with the shared
 * bundled-binary health check plus one reinstall-and-retry recovery. Extracted
 * verbatim from PlaywrightSunoDriver.openContext so the browser driver and the
 * plugin-owned SunoBrowserService both launch through one identical lane. extraArgs are
 * appended to the base sunoBrowserArgs (e.g. a fixed non-zero --remote-debugging-port to
 * expose CDP; port 0 must not be used as it sets navigator.webdriver=true).
 */
export async function launchSunoPersistentContext(
  profilePath: string,
  options: { extraArgs?: string[]; config?: SunoBrowserConfigView } = {}
): Promise<BrowserContext> {
  const chromium = await resolveSunoChromium();
  await mkdir(profilePath, { recursive: true });
  const executablePath = sunoChromeExecutablePath(options.config);
  const channel = executablePath ? undefined : sunoBrowserChannel(options.config);
  const usesBundledChromium = !executablePath && !channel;
  const launchOptions = {
    headless: false,
    ...(executablePath ? { executablePath } : {}),
    ...(channel ? { channel } : {}),
    args: [...sunoBrowserArgs(), ...(options.extraArgs ?? [])],
    ignoreDefaultArgs: ["--enable-automation"]
  };
  if (usesBundledChromium) {
    const health = await checkSunoBrowserBinaryHealth().catch((error) => ({
      ok: false,
      detail: `playwright_chromium_health_check_failed: ${errorMessage(error)}`,
      checkedAt: new Date().toISOString()
    }));
    if (!health.ok) {
      console.warn(`[artist-runtime] ${health.detail ?? "playwright_chromium_binary_unhealthy"}; reinstalling Chromium`);
      await reinstallPlaywrightChromium("playwright_chromium_health_check_failed");
    }
  }
  try {
    return await chromium.launchPersistentContext(profilePath, launchOptions);
  } catch (error) {
    if (!usesBundledChromium || !isSunoBrowserLaunchFailure(error)) {
      throw error;
    }
    console.warn(`[artist-runtime] playwright Chromium launch failed; reinstalling and retrying once: ${errorMessage(error)}`);
    await reinstallPlaywrightChromium("playwright_chromium_launch_failed");
    return await chromium.launchPersistentContext(profilePath, launchOptions);
  }
}

import { mkdir } from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { sunoBrowserArgs, sunoBrowserChannel, sunoChromeExecutablePath, type SunoBrowserConfigView } from "./runtimeConfig.js";
import { checkSunoBrowserBinaryHealth, isSunoBrowserLaunchFailure, reinstallPlaywrightChromium } from "./sunoBinaryHealthCheck.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Launch a headful, stealth persistent Chromium context on the Suno profile with the
 * shared bundled-binary health check plus one reinstall-and-retry recovery. Extracted
 * verbatim from PlaywrightSunoDriver.openContext so the browser driver and the
 * plugin-owned SunoBrowserService both launch through one identical lane. extraArgs are
 * appended to the base sunoBrowserArgs (e.g. --remote-debugging-port=0 to expose CDP).
 */
export async function launchSunoPersistentContext(
  profilePath: string,
  options: { extraArgs?: string[]; config?: SunoBrowserConfigView } = {}
): Promise<BrowserContext> {
  const { chromium } = await import("playwright-extra");
  const stealth = (await import("puppeteer-extra-plugin-stealth")).default;
  chromium.use(stealth());
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

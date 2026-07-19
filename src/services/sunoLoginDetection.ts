import type { Page } from "playwright";

/**
 * Shared Suno login/connected detection heuristics. Extracted from
 * PlaywrightSunoDriver.probe so the browser driver and the plugin-owned
 * SunoBrowserService connect path judge login state identically.
 */

export async function isSunoLoginRequired(page: Page, currentUrl: string): Promise<boolean> {
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

export async function isSunoConnected(page: Page, currentUrl: string): Promise<boolean> {
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

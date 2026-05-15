#!/usr/bin/env node
// Manual operator action only.
// Do not run from CI, unattended agents, or autopilot.

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_SUNO_PROFILE_PATH = ".openclaw-browser-profiles/suno";
const SUNO_CREATE_URL = "https://suno.com/create";
const SUNO_BROWSER_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--password-store=basic"
];

const profilePath = resolve(process.argv[2] ?? DEFAULT_SUNO_PROFILE_PATH);

async function main() {
  const { chromium } = await import("playwright-extra");
  const stealth = (await import("puppeteer-extra-plugin-stealth")).default;
  chromium.use(stealth());

  await mkdir(profilePath, { recursive: true });

  const executablePath = process.env.OPENCLAW_SUNO_CHROME_EXECUTABLE?.trim();
  const channel = executablePath
    ? undefined
    : process.env.OPENCLAW_SUNO_BROWSER_CHANNEL?.trim().toLowerCase() === "chrome"
      ? "chrome"
      : undefined;
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    ...(executablePath ? { executablePath } : {}),
    ...(channel ? { channel } : {}),
    args: SUNO_BROWSER_ARGS,
    ignoreDefaultArgs: ["--enable-automation"]
  });
  const page = context.pages()[0] ?? await context.newPage();

  console.log("OpenClaw Suno login lane: manual operator login only.");
  console.log(`Profile path: ${profilePath}`);
  console.log("Close the browser window after Suno login completes.");

  await page.goto(SUNO_CREATE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20_000
  });

  const browser = context.browser();
  if (!browser) {
    await context.close().catch(() => undefined);
    throw new Error("persistent browser handle is unavailable");
  }
  await new Promise((resolvePromise) => {
    const finish = () => resolvePromise(undefined);
    browser.once("disconnected", finish);

    const closeAndFinish = async () => {
      await context.close().catch(() => undefined);
      finish();
    };

    process.once("SIGINT", closeAndFinish);
    process.once("SIGTERM", closeAndFinish);
  });

  console.log(`login cookie saved to ${profilePath}`);
}

main().catch((error) => {
  console.error(`openclaw-suno-login failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

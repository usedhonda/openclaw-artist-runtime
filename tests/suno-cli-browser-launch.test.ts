import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { launchPersistentBrowser } from "../vendor/suno-cli/dist/src/browser/captcha.js";

describe("vendored suno-cli browser launch", () => {
  it("uses a basic password store without changing the profile launch settings", async () => {
    const profileDir = mkdtempSync(join(tmpdir(), "artist-runtime-suno-cli-browser-"));
    const launchPersistentContext = vi.fn(async () => ({ close: vi.fn(async () => undefined) }));
    const playwright = {
      chromium: { launchPersistentContext }
    };
    const viewport = { width: 1440, height: 900 };

    await launchPersistentBrowser({ profileDir, headless: false, viewport }, playwright);

    expect(launchPersistentContext).toHaveBeenCalledWith(profileDir, {
      headless: false,
      viewport,
      locale: "en-US",
      args: ["--password-store=basic"],
      ignoreDefaultArgs: ["--enable-automation"]
    });
  });
});

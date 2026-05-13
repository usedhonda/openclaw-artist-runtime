import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultArtistRuntimeConfig } from "../src/config/defaultConfig";
import { SunoBrowserWorker, type SunoBrowserDriver } from "../src/services/sunoBrowserWorker";

const { spawnMock, chromiumMock, launchPersistentContextMock, stealthPluginMock, stealthResult } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  chromiumMock: {
    use: vi.fn(),
    launchPersistentContext: vi.fn()
  },
  launchPersistentContextMock: vi.fn(),
  stealthPluginMock: vi.fn(),
  stealthResult: { name: "stealth-plugin" }
}));

chromiumMock.launchPersistentContext = launchPersistentContextMock;

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("playwright-extra", () => ({
  chromium: chromiumMock
}));

vi.mock("puppeteer-extra-plugin-stealth", () => ({
  default: stealthPluginMock
}));

const envKeys = ["OPENCLAW_SUNO_LIVE", "OPENCLAW_SUNO_CHROME_PROFILE_SOURCE", "OPENCLAW_SUNO_CHROME_PROFILE_DEST"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function createProbeContext({
  url = "https://suno.com/sign-in",
  passwordFieldCount = 1
}: {
  url?: string;
  passwordFieldCount?: number;
} = {}) {
  const page = {
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    url: vi.fn(() => url),
    locator: vi.fn((selector: string) => ({
      count: vi.fn(async () => {
        if (selector === "input[type='password']") {
          return passwordFieldCount;
        }
        return 0;
      })
    }))
  };
  const context = {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined)
  };
  return { page, context };
}

function connectedDriver(): SunoBrowserDriver {
  return {
    async probe() {
      return { state: "connected" };
    }
  };
}

describe("Suno driver selection", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    chromiumMock.use.mockReset();
    launchPersistentContextMock.mockReset();
    stealthPluginMock.mockReset();
    stealthPluginMock.mockReturnValue(stealthResult);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("keeps the default mock path when no driver mode is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-driver-default-"));
    const worker = new SunoBrowserWorker(root);

    const started = await worker.start();

    expect(started.state).toBe("login_required");
    expect(started.pendingAction).toBe("operator_login_required");
    expect(launchPersistentContextMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("selects the playwright driver when config requests it", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-driver-playwright-"));
    const { context } = createProbeContext();
    launchPersistentContextMock.mockResolvedValue(context);

    const worker = new SunoBrowserWorker(root, {
      config: {
        ...defaultArtistRuntimeConfig,
        music: {
          ...defaultArtistRuntimeConfig.music,
          suno: {
            ...defaultArtistRuntimeConfig.music.suno,
            driver: "playwright",
            submitMode: "skip"
          }
        }
      }
    });

    const started = await worker.start();

    expect(started.state).toBe("login_required");
    expect(launchPersistentContextMock).toHaveBeenCalledWith(".openclaw-browser-profiles/suno", {
      headless: false,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled", "--password-store=basic"],
      ignoreDefaultArgs: ["--enable-automation"]
    });
    expect(chromiumMock.use).toHaveBeenCalledWith(stealthResult);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("prefers an explicit driver over config-based selection", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-driver-explicit-"));
    const worker = new SunoBrowserWorker(root, {
      config: {
        ...defaultArtistRuntimeConfig,
        music: {
          ...defaultArtistRuntimeConfig.music,
          suno: {
            ...defaultArtistRuntimeConfig.music.suno,
            driver: "playwright",
            submitMode: "skip"
          }
        }
      }
    });

    const started = await worker.start({
      driver: connectedDriver()
    });

    expect(started.state).toBe("connected");
    expect(started.connected).toBe(true);
    expect(launchPersistentContextMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // Plan v10.33: profile copy 路線を deprecate (`project_plan_v9_24b_profile_copy_dead_end`)。
  // 御大主 Chrome からの copy ではなく `.openclaw-browser-profiles/suno` に
  // `scripts/openclaw-suno-login.mjs` で手動 sign in する運用に移行した。
  // 旧 "copies the operator Chrome profile" test はこの commit で削除。

});

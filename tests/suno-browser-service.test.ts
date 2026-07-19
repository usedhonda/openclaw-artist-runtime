import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  playwrightChromiumMock,
  playwrightExtraChromiumMock,
  connectOverCDPMock,
  launchPersistentContextMock,
  stealthPluginMock,
  binaryHealthMock,
  reinstallChromiumMock,
  launchFailureMock
} = vi.hoisted(() => ({
  playwrightChromiumMock: { connectOverCDP: vi.fn() },
  playwrightExtraChromiumMock: { use: vi.fn(), launchPersistentContext: vi.fn() },
  connectOverCDPMock: vi.fn(),
  launchPersistentContextMock: vi.fn(),
  stealthPluginMock: vi.fn(),
  binaryHealthMock: vi.fn(),
  reinstallChromiumMock: vi.fn(),
  launchFailureMock: vi.fn()
}));

playwrightChromiumMock.connectOverCDP = connectOverCDPMock;
playwrightExtraChromiumMock.launchPersistentContext = launchPersistentContextMock;

vi.mock("playwright", () => ({ chromium: playwrightChromiumMock }));
vi.mock("playwright-extra", () => ({ chromium: playwrightExtraChromiumMock }));
vi.mock("puppeteer-extra-plugin-stealth", () => ({ default: stealthPluginMock }));
vi.mock("../src/services/sunoBinaryHealthCheck", () => ({
  checkSunoBrowserBinaryHealth: binaryHealthMock,
  reinstallPlaywrightChromium: reinstallChromiumMock,
  isSunoBrowserLaunchFailure: launchFailureMock
}));

import { SunoBrowserService } from "../src/services/sunoBrowserService";

const envKeys = ["OPENCLAW_SUNO_USE_CDP", "OPENCLAW_SUNO_CDP_ENDPOINT", "OPENCLAW_SUNO_CHROME_PROFILE_DEST"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function makeContext() {
  return { close: vi.fn(async () => undefined), pages: vi.fn(() => []), newPage: vi.fn(async () => ({})) };
}

let tempProfiles: string[] = [];

async function profileWithPort(port: string | undefined): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "artist-runtime-suno-svc-"));
  tempProfiles.push(dir);
  if (port !== undefined) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "DevToolsActivePort"), `${port}\n/devtools/browser/abc\n`, "utf8");
  }
  return dir;
}

describe("SunoBrowserService", () => {
  beforeEach(() => {
    connectOverCDPMock.mockReset();
    launchPersistentContextMock.mockReset();
    binaryHealthMock.mockReset();
    reinstallChromiumMock.mockReset();
    launchFailureMock.mockReset();
    playwrightExtraChromiumMock.use.mockReset();
    stealthPluginMock.mockReset().mockReturnValue({ name: "stealth" });
    binaryHealthMock.mockResolvedValue({ ok: true, checkedAt: "2026-07-18T00:00:00.000Z" });
    reinstallChromiumMock.mockResolvedValue(undefined);
    launchFailureMock.mockReturnValue(false);
    tempProfiles = [];
    for (const key of envKeys) delete process.env[key];
  });

  afterEach(async () => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all(tempProfiles.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("launches a persistent context and derives the CDP endpoint from DevToolsActivePort", async () => {
    const profile = await profileWithPort("54321");
    process.env.OPENCLAW_SUNO_CHROME_PROFILE_DEST = profile;
    const context = makeContext();
    launchPersistentContextMock.mockResolvedValue(context);
    const service = new SunoBrowserService();

    const handle = await service.ensureRunning();

    expect(handle.cdpEndpoint).toBe("http://127.0.0.1:54321");
    expect(handle.context).toBe(context);
    expect(connectOverCDPMock).not.toHaveBeenCalled();
    const [launchedPath, launchOptions] = launchPersistentContextMock.mock.calls[0];
    expect(launchedPath).toBe(profile);
    expect(launchOptions.args).toContain("--remote-debugging-port=0");
  });

  it("only launches once under concurrent ensureRunning (single in-flight)", async () => {
    const profile = await profileWithPort("40000");
    process.env.OPENCLAW_SUNO_CHROME_PROFILE_DEST = profile;
    const context = makeContext();
    launchPersistentContextMock.mockResolvedValue(context);
    const service = new SunoBrowserService();

    const [a, b] = await Promise.all([service.ensureRunning(), service.ensureRunning()]);

    expect(a.cdpEndpoint).toBe("http://127.0.0.1:40000");
    expect(b.cdpEndpoint).toBe("http://127.0.0.1:40000");
    expect(launchPersistentContextMock).toHaveBeenCalledTimes(1);
  });

  it("closes the browser only after the last holder releases (ref-counted idle-close)", async () => {
    const profile = await profileWithPort("40001");
    process.env.OPENCLAW_SUNO_CHROME_PROFILE_DEST = profile;
    const context = makeContext();
    launchPersistentContextMock.mockResolvedValue(context);
    const service = new SunoBrowserService();

    await service.ensureRunning();
    await service.ensureRunning();
    await service.release();
    expect(context.close).not.toHaveBeenCalled();
    await service.release();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("exposes the running endpoint to getCdpEndpoint without a separate launch", async () => {
    const profile = await profileWithPort("40002");
    process.env.OPENCLAW_SUNO_CHROME_PROFILE_DEST = profile;
    const context = makeContext();
    launchPersistentContextMock.mockResolvedValue(context);
    const service = new SunoBrowserService();

    expect(service.getCdpEndpoint()).toBeUndefined();
    await service.ensureRunning();
    expect(service.getCdpEndpoint()).toBe("http://127.0.0.1:40002");
    await service.release();
    expect(service.getCdpEndpoint()).toBeUndefined();
    expect(launchPersistentContextMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed and closes the context when DevToolsActivePort never appears", async () => {
    const profile = await profileWithPort(undefined);
    process.env.OPENCLAW_SUNO_CHROME_PROFILE_DEST = profile;
    const context = makeContext();
    launchPersistentContextMock.mockResolvedValue(context);
    const service = new SunoBrowserService();

    await expect(service.ensureRunning()).rejects.toThrow(/suno_browser_devtools_port_unavailable/);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("attaches over CDP and never launches or closes under the legacy env override", async () => {
    process.env.OPENCLAW_SUNO_USE_CDP = "on";
    process.env.OPENCLAW_SUNO_CDP_ENDPOINT = "http://127.0.0.1:9333";
    const context = makeContext();
    connectOverCDPMock.mockResolvedValue({ contexts: () => [context], newContext: vi.fn(async () => context) });
    const service = new SunoBrowserService();

    const handle = await service.ensureRunning();

    expect(handle.cdpEndpoint).toBe("http://127.0.0.1:9333");
    expect(connectOverCDPMock).toHaveBeenCalledWith("http://127.0.0.1:9333");
    expect(launchPersistentContextMock).not.toHaveBeenCalled();
    expect(service.getCdpEndpoint()).toBe("http://127.0.0.1:9333");
    await service.release();
    expect(context.close).not.toHaveBeenCalled();
  });
});

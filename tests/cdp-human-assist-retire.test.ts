import { describe, expect, it } from "vitest";
import { CdpHumanAssistDriver } from "../src/services/cdpHumanAssistDriver";
import type { SunoBrowserService } from "../src/services/sunoBrowserService";

function makeDriver() {
  const calls = { pageClosed: 0, released: 0, shutdown: 0 };
  const page = { close: async () => { calls.pageClosed += 1; } };
  const service = {
    release: async () => { calls.released += 1; },
    shutdownIfLaunched: async () => { calls.shutdown += 1; }
  } as unknown as SunoBrowserService;
  const driver = new CdpHumanAssistDriver({
    payload: { songName: "Song" },
    songId: "song-1",
    title: "Song",
    runId: "run-1",
    service
  } as never) as CdpHumanAssistDriver & { page?: unknown; ownsPage?: boolean };
  driver.page = page;
  driver.ownsPage = true;
  return { driver, calls };
}

describe("human-assist create surface retirement", () => {
  it("closes the create page and the launched browser once the run succeeds", async () => {
    const { driver, calls } = makeDriver();

    await driver.retireCreateSurface();
    await driver.close();

    expect(calls).toEqual({ pageClosed: 1, released: 1, shutdown: 1 });
  });

  it("leaves the browser running when the run did not reach success", async () => {
    const { driver, calls } = makeDriver();

    await driver.close();

    expect(calls).toEqual({ pageClosed: 1, released: 1, shutdown: 0 });
  });
});

describe("SunoBrowserService.shutdownIfLaunched", () => {
  it("closes a launched idle browser, and never an attached or still-held one", async () => {
    const { SunoBrowserService } = await import("../src/services/sunoBrowserService");
    const closes = { launched: 0, attached: 0, held: 0 };

    const launched = new SunoBrowserService() as unknown as { running: unknown; shutdownIfLaunched(): Promise<void> };
    launched.running = { attached: false, context: { close: async () => { closes.launched += 1; } } };
    await launched.shutdownIfLaunched();

    const attached = new SunoBrowserService() as unknown as { running: unknown; shutdownIfLaunched(): Promise<void> };
    attached.running = { attached: true, context: { close: async () => { closes.attached += 1; } } };
    await attached.shutdownIfLaunched();

    const held = new SunoBrowserService() as unknown as { running: unknown; refCount: number; shutdownIfLaunched(): Promise<void> };
    held.running = { attached: false, context: { close: async () => { closes.held += 1; } } };
    held.refCount = 1;
    await held.shutdownIfLaunched();

    expect(closes).toEqual({ launched: 1, attached: 0, held: 0 });
  });
});

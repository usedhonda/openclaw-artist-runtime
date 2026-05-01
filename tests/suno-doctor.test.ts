import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatSunoDoctorResult, runSunoDoctor } from "../src/services/sunoDoctor";

const { chromiumMock, connectOverCDPMock } = vi.hoisted(() => ({
  chromiumMock: { connectOverCDP: vi.fn() },
  connectOverCDPMock: vi.fn()
}));

chromiumMock.connectOverCDP = connectOverCDPMock;

vi.mock("playwright", () => ({ chromium: chromiumMock }));

function locatorMock(selector: string, events: string[]) {
  return {
    first: () => ({
      waitFor: vi.fn(async () => events.push(`wait:${selector}`)),
      isVisible: vi.fn(async () => {
        events.push(`visible:${selector}`);
        return true;
      }),
      isEditable: vi.fn(async () => {
        events.push(`editable:${selector}`);
        return true;
      }),
      click: vi.fn(async () => events.push(`click:${selector}`))
    })
  };
}

function pageMock(events: string[]) {
  return {
    url: vi.fn(() => "https://suno.com/create"),
    goto: vi.fn(async (url: string) => events.push(`goto:${url}`)),
    waitForLoadState: vi.fn(async () => undefined),
    locator: vi.fn((selector: string) => locatorMock(selector, events))
  };
}

describe("Suno doctor", () => {
  beforeEach(() => {
    connectOverCDPMock.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
  });

  it("checks CDP, attaches, opens create page, and verifies writable fields without submit", async () => {
    const events: string[] = [];
    const page = pageMock(events);
    const browser = {
      contexts: vi.fn(() => [{
        pages: vi.fn(() => [page]),
        newPage: vi.fn(async () => page)
      }]),
      newContext: vi.fn(),
      disconnect: vi.fn()
    };
    connectOverCDPMock.mockResolvedValue(browser);

    const result = await runSunoDoctor({ cdpEndpoint: "http://127.0.0.1:9333", timeoutMs: 100 });

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:9333/json/version", expect.any(Object));
    expect(connectOverCDPMock).toHaveBeenCalledWith("http://127.0.0.1:9333");
    expect(page.goto).toHaveBeenCalledWith("https://suno.com/create", {
      waitUntil: "domcontentloaded",
      timeout: 100
    });
    expect(events.some((event) => /Create song|submit/i.test(event))).toBe(false);
  });

  it("fails before Playwright attach when CDP version is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));

    const result = await runSunoDoctor({ cdpEndpoint: "http://127.0.0.1:9444", timeoutMs: 100 });

    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ name: "cdp_version", status: "fail" });
    expect(connectOverCDPMock).not.toHaveBeenCalled();
    expect(formatSunoDoctorResult(result)).toContain("Action: start Chrome");
  });
});

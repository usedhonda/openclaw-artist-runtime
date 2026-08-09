import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectOverCDP } = vi.hoisted(() => ({ connectOverCDP: vi.fn() }));

vi.mock("rebrowser-playwright", () => ({ chromium: { connectOverCDP } }));

describe("suno-cli browser login CDP capture", () => {
  beforeEach(() => {
    connectOverCDP.mockReset();
  });

  it("attaches only to a loopback endpoint and stores the captured session", async () => {
    const page = {
      url: vi.fn(() => "https://suno.com/create"),
      evaluate: vi.fn(async () => "")
    };
    const browser = {
      contexts: vi.fn(() => [
        {
          pages: vi.fn(() => [page]),
          cookies: vi.fn(async () => [{ domain: ".suno.com", name: "__" + "session", value: "fixture-session" }])
        }
      ]),
      close: vi.fn(async () => undefined)
    };
    connectOverCDP.mockResolvedValue(browser);

    const { loginCommand } = await import("../vendor/suno-cli/dist/src/commands/login.js");
    const { captureBrowserSession } = await import("../vendor/suno-cli/dist/src/browser/login.js");
    const dataDir = await mkdtemp(join(tmpdir(), "suno-cli-login-cdp-"));
    const sessionFile = join(dataDir, "session.json");
    const result = await loginCommand({
      sessionFile,
      profileDir: join(dataDir, "browser-profile"),
      capturer: { capture: (input) => captureBrowserSession({ ...input, cdpEndpoint: "http://127.0.0.1:9222" }) }
    });

    expect(result).toBe(0);
    expect(connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:9222");
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(sessionFile, "utf8")).cookie).toBe(
      ["__" + "session", "fixture-session"].join("=")
    );
  });

  it("rejects a non-loopback endpoint before connecting or falling back", async () => {
    const { captureBrowserSession } = await import("../vendor/suno-cli/dist/src/browser/login.js");

    await expect(captureBrowserSession({
      profileDir: "/not-read",
      loginUrl: "https://suno.com/",
      timeoutMs: 10,
      cdpEndpoint: "https://example.com:9222"
    })).rejects.toThrow("loopback HTTP origin");
    expect(connectOverCDP).not.toHaveBeenCalled();
  });

  it("fails the explicit CDP lane without opening a persistent-profile fallback", async () => {
    connectOverCDP.mockRejectedValue(new Error("connection refused"));
    const { captureBrowserSession } = await import("../vendor/suno-cli/dist/src/browser/login.js");

    await expect(captureBrowserSession({
      profileDir: "/not-read",
      loginUrl: "https://suno.com/",
      timeoutMs: 10,
      cdpEndpoint: "http://127.0.0.1:9222"
    })).rejects.toThrow("connection refused");
    expect(connectOverCDP).toHaveBeenCalledTimes(1);
  });

  it("closes the attached browser when CDP has no context", async () => {
    const browser = {
      contexts: vi.fn(() => []),
      close: vi.fn(async () => undefined)
    };
    connectOverCDP.mockResolvedValue(browser);
    const { captureBrowserSession } = await import("../vendor/suno-cli/dist/src/browser/login.js");

    await expect(captureBrowserSession({
      profileDir: "/not-read",
      loginUrl: "https://suno.com/",
      timeoutMs: 10,
      cdpEndpoint: "http://127.0.0.1:9222"
    })).rejects.toThrow("has no browser context");
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});

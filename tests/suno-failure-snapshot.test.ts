import { existsSync, mkdtempSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { captureSunoFailure, resolveSunoFailureLogsDir } from "../src/services/sunoFailureSnapshot";

describe("Suno failure snapshot", () => {
  it("writes screenshot, HTML, and URL files with the failure reason", async () => {
    const logsDir = mkdtempSync(join(tmpdir(), "artist-runtime-suno-snapshot-"));
    const page = {
      url: vi.fn(() => "https://suno.com/create"),
      screenshot: vi.fn(async ({ path }: { path: string }) => {
        await writeFile(path, "png");
      }),
      content: vi.fn(async () => "<html><body>missing lyrics button</body></html>")
    };

    const snapshot = await captureSunoFailure(page as never, {
      logsDir,
      reason: "playwright_create_dom_missing",
      songId: "song-004",
      runId: "run-1"
    });
    const files = await readdir(logsDir);

    expect(snapshot.url).toBe("https://suno.com/create");
    expect(snapshot.screenshotPath).toContain("playwright_create_dom_missing");
    expect(snapshot.htmlPath).toContain("playwright_create_dom_missing");
    expect(existsSync(snapshot.screenshotPath ?? "")).toBe(true);
    expect(await readFile(snapshot.htmlPath ?? "", "utf8")).toContain("missing lyrics button");
    expect(files.some((file) => file.endsWith(".url.txt"))).toBe(true);
  });

  it("returns an empty snapshot when snapshot capture itself fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const page = {
      url: vi.fn(() => "https://suno.com/create"),
      screenshot: vi.fn(async () => {
        throw new Error("disk full");
      }),
      content: vi.fn(async () => "<html></html>")
    };

    const snapshot = await captureSunoFailure(page as never, {
      logsDir: mkdtempSync(join(tmpdir(), "artist-runtime-suno-snapshot-fail-")),
      reason: "playwright_create_timeout"
    });

    expect(snapshot).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Suno failure snapshot skipped"));
    warn.mockRestore();
  });

  it("places workspace roots named workspace under their parent logs directory", () => {
    expect(resolveSunoFailureLogsDir("/tmp/openclaw/workspace")).toBe("/tmp/openclaw/logs");
  });
});

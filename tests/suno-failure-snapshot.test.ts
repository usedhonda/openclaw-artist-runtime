import { existsSync, mkdtempSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { captureSunoFailure, resolveSunoFailureLogsDir } from "../src/services/sunoFailureSnapshot";
import { sanitizeSunoDiagnosticText, sanitizeSunoDiagnosticUrl } from "../src/services/sunoDiagnosticSafety";

describe("Suno failure snapshot", () => {
  it("writes a screenshot and secret-safe diagnostics without persisting the page HTML or query", async () => {
    const logsDir = mkdtempSync(join(tmpdir(), "artist-runtime-suno-snapshot-"));
    const page = {
      url: vi.fn(() => "https://suno.com/create?__clerk_handshake=secret-value#fragment"),
      title: vi.fn(async () => "Suno | AI Music"),
      screenshot: vi.fn(async ({ path }: { path: string }) => {
        await writeFile(path, "png");
      }),
      content: vi.fn(async () => "<html><script>secret-value</script><body>missing lyrics button</body></html>"),
      locator: vi.fn(() => ({ count: vi.fn(async () => 0) }))
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
    expect(snapshot.diagnosticsPath).toContain("playwright_create_dom_missing");
    expect(existsSync(snapshot.screenshotPath ?? "")).toBe(true);
    const diagnostics = await readFile(snapshot.diagnosticsPath ?? "", "utf8");
    expect(diagnostics).toContain("Suno | AI Music");
    expect(diagnostics).not.toContain("secret-value");
    expect(files.some((file) => file.endsWith(".html"))).toBe(false);
    expect(files.some((file) => file.endsWith(".url.txt"))).toBe(true);
    const urlFile = files.find((file) => file.endsWith(".url.txt"));
    expect(await readFile(join(logsDir, urlFile ?? ""), "utf8")).toBe("https://suno.com/create\n");
    expect(page.content).not.toHaveBeenCalled();
  });

  it("removes query, fragment, and sensitive values from diagnostic strings", () => {
    expect(sanitizeSunoDiagnosticUrl("https://suno.com/create?__clerk_handshake=secret#done")).toBe(
      "https://suno.com/create"
    );
    expect(
      sanitizeSunoDiagnosticText(
        "navigation failed at https://suno.com/create?__clerk_handshake=secret-value and token=other-secret"
      )
    ).toBe("navigation failed at https://suno.com/create and token=<redacted>");
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

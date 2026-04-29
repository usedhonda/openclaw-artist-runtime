import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSunoChromeProfileCopy } from "../src/services/sunoChromeProfileCopy";

describe("Suno Chrome profile copy", () => {
  it("copies login-relevant Chrome profile files into a dedicated Playwright profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-copy-"));
    const source = join(root, "Chrome", "Default");
    const dest = join(root, ".openclaw-browser-profiles", "suno");
    await mkdir(join(source, "Local Storage"), { recursive: true });
    writeFileSync(join(source, "Cookies"), "cookie-state", "utf8");
    writeFileSync(join(source, "Local Storage", "leveldb"), "storage-state", "utf8");

    const result = await ensureSunoChromeProfileCopy(source, dest);

    expect(result.status).toBe("copied");
    expect(result.copied).toContain("Cookies");
    expect(readFileSync(join(dest, "Default", "Cookies"), "utf8")).toBe("cookie-state");
    expect(readFileSync(join(dest, "Default", "Local Storage", "leveldb"), "utf8")).toBe("storage-state");
  });

  it("skips copy when the dedicated profile already exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-skip-"));
    const source = join(root, "Chrome", "Default");
    const dest = join(root, ".openclaw-browser-profiles", "suno");
    await mkdir(join(source), { recursive: true });
    await mkdir(join(dest, "Default"), { recursive: true });
    writeFileSync(join(source, "Cookies"), "new-cookie", "utf8");
    writeFileSync(join(dest, "Default", "Cookies"), "existing-cookie", "utf8");

    const result = await ensureSunoChromeProfileCopy(source, dest);

    expect(result.status).toBe("skipped");
    expect(readFileSync(join(dest, "Default", "Cookies"), "utf8")).toBe("existing-cookie");
  });

  it("does not throw when the operator source profile is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-missing-source-"));
    const dest = join(root, ".openclaw-browser-profiles", "suno");

    const result = await ensureSunoChromeProfileCopy(join(root, "missing"), dest);

    expect(result.status).toBe("source_missing");
    expect(existsSync(join(dest, "Default", "Cookies"))).toBe(false);
  });
});

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureBackupOnce } from "../src/services/personaBackup";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-persona-backup-"));
}

describe("persona backup helper", () => {
  it("creates one backup per file for a session and skips repeats", async () => {
    const root = makeRoot();
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "ARTIST.md"), "artist v1", "utf8");

    const first = await ensureBackupOnce(root, "session-a", "ARTIST");
    await writeFile(join(root, "ARTIST.md"), "artist v2", "utf8");
    const second = await ensureBackupOnce(root, "session-a", "ARTIST");

    expect(first).toMatch(/ARTIST\.md\.backup-\d{8}T\d{6}Z$/);
    expect(second).toBeNull();
    await expect(stat(first ?? "")).resolves.toBeTruthy();
    await expect(readFile(first ?? "", "utf8")).resolves.toBe("artist v1");
  });

  it("creates a new backup for a different session id", async () => {
    const root = makeRoot();
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "SOUL.md"), "soul v1", "utf8");

    const first = await ensureBackupOnce(root, "session-a", "SOUL");
    await writeFile(join(root, "SOUL.md"), "soul v2", "utf8");
    const second = await ensureBackupOnce(root, "session-b", "SOUL");

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    await expect(readFile(second ?? "", "utf8")).resolves.toBe("soul v2");
  });
});

import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function oldDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const old = new Date("2026-01-01T00:00:00.000Z");
  await utimes(path, old, old);
}

describe("runtime cleanup scripts", () => {
  it("lists cleanup candidates as JSON without deleting during dry-run", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-cleanup-json-"));
    const runDir = join(root, "runtime", "suno", "run-old");
    await oldDir(runDir);

    const output = execFileSync("bash", ["scripts/cleanup-runtime.sh", "--root", root, "--days", "1", "--dry-run", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.dryRun).toBe(true);
    expect(parsed.deleted).toBe(0);
    expect(parsed.candidates).toEqual([runDir]);
    expect((await stat(runDir)).isDirectory()).toBe(true);
  });

  it("prints runtime disk usage as JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-disk-usage-"));
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(join(root, "runtime", "suno", "asset.txt"), "audio", "utf8");

    const output = execFileSync("bash", ["scripts/runtime-disk-usage.sh", "--root", root, "--json"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.runtime).toBe(join(root, "runtime"));
    expect(parsed.entries[0]).toMatchObject({
      path: join(root, "runtime", "suno")
    });
  });

  it("declares retention candidates without deleting in dry-run mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-retention-"));
    const runDir = join(root, "runtime", "suno", "run-old");
    const archive = join(root, "songs", "song-001", "social", "social-publish.archive.jsonl");
    await oldDir(runDir);
    await mkdir(join(root, "songs", "song-001", "social"), { recursive: true });
    await writeFile(archive, "{}", "utf8");
    await utimes(archive, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));

    const output = execFileSync("bash", ["scripts/runtime-retention-enforce.sh", "--root", root, "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(output).toContain("suno run artifacts: 30 days");
    expect(output).toContain(runDir);
    expect(output).toContain(archive);
    expect(await readFile(archive, "utf8")).toBe("{}");
  });
});

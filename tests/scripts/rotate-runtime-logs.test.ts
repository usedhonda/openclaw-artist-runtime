import { mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("rotate-runtime-logs.sh", () => {
  it("archives old runtime logs and recreates empty append targets", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-log-rotate-"));
    const logPath = join(root, "runtime", "gateway.log");
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(logPath, "old log line\n", "utf8");
    const old = new Date("2026-01-01T00:00:00.000Z");
    await utimes(logPath, old, old);

    const output = execFileSync("bash", ["scripts/rotate-runtime-logs.sh", "--root", root, "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, OPENCLAW_LOG_MAX_AGE_DAYS: "1" }
    });
    const parsed = JSON.parse(output) as { rotated: number; candidates: string[]; archiveDir: string };

    expect(parsed.rotated).toBe(1);
    expect(parsed.candidates).toEqual([logPath]);
    expect(await readFile(logPath, "utf8")).toBe("");
    const archived = await readdir(parsed.archiveDir);
    expect(archived).toEqual(["gateway.log"]);
    expect((await stat(join(parsed.archiveDir, "gateway.log"))).size).toBeGreaterThan(0);
  });
});

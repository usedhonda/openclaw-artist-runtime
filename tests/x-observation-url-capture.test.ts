import { mkdtempSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectObservations, readObservationsReport } from "../src/services/xObservationCollector";

const FIXED_NOW = new Date("2026-05-01T00:00:00.000Z");

function fakeRunner(stdout: string) {
  return async () => ({ stdout, stderr: "" });
}

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-x-url-capture-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  return root;
}

describe("x observation URL capture", () => {
  it("stores observation text with author, URL, and posted time when bird output includes them", async () => {
    const root = await workspace();
    const result = await collectObservations(root, {
      now: FIXED_NOW,
      personaText: "redevelopment city",
      runner: fakeRunner("@city_watcher redevelopment closed another small venue https://x.com/city_watcher/status/1234567890 2026-05-01T15:00:00.000Z")
    });

    const written = await readFile(result.path, "utf8");
    expect(result.status).toBe("collected");
    expect(written).toContain("- text: \"@city_watcher redevelopment closed another small venue\"");
    expect(written).toContain("author: \"city_watcher\"");
    expect(written).toContain("url: \"https://x.com/city_watcher/status/1234567890\"");
    expect(written).toContain("postedAt: \"2026-05-01T15:00:00.000Z\"");
  });
});

describe("x observation discard rules (short URL / missing author / missing postedAt)", () => {
  it("discards entries with short URL (t.co) only and no full x.com URL", async () => {
    const root = await workspace();
    const stdout = [
      `Indie Pulse is growing rapidly towards being the ultimate independent music platform https://t.co/4sNbGtyXmL`
    ].join("\n");

    await collectObservations(root, { now: FIXED_NOW, runner: fakeRunner(stdout) });

    const report = await readObservationsReport(root, FIXED_NOW);
    expect(report.entries).toHaveLength(0);
  });

  it("discards entries missing author tag (no @author and URL has no author segment)", async () => {
    const root = await workspace();
    const stdout = [
      `random observation without author https://x.com/_/status/1111111111111111111 2026-05-09T07:30:00.000Z`
    ].join("\n");

    await collectObservations(root, { now: FIXED_NOW, runner: fakeRunner(stdout) });

    const report = await readObservationsReport(root, FIXED_NOW);
    const noAuthor = report.entries.filter((entry) => !entry.author);
    expect(noAuthor).toHaveLength(0);
  });

  it("discards entries missing postedAt timestamp", async () => {
    const root = await workspace();
    const stdout = [
      `@city_note: ある街の声 https://x.com/city_note/status/2222222222222222222`
    ].join("\n");

    await collectObservations(root, { now: FIXED_NOW, runner: fakeRunner(stdout) });

    const report = await readObservationsReport(root, FIXED_NOW);
    const missingPostedAt = report.entries.filter((entry) => !entry.postedAt);
    expect(missingPostedAt).toHaveLength(0);
  });

  it("logs rejected entries to runtime/x-observation-rejected.jsonl with reason", async () => {
    const root = await workspace();
    const stdout = [
      `Indie Pulse is growing rapidly towards being the ultimate https://t.co/4sNbGtyXmL`,
      `@city_note: accepted observation https://x.com/city_note/status/3333333333333333333 2026-05-09T07:30:00.000Z`
    ].join("\n");

    await collectObservations(root, { now: FIXED_NOW, runner: fakeRunner(stdout) });

    const rejectedLog = await readFile(join(root, "runtime", "x-observation-rejected.jsonl"), "utf8");
    expect(rejectedLog).toContain("t.co");
    expect(rejectedLog).toContain("Indie Pulse");
    expect(rejectedLog).toMatch(/"reason":/);

    const report = await readObservationsReport(root, FIXED_NOW);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].author).toBe("city_note");
  });

  it("discards entries where URL is t.co even when author tag is present in text", async () => {
    const root = await workspace();
    const stdout = [
      `@someone: テキスト https://t.co/abc123 2026-05-09T07:30:00.000Z`
    ].join("\n");

    await collectObservations(root, { now: FIXED_NOW, runner: fakeRunner(stdout) });

    const report = await readObservationsReport(root, FIXED_NOW);
    expect(report.entries).toHaveLength(0);
  });
});

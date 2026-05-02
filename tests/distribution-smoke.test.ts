import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";

const installTimeoutMs = 60_000;

interface NpmPackFile {
  path: string;
  size: number;
}

interface NpmPackResult {
  filename: string;
  size: number;
  files: NpmPackFile[];
}

function runNpm(args: string[], cwd: string, timeout = 30_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    execFile("npm", args, { cwd, timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function parsePackJson(stdout: string): NpmPackResult {
  const parsed = JSON.parse(stdout) as NpmPackResult[];
  expect(parsed).toHaveLength(1);
  return parsed[0];
}

const lyrics = [
  "[Intro - rust radio]",
  "Small lights count the rain under a dead overpass",
  "",
  "[Verse 1 - spare machine pulse]",
  "I keep the city folded in a coat with no owner",
  "Every signal blinks like it forgot who it warned",
  "Static on my shoulder says the chorus can wait",
  "Boots in the water but the beat still turns"
].join("\n");

describe("distribution smoke", () => {
  it("packs the distribution tarball and keeps package main importable", async () => {
    const repoRoot = resolve(".");
    const packDir = mkdtempSync(join(tmpdir(), "artist-runtime-pack-"));
    const installDir = mkdtempSync(join(tmpdir(), "artist-runtime-install-"));

    try {
      const pack = parsePackJson((await runNpm(["pack", "--json", "--pack-destination", packDir], repoRoot)).stdout);
      const packedMain = pack.files.find((file) => file.path === "dist/index.js");
      const packedManifest = pack.files.find((file) => file.path === "package.json");
      const tarballPath = join(packDir, pack.filename);

      expect(pack.size).toBeGreaterThan(0);
      expect(existsSync(tarballPath)).toBe(true);
      expect(packedMain?.size).toBeGreaterThan(0);
      expect(packedManifest?.size).toBeGreaterThan(0);

      writeFileSync(join(installDir, "package.json"), JSON.stringify({ type: "module", private: true }), "utf8");

      await runNpm([
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefer-offline",
        "--package-lock=false",
        tarballPath
      ], installDir, installTimeoutMs);
      const installedMain = join(installDir, "node_modules", "@yzhonda", "openclaw-artist-runtime", "dist", "index.js");
      expect(existsSync(installedMain)).toBe(true);
      const installedModule = await import(pathToFileURL(installedMain).href);
      expect(typeof installedModule.default).toBe("function");
    } finally {
      await Promise.all([
        rm(packDir, { recursive: true, force: true }),
        rm(installDir, { recursive: true, force: true })
      ]);
    }
  }, 45_000);

  it("creates mock-only Suno prompt artifacts without CDP or real submit", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "artist-runtime-distribution-suno-"));
    const observationPath = join(workspaceRoot, "observations", "distribution-smoke.md");
    await mkdir(join(workspaceRoot, "observations"), { recursive: true });
    writeFileSync(observationPath, "- text: mock distribution smoke, no browser worker\n", "utf8");

    const result = await createAndPersistSunoPromptPack({
      workspaceRoot,
      songId: "distribution-smoke-song",
      songTitle: "Ash Signal",
      artistReason: "mock distribution smoke for package viability",
      lyricsText: lyrics,
      moodHint: "rust radio pulse",
      observationPath,
      configSnapshot: { autopilot: { dryRun: true }, music: { engine: "suno" } }
    });

    const requiredArtifacts = [
      result.artifactPaths.lyricsSunoLatest,
      result.artifactPaths.styleLatest,
      result.artifactPaths.excludeLatest,
      result.artifactPaths.yamlLatest,
      result.artifactPaths.payloadLatest
    ];
    for (const artifactPath of requiredArtifacts) {
      expect(existsSync(artifactPath)).toBe(true);
    }

    const payload = JSON.parse(readFileSync(result.artifactPaths.payloadLatest, "utf8")) as Record<string, unknown>;
    const ledger = readFileSync(result.artifactPaths.promptLedger, "utf8");

    expect(payload.lyrics).toBe(lyrics);
    expect(payload.payloadYaml).toBe(result.pack.yamlLyrics);
    expect(result.pack.validation.valid).toBe(true);
    expect(ledger).toContain("suno_payload_build");
    expect(ledger).toContain("lyrics-suno.md");
    expect(ledger).not.toContain("suno_create_submit");
  });
});

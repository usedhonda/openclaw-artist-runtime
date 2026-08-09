import { access, chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve("scripts/openclaw-suno-login.sh");

async function runWithFakeNode(options: {
  workspace?: string;
  profile?: string;
  fresh?: boolean;
  script?: string;
  cwd?: string;
  chromeExecutable?: string | null;
  playwrightExecutable?: string | null;
}) {
  const root = await mkdtemp(join(tmpdir(), "artist-runtime-suno-login-test-"));
  const bin = join(root, "bin");
  const capturePath = join(root, "node-args.txt");
  const openCapturePath = join(root, "open-args.txt");
  const curlCountPath = join(root, "curl-count.txt");
  const explicitExecutable = join(root, "Explicit Chrome.app", "Contents", "MacOS", "Google Chrome");
  const playwrightExecutable = join(root, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome");
  await mkdir(bin, { recursive: true });
  await mkdir(join(explicitExecutable, ".."), { recursive: true });
  await writeFile(explicitExecutable, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(explicitExecutable, 0o755);
  await mkdir(join(playwrightExecutable, ".."), { recursive: true });
  await writeFile(playwrightExecutable, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(playwrightExecutable, 0o755);
  const fakeNode = join(bin, "node");
  await writeFile(
    fakeNode,
    "#!/bin/sh\ncase \"$*\" in\n  *chromium.executablePath*)\n    if [ \"$FAKE_PLAYWRIGHT_RESOLVE\" = missing ]; then exit 0; fi\n    printf '%s' \"$FAKE_PLAYWRIGHT_EXECUTABLE\"\n    exit 0\n    ;;\nesac\nprintf '%s\\n' \"$@\" > \"$FAKE_NODE_ARGS\"\nexit 0\n",
    "utf8"
  );
  await chmod(fakeNode, 0o755);
  await writeFile(
    join(bin, "open"),
    "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$FAKE_OPEN_ARGS\"\nexit 0\n",
    "utf8"
  );
  await chmod(join(bin, "open"), 0o755);
  await writeFile(
    join(bin, "curl"),
    "#!/bin/sh\ncount=0\nif [ -f \"$FAKE_CURL_COUNT\" ]; then count=$(cat \"$FAKE_CURL_COUNT\"); fi\ncount=$((count + 1))\nprintf '%s\\n' \"$count\" > \"$FAKE_CURL_COUNT\"\nif [ \"$count\" -eq 1 ]; then exit 1; fi\nexit 0\n",
    "utf8"
  );
  await chmod(join(bin, "curl"), 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    FAKE_NODE_ARGS: capturePath,
    FAKE_OPEN_ARGS: openCapturePath,
    FAKE_CURL_COUNT: curlCountPath,
    FAKE_PLAYWRIGHT_EXECUTABLE: options.playwrightExecutable === null ? "" : options.playwrightExecutable ?? playwrightExecutable,
    FAKE_PLAYWRIGHT_RESOLVE: options.playwrightExecutable === null ? "missing" : "ok"
  };
  if (options.chromeExecutable === null) delete env.OPENCLAW_SUNO_CHROME_EXECUTABLE;
  else env.OPENCLAW_SUNO_CHROME_EXECUTABLE = options.chromeExecutable ?? explicitExecutable;
  if (options.workspace) env.OPENCLAW_LOCAL_WORKSPACE = options.workspace;
  else delete env.OPENCLAW_LOCAL_WORKSPACE;

  const scriptArgs = options.fresh ? ["--fresh"] : options.profile ? [options.profile] : [];
  const result = spawnSync("bash", [options.script ?? scriptPath, ...scriptArgs], {
    cwd: options.cwd ?? resolve("."),
    env,
    encoding: "utf8"
  });
  return {
    result,
    args: (await readFile(capturePath, "utf8")).trim().split("\n"),
    openArgs: (await pathExists(openCapturePath)) ? (await readFile(openCapturePath, "utf8")).trim().split("\n") : [],
    chromeApp: (options.chromeExecutable === null ? playwrightExecutable : options.chromeExecutable ?? explicitExecutable)
      .split("/Contents/MacOS/")[0]
  };
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

describe("openclaw-suno-login.sh", () => {
  it("uses the configured workspace suno-cli data dir by default", async () => {
    const workspace = "/tmp/artist-runtime-login-workspace";
    const { result, args, openArgs, chromeApp } = await runWithFakeNode({ workspace });

    expect(result.status).toBe(0);
    expect(args).toEqual([
      resolve("vendor/suno-cli/dist/src/cli.js"),
      "login",
      "--data-dir",
      join(workspace, "runtime/suno/cli"),
      "--cdp-endpoint",
      "http://127.0.0.1:9222"
    ]);
    expect(openArgs).toEqual([
      "-na",
      chromeApp,
      "--args",
      `--user-data-dir=${join(workspace, "runtime/suno/cli/browser-profile")}`,
      "--profile-directory=Default",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=9222",
      "--remote-allow-origins=http://127.0.0.1:9222",
      "--password-store=basic",
      "--no-first-run",
      "--no-default-browser-check",
      "https://suno.com/"
    ]);
  });

  it("resolves the visible Chrome app from installed Playwright when no override is set", async () => {
    const { result, openArgs, chromeApp } = await runWithFakeNode({ chromeExecutable: null });

    expect(result.status).toBe(0);
    expect(openArgs[1]).toBe(chromeApp);
    expect(openArgs).toContain("--password-store=basic");
  });

  it("fails before launching when Playwright returns no executable", async () => {
    const { result, openArgs } = await runWithFakeNode({ chromeExecutable: null, playwrightExecutable: null });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("could not resolve an executable Chrome browser");
    expect(openArgs).toEqual([]);
  });

  it("falls back to the repository workspace when no workspace env is set", async () => {
    const { result, args } = await runWithFakeNode({});

    expect(result.status).toBe(0);
    expect(args).toEqual([
      resolve("vendor/suno-cli/dist/src/cli.js"),
      "login",
      "--data-dir",
      resolve(".local/openclaw/workspace/runtime/suno/cli"),
      "--cdp-endpoint",
      "http://127.0.0.1:9222"
    ]);
  });

  it("preserves an explicit profile as the legacy Playwright lane", async () => {
    const profile = "/tmp/legacy-suno-profile";
    const { result, args } = await runWithFakeNode({ profile });

    expect(result.status).toBe(0);
    expect(args).toEqual([resolve("scripts/openclaw-suno-login.mjs"), profile]);
  });

  it("quarantines only CLI auth state and preserves runs.json in place for --fresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-suno-login-fresh-"));
    const workspace = join(root, "workspace");
    const dataDir = join(workspace, "runtime", "suno", "cli");
    const profileDir = join(dataDir, "browser-profile");
    const sessionFile = join(dataDir, "session.json");
    const runsFile = join(dataDir, "runs.json");
    const runsFixture = '{"runs":[]}\n';
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "fixture.txt"), "browser fixture\n", "utf8");
    await writeFile(sessionFile, "{}\n", "utf8");
    await writeFile(runsFile, runsFixture, "utf8");
    const runsBefore = await stat(runsFile);

    const { result, args } = await runWithFakeNode({ workspace, fresh: true });

    expect(result.status).toBe(0);
    expect(args).toEqual([
      resolve("vendor/suno-cli/dist/src/cli.js"),
      "login",
      "--data-dir",
      dataDir
    ]);
    expect(await pathExists(profileDir)).toBe(false);
    expect(await pathExists(sessionFile)).toBe(false);
    expect(await readFile(runsFile, "utf8")).toBe(runsFixture);
    expect((await stat(runsFile)).ino).toBe(runsBefore.ino);

    const quarantineRoot = join(dataDir, "auth-quarantine");
    const quarantineEntries = await readdir(quarantineRoot);
    expect(quarantineEntries).toHaveLength(1);
    expect(quarantineEntries[0]).toMatch(/^\d{8}T\d{6}Z-\d+$/);
    const quarantineDir = join(quarantineRoot, quarantineEntries[0]!);
    expect(await readFile(join(quarantineDir, "browser-profile", "fixture.txt"), "utf8"))
      .toBe("browser fixture\n");
    expect(await readFile(join(quarantineDir, "session.json"), "utf8")).toBe("{}\n");
  });

  it("resolves --fresh to the repository workspace when the env is unset", async () => {
    const fixtureRepo = await mkdtemp(join(tmpdir(), "artist-runtime-suno-login-repo-"));
    const fixtureScripts = join(fixtureRepo, "scripts");
    const fixtureScript = join(fixtureScripts, "openclaw-suno-login.sh");
    await mkdir(fixtureScripts, { recursive: true });
    await writeFile(fixtureScript, await readFile(scriptPath));
    await chmod(fixtureScript, 0o755);

    const { result, args } = await runWithFakeNode({
      fresh: true,
      script: fixtureScript,
      cwd: fixtureRepo
    });

    expect(result.status).toBe(0);
    expect(args).toEqual([
      join(fixtureRepo, "vendor", "suno-cli", "dist", "src", "cli.js"),
      "login",
      "--data-dir",
      join(fixtureRepo, ".local", "openclaw", "workspace", "runtime", "suno", "cli")
    ]);
  });
});

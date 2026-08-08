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
}) {
  const root = await mkdtemp(join(tmpdir(), "artist-runtime-suno-login-test-"));
  const bin = join(root, "bin");
  const capturePath = join(root, "node-args.txt");
  await mkdir(bin, { recursive: true });
  const fakeNode = join(bin, "node");
  await writeFile(
    fakeNode,
    "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$FAKE_NODE_ARGS\"\nexit 0\n",
    "utf8"
  );
  await chmod(fakeNode, 0o755);

  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_NODE_ARGS: capturePath };
  if (options.workspace) env.OPENCLAW_LOCAL_WORKSPACE = options.workspace;
  else delete env.OPENCLAW_LOCAL_WORKSPACE;

  const scriptArgs = options.fresh ? ["--fresh"] : options.profile ? [options.profile] : [];
  const result = spawnSync("bash", [options.script ?? scriptPath, ...scriptArgs], {
    cwd: options.cwd ?? resolve("."),
    env,
    encoding: "utf8"
  });
  return { result, args: (await readFile(capturePath, "utf8")).trim().split("\n") };
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

describe("openclaw-suno-login.sh", () => {
  it("uses the configured workspace suno-cli data dir by default", async () => {
    const workspace = "/tmp/artist-runtime-login-workspace";
    const { result, args } = await runWithFakeNode({ workspace });

    expect(result.status).toBe(0);
    expect(args).toEqual([
      resolve("vendor/suno-cli/dist/src/cli.js"),
      "login",
      "--data-dir",
      join(workspace, "runtime/suno/cli")
    ]);
  });

  it("falls back to the repository workspace when no workspace env is set", async () => {
    const { result, args } = await runWithFakeNode({});

    expect(result.status).toBe(0);
    expect(args).toEqual([
      resolve("vendor/suno-cli/dist/src/cli.js"),
      "login",
      "--data-dir",
      resolve(".local/openclaw/workspace/runtime/suno/cli")
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

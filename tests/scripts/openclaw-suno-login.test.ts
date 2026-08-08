import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve("scripts/openclaw-suno-login.sh");

async function runWithFakeNode(options: { workspace?: string; profile?: string }) {
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

  const result = spawnSync("bash", [scriptPath, ...(options.profile ? [options.profile] : [])], {
    cwd: resolve("."),
    env,
    encoding: "utf8"
  });
  return { result, args: (await readFile(capturePath, "utf8")).trim().split("\n") };
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
});

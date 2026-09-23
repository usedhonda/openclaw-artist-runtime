import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  birdComposeDryRun,
  birdTweet,
  birdWhoami,
  buildBirdArgs,
  parseTweetUrl,
  runBirdCommand
} from "../src/services/birdRunner";

interface SpawnStep {
  code?: number | null;
  stdout?: string;
  stderr?: string;
  errorCode?: string;
}

interface SpawnCall {
  command: string;
  args: string[];
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = () => undefined;
}

function createSpawnMock(steps: SpawnStep[], calls: SpawnCall[] = []) {
  let index = 0;
  return ((command: string, args: string[]) => {
    calls.push({ command, args: [...args] });
    const step = steps[index++];
    const child = new FakeChildProcess();
    queueMicrotask(() => {
      if (!step) {
        child.emit("close", 1);
        return;
      }
      if (step.stdout) {
        child.stdout.emit("data", step.stdout);
      }
      if (step.stderr) {
        child.stderr.emit("data", step.stderr);
      }
      if (step.errorCode) {
        const error = new Error(step.errorCode) as NodeJS.ErrnoException;
        error.code = step.errorCode;
        child.emit("error", error);
        return;
      }
      child.emit("close", step.code ?? 0);
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

describe("birdRunner", () => {
  it("builds bird args with optional Firefox profile", () => {
    expect(buildBirdArgs(["whoami", "--plain"], {} as NodeJS.ProcessEnv)).toEqual(["whoami", "--plain"]);
    expect(buildBirdArgs(["whoami", "--plain"], { OPENCLAW_X_FIREFOX_PROFILE: "artist-x" } as NodeJS.ProcessEnv)).toEqual([
      "--firefox-profile",
      "artist-x",
      "whoami",
      "--plain"
    ]);
  });

  it("runs a command through spawnImpl and maps ENOENT", async () => {
    const calls: SpawnCall[] = [];
    const result = await runBirdCommand(["--help"], {
      spawnImpl: createSpawnMock([{ errorCode: "ENOENT" }], calls),
      useFirefoxProfile: false
    });

    expect(calls).toEqual([{ command: "bird", args: ["--help"] }]);
    expect(result).toMatchObject({
      status: "failed",
      error: "bird_cli_not_installed",
      exitCode: null
    });
  });

  it("maps auth and rate-limit failures", async () => {
    await expect(runBirdCommand(["whoami", "--plain"], {
      spawnImpl: createSpawnMock([{ code: 1, stderr: "missing auth cookie" }])
    })).resolves.toMatchObject({ status: "failed", error: "bird_auth_missing" });

    await expect(runBirdCommand(["whoami", "--plain"], {
      spawnImpl: createSpawnMock([{ code: 1, stderr: "401 could not authenticate" }])
    })).resolves.toMatchObject({ status: "failed", error: "bird_auth_expired" });

    await expect(runBirdCommand(["--plain", "tweet", "signal"], {
      spawnImpl: createSpawnMock([{ code: 1, stderr: "429 rate limit" }])
    })).resolves.toMatchObject({ status: "failed", error: "bird_rate_limited" });
  });

  it("supports whoami, compose dry-run, tweet wrappers, and tweet URL parsing", async () => {
    const calls: SpawnCall[] = [];
    const spawnImpl = createSpawnMock([
      { code: 0, stdout: "@test_artist" },
      { code: 0, stdout: "draft ok" },
      { code: 0, stdout: "posted https://x.com/test_artist/status/1234567890" }
    ], calls);

    await expect(birdWhoami({ spawnImpl })).resolves.toEqual({ authed: true, account: "@test_artist" });
    await expect(birdComposeDryRun("薄い街の信号", { spawnImpl })).resolves.toEqual({ ok: true, output: "draft ok" });
    await expect(birdTweet("薄い街の信号", { spawnImpl })).resolves.toEqual({
      ok: true,
      tweetUrl: "https://x.com/test_artist/status/1234567890"
    });
    expect(parseTweetUrl("posted https://twitter.com/test_artist/status/99")).toBe("https://twitter.com/test_artist/status/99");
    expect(calls.map((call) => call.args)).toEqual([
      ["whoami", "--plain"],
      ["--plain", "compose", "薄い街の信号"],
      ["--plain", "tweet", "薄い街の信号"]
    ]);
  });

  it("returns publish failure for successful tweet output without URL", async () => {
    await expect(birdTweet("no url", {
      spawnImpl: createSpawnMock([{ code: 0, stdout: "posted" }])
    })).resolves.toEqual({ ok: false, error: "bird_publish_failed" });
  });
});

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { XBirdConnector } from "../src/connectors/social/xBirdConnector";

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
}

const originalFirefoxProfile = process.env.OPENCLAW_X_FIREFOX_PROFILE;

afterEach(() => {
  if (originalFirefoxProfile === undefined) {
    delete process.env.OPENCLAW_X_FIREFOX_PROFILE;
  } else {
    process.env.OPENCLAW_X_FIREFOX_PROFILE = originalFirefoxProfile;
  }
});

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
      if (step.errorCode) {
        const error = new Error(step.errorCode) as NodeJS.ErrnoException;
        error.code = step.errorCode;
        child.emit("error", error);
        return;
      }
      if (step.stdout) {
        child.stdout.emit("data", step.stdout);
      }
      if (step.stderr) {
        child.stderr.emit("data", step.stderr);
      }
      child.emit("close", step.code ?? 0);
    });

    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

describe("XBirdConnector.checkConnection", () => {
  it("fails closed when bird CLI is not installed", async () => {
    const connector = new XBirdConnector(
      createSpawnMock([{ errorCode: "ENOENT" }])
    );

    await expect(connector.checkConnection()).resolves.toEqual({
      connected: false,
      reason: "bird_cli_not_installed"
    });
  });

  it("returns auth expired when bird whoami reports 401-style auth failure", async () => {
    const connector = new XBirdConnector(
      createSpawnMock([
        { code: 0, stdout: "bird help" },
        { code: 1, stderr: "401 Unauthorized: Could not authenticate" }
      ])
    );

    await expect(connector.checkConnection()).resolves.toEqual({
      connected: false,
      reason: "bird_auth_expired"
    });
  });

  it("returns connected with account label when bird whoami succeeds", async () => {
    const connector = new XBirdConnector(
      createSpawnMock([
        { code: 0, stdout: "bird help" },
        { code: 0, stdout: "@ghost_station" }
      ])
    );

    await expect(connector.checkConnection()).resolves.toEqual({
      connected: true,
      accountLabel: "@ghost_station"
    });
  });

  it("omits the Firefox profile flag when OPENCLAW_X_FIREFOX_PROFILE is unset", async () => {
    delete process.env.OPENCLAW_X_FIREFOX_PROFILE;
    const calls: SpawnCall[] = [];
    const connector = new XBirdConnector(
      createSpawnMock([
        { code: 0, stdout: "bird help" },
        { code: 0, stdout: "@ghost_station" }
      ], calls)
    );

    await expect(connector.checkConnection()).resolves.toMatchObject({
      connected: true,
      accountLabel: "@ghost_station"
    });
    expect(calls.map((call) => call.args)).toEqual([
      ["--help"],
      ["whoami", "--plain"]
    ]);
  });

  it("passes OPENCLAW_X_FIREFOX_PROFILE to bird whoami but not the help probe", async () => {
    process.env.OPENCLAW_X_FIREFOX_PROFILE = "test-profile.artist-x";
    const calls: SpawnCall[] = [];
    const connector = new XBirdConnector(
      createSpawnMock([
        { code: 0, stdout: "bird help" },
        { code: 0, stdout: "@test_artist" }
      ], calls)
    );

    await expect(connector.checkConnection()).resolves.toMatchObject({
      connected: true,
      accountLabel: "@test_artist"
    });
    expect(calls.map((call) => call.args)).toEqual([
      ["--help"],
      ["--firefox-profile", "test-profile.artist-x", "whoami", "--plain"]
    ]);
  });
});

describe("XBirdConnector.publish", () => {
  it("keeps dry-run publishes blocked", async () => {
    const connector = new XBirdConnector(createSpawnMock([]));

    await expect(
      connector.publish({
        dryRun: true,
        authority: "auto_publish",
        postType: "observation",
        text: "ghost station"
      })
    ).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: true,
      reason: "dry-run blocks publish"
    });
  });

  it("rejects live publishes before invoking bird", async () => {
    const connector = new XBirdConnector(
      createSpawnMock([
        {
          code: 0,
          stdout: "posted https://x.com/ghost_station/status/1234567890123456789"
        }
      ]),
      {
        now: () => 1000,
        publishGuardState: { recentPublishes: [] },
        minPublishIntervalMs: 100
      }
    );

    await expect(
      connector.publish({
        dryRun: false,
        authority: "auto_publish",
        postType: "observation",
        text: "signal under frost"
      })
    ).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
  });

  it("keeps auth failures unreachable on live publish attempts", async () => {
    const connector = new XBirdConnector(
      createSpawnMock([
        {
          code: 1,
          stderr: "401 Unauthorized: Could not authenticate"
        }
      ]),
      {
        publishGuardState: { recentPublishes: [] }
      }
    );

    await expect(
      connector.publish({
        dryRun: false,
        authority: "auto_publish",
        postType: "observation",
        text: "night transit residue"
      })
    ).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
  });

  it("keeps duplicate guards behind the live-go rejection", async () => {
    const guardState = {
      recentPublishes: [
        {
          textHash: "450fb100011db77e4b2234e3fa3eb4193c0f6241c057e6cd57d130f273a8ea7e",
          publishedAtMs: 1000
        }
      ]
    };
    const connector = new XBirdConnector(
      createSpawnMock([]),
      {
        now: () => 2000,
        publishGuardState: guardState,
        minPublishIntervalMs: 100
      }
    );

    await expect(
      connector.publish({
        dryRun: false,
        authority: "auto_publish",
        postType: "observation",
        text: "same old static"
      })
    ).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
  });

  it("keeps minimum interval guards behind the live-go rejection", async () => {
    const connector = new XBirdConnector(
      createSpawnMock([]),
      {
        now: () => 1200,
        publishGuardState: {
          recentPublishes: [
            {
              textHash: "different-hash",
              publishedAtMs: 1000
            }
          ]
        },
        minPublishIntervalMs: 500
      }
    );

    await expect(
      connector.publish({
        dryRun: false,
        authority: "auto_publish",
        postType: "observation",
        text: "fresh words, too soon"
      })
    ).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
  });

  it("passes OPENCLAW_X_FIREFOX_PROFILE to all dry-run stage bird calls", async () => {
    process.env.OPENCLAW_X_FIREFOX_PROFILE = "test-profile.artist-x";
    const calls: SpawnCall[] = [];
    const connector = new XBirdConnector(
      createSpawnMock([
        { code: 0, stdout: "@test_artist" },
        { code: 0, stdout: "composed" },
        { code: 0, stdout: "dry-run ok" }
      ], calls),
      { dryRunStageExecution: true }
    );

    await expect(
      connector.publish({
        dryRun: true,
        authority: "auto_publish",
        postType: "observation",
        text: "artist signal under ash"
      })
    ).resolves.toMatchObject({
      accepted: false,
      platform: "x",
      dryRun: true,
      reason: "dry-run blocks publish"
    });
    expect(calls.map((call) => call.args)).toEqual([
      ["--firefox-profile", "test-profile.artist-x", "whoami", "--plain"],
      ["--firefox-profile", "test-profile.artist-x", "--plain", "compose", "artist signal under ash"],
      ["--firefox-profile", "test-profile.artist-x", "--plain", "tweet", "--dry-run", "artist signal under ash"]
    ]);
  });
});

describe("XBirdConnector.reply", () => {
  it("keeps dry-run replies blocked", async () => {
    const connector = new XBirdConnector(createSpawnMock([]));

    const result = await connector.reply({
      dryRun: true,
      authority: "auto_publish",
      postType: "reply",
      text: "answering the static",
      targetId: "123"
    });

    expect(result).toMatchObject({
      accepted: false,
      platform: "x",
      dryRun: true,
      reason: "dry-run blocks reply",
      raw: {
        targetId: "123",
        type: "reply"
      }
    });
  });

  it("rejects live replies before invoking bird", async () => {
    const connector = new XBirdConnector(
      createSpawnMock([
        {
          code: 0,
          stdout: "reply posted https://x.com/ghost_station/status/987654321098765432"
        }
      ]),
      {
        now: () => 3000,
        publishGuardState: { recentPublishes: [] },
        minPublishIntervalMs: 100
      }
    );

    await expect(
      connector.reply({
        dryRun: false,
        authority: "auto_publish",
        postType: "reply",
        text: "answering the static",
        targetUrl: "https://x.com/ghost_station/status/1234567890123456789"
      })
    ).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
  });

  it("keeps reply auth failures unreachable on live attempts", async () => {
    const connector = new XBirdConnector(
      createSpawnMock([
        {
          code: 1,
          stderr: "401 Unauthorized: Could not authenticate"
        }
      ]),
      {
        publishGuardState: { recentPublishes: [] }
      }
    );

    await expect(
      connector.reply({
        dryRun: false,
        authority: "auto_publish",
        postType: "reply",
        text: "answering the static",
        targetId: "1234567890123456789"
      })
    ).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
  });

  it("keeps reply target validation behind the live-go rejection", async () => {
    const connector = new XBirdConnector(createSpawnMock([]));

    await expect(
      connector.reply({
        dryRun: false,
        authority: "auto_publish",
        postType: "reply",
        text: "answering the static"
      })
    ).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
  });

  it("keeps reply interval guards behind the live-go rejection", async () => {
    const connector = new XBirdConnector(
      createSpawnMock([]),
      {
        now: () => 1200,
        publishGuardState: {
          recentPublishes: [
            {
              textHash: "different-hash",
              publishedAtMs: 1000
            }
          ]
        },
        minPublishIntervalMs: 500
      }
    );

    await expect(
      connector.reply({
        dryRun: false,
        authority: "auto_publish",
        postType: "reply",
        text: "fresh words, too soon",
        targetId: "1234567890123456789"
      })
    ).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
  });
});

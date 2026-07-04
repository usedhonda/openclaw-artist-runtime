import { describe, expect, it, vi } from "vitest";
import { CliSunoConnector, type CliRunResult, type CliRunner } from "../src/connectors/suno/cliSunoConnector";
import type { SunoCreateRequest } from "../src/types";

const ENTRY = "/opt/suno-cli/dist/src/cli.js";
const CAPTCHA_TOKEN = "hcaptcha-super-secret-token";
const COOKIE = "clerk-session-cookie-value";

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    OPENCLAW_SUNO_CLI_ENTRY: ENTRY,
    OPENCLAW_SUNO_CAPTCHA_TOKEN: CAPTCHA_TOKEN,
    OPENCLAW_SUNO_TOKEN_PROVIDER: "3",
    SUNO_KIT_COOKIE: COOKIE,
    ...overrides
  };
}

function request(overrides: Partial<SunoCreateRequest> = {}): SunoCreateRequest {
  return {
    dryRun: false,
    authority: "auto_create_and_select_take",
    runId: "run-cli-1",
    payload: {
      songName: "Shibuya Static",
      styleAndFeel: "boom-bap, dry, close mic",
      excludeStyles: "edm, autotune",
      payloadYaml: "[Verse]\nlines here",
      sliders: { weirdness: 40, styleInfluence: 75, audioInfluence: 25 },
      vocalGender: "male"
    },
    ...overrides
  };
}

function runnerReturning(result: CliRunResult): CliRunner {
  return vi.fn(async () => result);
}

describe("CliSunoConnector.create", () => {
  it("maps exit 0 with clips to accepted plus every clip song URL", async () => {
    const stdout = JSON.stringify({
      ok: true,
      status: "submitted",
      runId: "run-server-9",
      clips: [
        { clipId: "aaa", songUrl: "https://suno.com/song/aaa" },
        { clipId: "bbb", songUrl: "https://suno.com/song/bbb" }
      ]
    });
    const runner = runnerReturning({ stdout, stderr: "", exitCode: 0 });
    const connector = new CliSunoConnector(".", { env: baseEnv(), runner });

    const result = await connector.create(request());

    expect(result.accepted).toBe(true);
    expect(result.urls).toEqual(["https://suno.com/song/aaa", "https://suno.com/song/bbb"]);
    expect(result.runId).toBe("run-server-9");
    expect(result.pendingTakeUrl).toBe("https://suno.com/song/aaa");
    expect(result.reason).toBe("suno_cli_submitted");
    expect(result.dryRun).toBe(false);
  });

  it("passes mapped song params as execFile flags (title/style/lyrics/exclude/sliders/vocal/run-id)", async () => {
    const runner = vi.fn(async () => ({
      stdout: JSON.stringify({ clips: [{ clipId: "x", songUrl: "https://suno.com/song/x" }] }),
      stderr: "",
      exitCode: 0
    }));
    const connector = new CliSunoConnector("/ws/artist", { env: baseEnv(), runner });

    await connector.create(request());

    const [entry, args] = runner.mock.calls[0];
    expect(entry).toBe(ENTRY);
    expect(args).toEqual(
      expect.arrayContaining([
        "create",
        "--live",
        "--title",
        "Shibuya Static",
        "--style",
        "boom-bap, dry, close mic",
        "--lyrics",
        "[Verse]\nlines here",
        "--exclude",
        "edm, autotune",
        "--captcha-token",
        CAPTCHA_TOKEN,
        "--token-provider",
        "3",
        "--run-id",
        "run-cli-1",
        "--vocal-gender",
        "m",
        "--weirdness",
        "40",
        "--style-influence",
        "75",
        "--audio-influence",
        "25",
        "--min-minutes-between-creates",
        "0",
        "--data-dir",
        "/ws/artist/runtime/suno/cli"
      ])
    );
  });

  it("passes --instrumental instead of --lyrics when payload is instrumental", async () => {
    const runner = vi.fn(async () => ({
      stdout: JSON.stringify({ clips: [{ clipId: "x", songUrl: "https://suno.com/song/x" }] }),
      stderr: "",
      exitCode: 0
    }));
    const connector = new CliSunoConnector(".", { env: baseEnv(), runner });

    await connector.create(request({ payload: { songName: "Inst", styleAndFeel: "ambient", instrumental: true, payloadYaml: "ignored" } }));

    const [, args] = runner.mock.calls[0];
    expect(args).toContain("--instrumental");
    expect(args).not.toContain("--lyrics");
  });

  const failureCases: Array<[number, string]> = [
    [2, "suno_cli_usage"],
    [30, "suno_cli_blocked_login"],
    [32, "suno_cli_blocked_quota"],
    [40, "suno_cli_schema_drift"],
    [50, "suno_cli_retryable"],
    [70, "suno_cli_internal"],
    [99, "suno_cli_internal"]
  ];

  it.each(failureCases)("maps exit %i to accepted:false reason %s", async (exitCode, reason) => {
    const runner = runnerReturning({ stdout: "", stderr: "boom", exitCode });
    const connector = new CliSunoConnector(".", { env: baseEnv(), runner });

    const result = await connector.create(request());

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe(reason);
    expect(result.urls).toEqual([]);
  });

  it("treats non-JSON stdout on exit 0 as schema drift", async () => {
    const runner = runnerReturning({ stdout: "not json", stderr: "", exitCode: 0 });
    const connector = new CliSunoConnector(".", { env: baseEnv(), runner });

    const result = await connector.create(request());

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("suno_cli_schema_drift");
  });

  it("treats exit 0 with zero clip URLs as schema drift", async () => {
    const runner = runnerReturning({ stdout: JSON.stringify({ ok: true, clips: [] }), stderr: "", exitCode: 0 });
    const connector = new CliSunoConnector(".", { env: baseEnv(), runner });

    const result = await connector.create(request());

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("suno_cli_schema_drift");
  });

  it("returns suno_cli_not_configured when the CLI entry env is unset (no runner call, no fake URLs)", async () => {
    const runner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const env = baseEnv();
    delete env.OPENCLAW_SUNO_CLI_ENTRY;
    const connector = new CliSunoConnector(".", { env, runner });

    const result = await connector.create(request());

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("suno_cli_not_configured");
    expect(result.urls).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns suno_cli_captcha_missing when the captcha token is absent", async () => {
    const runner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const env = baseEnv();
    delete env.OPENCLAW_SUNO_CAPTCHA_TOKEN;
    const connector = new CliSunoConnector(".", { env, runner });

    const result = await connector.create(request());

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("suno_cli_captcha_missing");
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns suno_cli_captcha_missing when the token provider is not a safe integer", async () => {
    const runner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const connector = new CliSunoConnector(".", { env: baseEnv({ OPENCLAW_SUNO_TOKEN_PROVIDER: "abc" }), runner });

    const result = await connector.create(request());

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("suno_cli_captcha_missing");
    expect(runner).not.toHaveBeenCalled();
  });

  it("never fires a live create under dry-run", async () => {
    const runner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const connector = new CliSunoConnector(".", { env: baseEnv(), runner });

    const result = await connector.create(request({ dryRun: true }));

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("suno_cli_dry_run");
    expect(result.dryRun).toBe(true);
    expect(runner).not.toHaveBeenCalled();
  });

  it("redacts the captcha token in logs and never leaks the token or cookie in any surface", async () => {
    const logged: string[] = [];
    const runner = runnerReturning({ stdout: "", stderr: "boom", exitCode: 30 });
    const connector = new CliSunoConnector(".", {
      env: baseEnv(),
      runner,
      logger: { warn: (message) => logged.push(message) }
    });

    const result = await connector.create(request());

    const joinedLogs = logged.join("\n");
    expect(joinedLogs).toContain("***");
    expect(joinedLogs).not.toContain(CAPTCHA_TOKEN);
    expect(joinedLogs).not.toContain(COOKIE);
    expect(JSON.stringify(result)).not.toContain(CAPTCHA_TOKEN);
    expect(JSON.stringify(result)).not.toContain(COOKIE);
  });
});

describe("CliSunoConnector.status", () => {
  it("reports connected when entry and cookie are configured", async () => {
    const connector = new CliSunoConnector(".", { env: baseEnv() });
    const status = await connector.status();
    expect(status.connected).toBe(true);
    expect(status.state).toBe("connected");
  });

  it("reports disconnected when the cookie is missing", async () => {
    const env = baseEnv();
    delete env.SUNO_KIT_COOKIE;
    const connector = new CliSunoConnector(".", { env });
    const status = await connector.status();
    expect(status.connected).toBe(false);
    expect(status.state).toBe("disconnected");
  });
});

describe("CliSunoConnector.importResults", () => {
  it("shells download with runId target, --out and --data-dir under the workspace", async () => {
    const runner = vi.fn(async () => ({
      stdout: JSON.stringify({
        ok: true,
        status: "downloaded",
        runId: "run-cli-1",
        downloadedFiles: ["/ws/artist/runtime/suno/cli/downloads/aaa.mp3"],
        clips: [{ clipId: "aaa", songUrl: "https://suno.com/song/aaa" }]
      }),
      stderr: "",
      exitCode: 0
    }));
    const connector = new CliSunoConnector("/ws/artist", { env: baseEnv(), runner });

    await connector.importResults({ runId: "run-cli-1", urls: [] });

    const [entry, args] = runner.mock.calls[0];
    expect(entry).toBe(ENTRY);
    expect(args).toEqual([
      "download",
      "run-cli-1",
      "--out",
      "/ws/artist/runtime/suno/cli/downloads",
      "--data-dir",
      "/ws/artist/runtime/suno/cli"
    ]);
  });

  it("maps download exit 0 to urls + resultRefs (paths) populated", async () => {
    const runner = runnerReturning({
      stdout: JSON.stringify({
        ok: true,
        status: "downloaded",
        runId: "run-server-9",
        downloadedFiles: [
          "/ws/artist/runtime/suno/cli/downloads/aaa.mp3",
          "/ws/artist/runtime/suno/cli/downloads/bbb.mp3"
        ],
        clips: [
          { clipId: "aaa", songUrl: "https://suno.com/song/aaa" },
          { clipId: "bbb", songUrl: "https://suno.com/song/bbb" }
        ]
      }),
      stderr: "",
      exitCode: 0
    });
    const connector = new CliSunoConnector("/ws/artist", { env: baseEnv(), runner });

    const result = await connector.importResults({ runId: "run-cli-1", urls: [] });

    expect(result.accepted).toBe(true);
    expect(result.urls).toEqual(["https://suno.com/song/aaa", "https://suno.com/song/bbb"]);
    expect(result.paths).toEqual([
      "/ws/artist/runtime/suno/cli/downloads/aaa.mp3",
      "/ws/artist/runtime/suno/cli/downloads/bbb.mp3"
    ]);
    expect(result.runId).toBe("run-server-9");
    expect(result.reason).toBe("suno_cli_downloaded");
    expect(typeof result.importedAt).toBe("string");
  });

  it("maps download exit 50 to a not-ready/retryable outcome (empty urls so callers retry)", async () => {
    const runner = runnerReturning({ stdout: JSON.stringify({ ok: false, status: "retryable_unknown" }), stderr: "", exitCode: 50 });
    const connector = new CliSunoConnector("/ws/artist", { env: baseEnv(), runner });

    const result = await connector.importResults({ runId: "run-cli-1", urls: [] });

    expect(result.urls).toEqual([]);
    expect(result.paths).toBeUndefined();
    expect(result.runId).toBe("run-cli-1");
    expect(result.reason).toBe("suno_cli_retryable");
  });

  const downloadFailureCases: Array<[number, string]> = [
    [2, "suno_cli_usage"],
    [30, "suno_cli_blocked_login"],
    [32, "suno_cli_blocked_quota"],
    [40, "suno_cli_schema_drift"],
    [70, "suno_cli_internal"],
    [99, "suno_cli_internal"]
  ];

  it.each(downloadFailureCases)("maps download exit %i to empty-urls reason %s", async (exitCode, reason) => {
    const runner = runnerReturning({ stdout: "", stderr: "boom", exitCode });
    const connector = new CliSunoConnector("/ws/artist", { env: baseEnv(), runner });

    const result = await connector.importResults({ runId: "run-cli-1", urls: [] });

    expect(result.urls).toEqual([]);
    expect(result.reason).toBe(reason);
  });

  it("treats non-JSON stdout on exit 0 as schema drift", async () => {
    const runner = runnerReturning({ stdout: "not json", stderr: "", exitCode: 0 });
    const connector = new CliSunoConnector("/ws/artist", { env: baseEnv(), runner });

    const result = await connector.importResults({ runId: "run-cli-1", urls: [] });

    expect(result.urls).toEqual([]);
    expect(result.reason).toBe("suno_cli_schema_drift");
  });

  it("treats exit 0 with no downloaded files as schema drift (no fake paths)", async () => {
    const runner = runnerReturning({
      stdout: JSON.stringify({ ok: true, status: "downloaded", runId: "run-cli-1", downloadedFiles: [], clips: [{ clipId: "aaa", songUrl: "https://suno.com/song/aaa" }] }),
      stderr: "",
      exitCode: 0
    });
    const connector = new CliSunoConnector("/ws/artist", { env: baseEnv(), runner });

    const result = await connector.importResults({ runId: "run-cli-1", urls: [] });

    expect(result.urls).toEqual([]);
    expect(result.reason).toBe("suno_cli_schema_drift");
  });

  it("returns suno_cli_not_configured when the CLI entry env is unset (no runner call)", async () => {
    const runner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const env = baseEnv();
    delete env.OPENCLAW_SUNO_CLI_ENTRY;
    const connector = new CliSunoConnector("/ws/artist", { env, runner });

    const result = await connector.importResults({ runId: "run-cli-1", urls: [] });

    expect(result.urls).toEqual([]);
    expect(result.reason).toBe("suno_cli_not_configured");
    expect(runner).not.toHaveBeenCalled();
  });

  it("never leaks the cookie in download failure logs", async () => {
    const logged: string[] = [];
    const runner = runnerReturning({ stdout: "", stderr: "boom", exitCode: 30 });
    const connector = new CliSunoConnector("/ws/artist", {
      env: baseEnv(),
      runner,
      logger: { warn: (message) => logged.push(message) }
    });

    const result = await connector.importResults({ runId: "run-cli-1", urls: [] });

    const joinedLogs = logged.join("\n");
    expect(joinedLogs).not.toContain(COOKIE);
    expect(JSON.stringify(result)).not.toContain(COOKIE);
  });
});

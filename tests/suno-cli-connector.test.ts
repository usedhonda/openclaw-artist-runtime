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
    [31, "suno_cli_blocked_captcha"],
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

  it("omits the captcha flags and proceeds (trusted-session path) when no captcha env is set", async () => {
    const runner = vi.fn(async () => ({
      stdout: JSON.stringify({ clips: [{ clipId: "x", songUrl: "https://suno.com/song/x" }] }),
      stderr: "",
      exitCode: 0
    }));
    const env = baseEnv();
    delete env.OPENCLAW_SUNO_CAPTCHA_TOKEN;
    delete env.OPENCLAW_SUNO_TOKEN_PROVIDER;
    const connector = new CliSunoConnector(".", { env, runner });

    const result = await connector.create(request());

    expect(runner).toHaveBeenCalledTimes(1);
    const [, args] = runner.mock.calls[0];
    expect(args).not.toContain("--captcha-token");
    expect(args).not.toContain("--token-provider");
    expect(result.reason).not.toBe("suno_cli_captcha_missing");
    expect(result.accepted).toBe(true);
  });

  it("includes the captcha flags (redacted token + integer provider) as an escape-hatch when both env vars are present", async () => {
    const runner = vi.fn(async () => ({
      stdout: JSON.stringify({ clips: [{ clipId: "x", songUrl: "https://suno.com/song/x" }] }),
      stderr: "",
      exitCode: 0
    }));
    const connector = new CliSunoConnector(".", { env: baseEnv(), runner });

    await connector.create(request());

    const [, args] = runner.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining(["--captcha-token", CAPTCHA_TOKEN, "--token-provider", "3"])
    );
  });

  it("omits both captcha flags when only one of the two env vars is present (no half pair)", async () => {
    const runner = vi.fn(async () => ({
      stdout: JSON.stringify({ clips: [{ clipId: "x", songUrl: "https://suno.com/song/x" }] }),
      stderr: "",
      exitCode: 0
    }));

    const tokenOnly = baseEnv();
    delete tokenOnly.OPENCLAW_SUNO_TOKEN_PROVIDER;
    const tokenOnlyConnector = new CliSunoConnector(".", { env: tokenOnly, runner });
    await tokenOnlyConnector.create(request());
    const [, tokenOnlyArgs] = runner.mock.calls[0];
    expect(tokenOnlyArgs).not.toContain("--captcha-token");
    expect(tokenOnlyArgs).not.toContain("--token-provider");

    runner.mockClear();

    const providerOnly = baseEnv();
    delete providerOnly.OPENCLAW_SUNO_CAPTCHA_TOKEN;
    const providerOnlyConnector = new CliSunoConnector(".", { env: providerOnly, runner });
    await providerOnlyConnector.create(request());
    const [, providerOnlyArgs] = runner.mock.calls[0];
    expect(providerOnlyArgs).not.toContain("--captcha-token");
    expect(providerOnlyArgs).not.toContain("--token-provider");
  });

  it("treats a non-integer token provider as not supplied and omits both captcha flags", async () => {
    const runner = vi.fn(async () => ({
      stdout: JSON.stringify({ clips: [{ clipId: "x", songUrl: "https://suno.com/song/x" }] }),
      stderr: "",
      exitCode: 0
    }));
    const connector = new CliSunoConnector(".", { env: baseEnv({ OPENCLAW_SUNO_TOKEN_PROVIDER: "abc" }), runner });

    await connector.create(request());

    const [, args] = runner.mock.calls[0];
    expect(args).not.toContain("--captcha-token");
    expect(args).not.toContain("--token-provider");
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

describe("CliSunoConnector.create — CDP endpoint (OPENCLAW_SUNO_USE_CDP opt-in)", () => {
  function runnerCapturingEnv(): { runner: CliRunner; envAt: (call: number) => NodeJS.ProcessEnv } {
    const calls: NodeJS.ProcessEnv[] = [];
    const runner: CliRunner = vi.fn(async (_entry, _args, env) => {
      calls.push(env);
      return { stdout: JSON.stringify({ clips: [{ clipId: "x", songUrl: "https://suno.com/song/x" }] }), stderr: "", exitCode: 0 };
    });
    return { runner, envAt: (call: number) => calls[call] };
  }

  it("sets SUNO_KIT_CDP_ENDPOINT from OPENCLAW_SUNO_CDP_ENDPOINT when CDP is explicitly enabled", async () => {
    const { runner, envAt } = runnerCapturingEnv();
    const env = baseEnv({ OPENCLAW_SUNO_USE_CDP: "on", OPENCLAW_SUNO_CDP_ENDPOINT: "http://127.0.0.1:9333" });
    const connector = new CliSunoConnector(".", { env, runner });

    await connector.create(request());

    expect(envAt(0).SUNO_KIT_CDP_ENDPOINT).toBe("http://127.0.0.1:9333");
  });

  it("defaults SUNO_KIT_CDP_ENDPOINT to http://127.0.0.1:9222 when CDP is enabled without an explicit endpoint", async () => {
    const { runner, envAt } = runnerCapturingEnv();
    const env = baseEnv({ OPENCLAW_SUNO_USE_CDP: "on" });
    delete env.OPENCLAW_SUNO_CDP_ENDPOINT;
    const connector = new CliSunoConnector(".", { env, runner });

    await connector.create(request());

    expect(envAt(0).SUNO_KIT_CDP_ENDPOINT).toBe("http://127.0.0.1:9222");
  });

  it("never passes SUNO_KIT_CDP_ENDPOINT when CDP is off/unset, even if inherited from the parent env (preserves profile-spawn)", async () => {
    const { runner, envAt } = runnerCapturingEnv();
    const env = baseEnv({
      // Simulate an inherited value from the parent process env that must not leak
      // through to the child when the opt-in flag is off.
      SUNO_KIT_CDP_ENDPOINT: "http://127.0.0.1:9222"
    });
    const connector = new CliSunoConnector(".", { env, runner });

    await connector.create(request());

    expect(envAt(0).SUNO_KIT_CDP_ENDPOINT).toBeUndefined();

    // Also verify explicit "off" strips it.
    const offEnv = baseEnv({ OPENCLAW_SUNO_USE_CDP: "off", SUNO_KIT_CDP_ENDPOINT: "http://127.0.0.1:9222" });
    const offConnector = new CliSunoConnector(".", { env: offEnv, runner });
    await offConnector.create(request());
    expect(envAt(1).SUNO_KIT_CDP_ENDPOINT).toBeUndefined();
  });

  it("passes SUNO_KIT_CDP_ENDPOINT from a running SunoBrowserService with no legacy env", async () => {
    const { runner, envAt } = runnerCapturingEnv();
    const browserService = { getCdpEndpoint: vi.fn(() => "http://127.0.0.1:41000") };
    const connector = new CliSunoConnector(".", { env: baseEnv(), runner, browserService });

    await connector.create(request());

    expect(envAt(0).SUNO_KIT_CDP_ENDPOINT).toBe("http://127.0.0.1:41000");
  });

  it("strips SUNO_KIT_CDP_ENDPOINT when SunoBrowserService has no browser running", async () => {
    const { runner, envAt } = runnerCapturingEnv();
    const browserService = { getCdpEndpoint: vi.fn(() => undefined) };
    const env = baseEnv({ SUNO_KIT_CDP_ENDPOINT: "http://127.0.0.1:9222" });
    const connector = new CliSunoConnector(".", { env, runner, browserService });

    await connector.create(request());

    expect(envAt(0).SUNO_KIT_CDP_ENDPOINT).toBeUndefined();
  });
});

describe("CliSunoConnector.status", () => {
  it("reports connected when entry and cookie are configured", async () => {
    const connector = new CliSunoConnector(".", { env: baseEnv() });
    const status = await connector.status();
    expect(status.connected).toBe(true);
    expect(status.state).toBe("connected");
  });

  it("reports connected when the entry is configured even without a cookie env (session.json may auth)", async () => {
    const env = baseEnv();
    delete env.SUNO_KIT_COOKIE;
    const connector = new CliSunoConnector(".", { env });
    const status = await connector.status();
    expect(status.connected).toBe(true);
    expect(status.state).toBe("connected");
  });

  it("reports disconnected when the CLI entry is not configured", async () => {
    const env = baseEnv();
    delete env.OPENCLAW_SUNO_CLI_ENTRY;
    const connector = new CliSunoConnector(".", { env });
    const status = await connector.status();
    expect(status.connected).toBe(false);
    expect(status.state).toBe("disconnected");
    expect(status.sunoProfileDetail).toBe("suno_cli entry not configured");
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
    [31, "suno_cli_blocked_captcha"],
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

  it("imports only the run's takes when the CLI returns unrelated downloads", async () => {
    // The external download CLI swept every mp3 accumulated in the downloads
    // directory (20 clips across past runs). Only the two clips that belong to
    // the requested run must be imported; the rest are excluded and reported.
    const runUuidA = "6f370e58-a529-4e71-9304-3414a56c2f1f";
    const runUuidB = "8e6e4e78-295b-4ed7-bcc2-7f2e480c3e20";
    const strayUuids = Array.from({ length: 18 }, (_, i) => `stray-${i.toString().padStart(2, "0")}`);
    const allUuids = [runUuidB, runUuidA, ...strayUuids];
    const logged: string[] = [];
    const runner = runnerReturning({
      stdout: JSON.stringify({
        ok: true,
        status: "downloaded",
        runId: "run-server-9",
        downloadedFiles: allUuids.map((u) => `/ws/artist/runtime/suno/cli/downloads/${u}.mp3`),
        clips: allUuids.map((u) => ({ clipId: u, songUrl: `https://suno.com/song/${u}` }))
      }),
      stderr: "",
      exitCode: 0
    });
    const connector = new CliSunoConnector("/ws/artist", {
      env: baseEnv(),
      runner,
      logger: { warn: (message) => logged.push(message) }
    });

    const result = await connector.importResults({
      runId: "run-cli-1",
      urls: [`https://suno.com/song/${runUuidA}`, `https://suno.com/song/${runUuidB}`]
    });

    expect(result.urls).toEqual([
      `https://suno.com/song/${runUuidB}`,
      `https://suno.com/song/${runUuidA}`
    ]);
    expect(result.paths).toEqual([
      `/ws/artist/runtime/suno/cli/downloads/${runUuidB}.mp3`,
      `/ws/artist/runtime/suno/cli/downloads/${runUuidA}.mp3`
    ]);
    expect(result.reason).toBe("suno_cli_downloaded");
    expect(result.unmatchedUrls).toHaveLength(18);
    expect(logged.join("\n")).toContain("unmatched_download");
  });

  it("imports nothing when no CLI clip matches the run's expected URLs", async () => {
    const runner = runnerReturning({
      stdout: JSON.stringify({
        ok: true,
        status: "downloaded",
        runId: "run-server-9",
        downloadedFiles: ["/ws/artist/runtime/suno/cli/downloads/aaa.mp3"],
        clips: [{ clipId: "aaa", songUrl: "https://suno.com/song/aaa" }]
      }),
      stderr: "",
      exitCode: 0
    });
    const connector = new CliSunoConnector("/ws/artist", { env: baseEnv(), runner });

    const result = await connector.importResults({
      runId: "run-cli-1",
      urls: ["https://suno.com/song/does-not-match"]
    });

    expect(result.urls).toEqual([]);
    expect(result.paths).toBeUndefined();
    expect(result.reason).toBe("suno_cli_no_run_take");
    expect(result.unmatchedUrls).toEqual(["https://suno.com/song/aaa"]);
  });
});

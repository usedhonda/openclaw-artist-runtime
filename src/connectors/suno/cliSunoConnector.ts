import { execFile } from "node:child_process";
import { join } from "node:path";
import type {
  SunoCreatePayload,
  SunoCreateRequest,
  SunoCreateResult,
  SunoImportResult,
  SunoWorkerStatus
} from "../../types.js";
import type { SunoConnector } from "./SunoConnector.js";

/**
 * Result of a single suno-cli invocation. The connector judges outcomes by
 * `exitCode` only (never by string-matching stdout/stderr) per the suno-cli
 * contract.
 */
export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Injectable child-process runner. The default spawns `node <entry> ...args`;
 * tests supply a stub so no real suno-cli process or network is touched.
 */
export type CliRunner = (
  entry: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
) => Promise<CliRunResult>;

export interface CliSunoConnectorLogger {
  warn: (message: string) => void;
}

export interface CliSunoConnectorOptions {
  env?: NodeJS.ProcessEnv;
  runner?: CliRunner;
  logger?: CliSunoConnectorLogger;
}

// suno-cli's own per-day/min-interval budget gate must never double-reject:
// artist-runtime's SunoBudgetTracker stays authoritative, so we neutralize the
// CLI gate with a zero interval and a high per-day ceiling.
const MAX_GENERATIONS_PER_DAY = 100000;

// suno-cli exit code -> stable, token-free fail-closed reason. 0 is success and
// handled separately.
const EXIT_REASONS: Record<number, string> = {
  2: "suno_cli_usage",
  30: "suno_cli_blocked_login",
  31: "suno_cli_blocked_captcha",
  32: "suno_cli_blocked_quota",
  40: "suno_cli_schema_drift",
  50: "suno_cli_retryable",
  70: "suno_cli_internal"
};

function defaultRunner(entry: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<CliRunResult> {
  return new Promise((resolve) => {
    execFile("node", [entry, ...args], { env, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      // Numeric code = the child's real exit code. A non-numeric code (e.g.
      // ENOENT on spawn failure) means the process never ran: treat as internal.
      const exitCode = typeof code === "number" ? code : error ? 70 : 0;
      resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode });
    });
  });
}

// Redact the single-use captcha token before any diagnostic surface. Cookies
// live only in the child env and are never logged.
function redactArgs(args: readonly string[]): string[] {
  const out = [...args];
  for (let index = 0; index < out.length; index += 1) {
    if (out[index] === "--captcha-token" && index + 1 < out.length) {
      out[index + 1] = "***";
    }
  }
  return out;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readSlider(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function vocalGenderFlag(value: unknown): "m" | "f" | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "male" || normalized === "m") {
    return "m";
  }
  if (normalized === "female" || normalized === "f") {
    return "f";
  }
  return undefined;
}

// Mirror PlaywrightSunoDriver.extractPayloadLyrics so the CLI receives the same
// lyrics body the browser driver would submit.
function extractLyrics(payload: SunoCreatePayload): string | undefined {
  return readText(payload.payloadYaml) ?? readText(payload.lyrics) ?? readText(payload.lyricsText);
}

/**
 * SunoConnector that drives song creation by shelling out to the external
 * suno-cli tool (an authenticated HTTP POST to Suno's generate endpoint),
 * replacing the fragile browser DOM worker for the CREATE path.
 *
 * Captcha is an optional escape-hatch supplied per-create via env (fresh,
 * single-use, short-TTL, browser-minted); on a trusted session it is omitted so
 * suno-cli drives the create with token=null. Fail-closed: dry-run and missing
 * CLI entry return accepted:false with a stable reason and never fabricate URLs.
 */
export class CliSunoConnector implements SunoConnector {
  private readonly env: NodeJS.ProcessEnv;
  private readonly runner: CliRunner;
  private readonly logger: CliSunoConnectorLogger;

  constructor(private readonly workspaceRoot = ".", options: CliSunoConnectorOptions = {}) {
    this.env = options.env ?? process.env;
    this.runner = options.runner ?? defaultRunner;
    this.logger = options.logger ?? { warn: (message: string) => console.warn(message) };
  }

  async status(): Promise<SunoWorkerStatus> {
    // Auth is suno-cli's internal concern (JWT env > cookie env/file > saved
    // session.json from `suno-cli login`), and a trusted session may be authed
    // via a session.json artist-runtime never sees. So entry-configured alone is
    // sufficient for connected; cookie presence is reported as informational.
    const connected = Boolean(this.entryPath());
    return {
      state: connected ? "connected" : "disconnected",
      connected,
      lastTransitionAt: new Date().toISOString(),
      ...(connected
        ? this.cookieConfigured()
          ? {}
          : { sunoProfileDetail: "suno_cli configured; no cookie env (session.json/JWT may still auth)" }
        : { sunoProfileDetail: "suno_cli entry not configured" })
    };
  }

  async create(input: SunoCreateRequest): Promise<SunoCreateResult> {
    const runId = input.runId ?? `suno_cli_${Date.now().toString(36)}`;

    // Fail-closed: never fire a live create under dry-run.
    if (input.dryRun) {
      return { accepted: false, runId, reason: "suno_cli_dry_run", urls: [], dryRun: true };
    }

    const entry = this.entryPath();
    if (!entry) {
      return { accepted: false, runId, reason: "suno_cli_not_configured", urls: [], dryRun: false };
    }

    // Captcha is now an optional escape-hatch: on a trusted session suno-cli
    // succeeds with token=null. Only supply the pair when BOTH env vars are
    // present and valid; a half pair is treated as "not supplied".
    const args = this.buildArgs(input, runId, this.resolveCaptcha());
    // Inherit the cookie envs (SUNO_KIT_COOKIE / SUNO_KIT_COOKIE_FILE) into the
    // child; their values are never read or logged here.
    const childEnv: NodeJS.ProcessEnv = { ...this.env };

    let run: CliRunResult;
    try {
      run = await this.runner(entry, args, childEnv);
    } catch {
      this.logger.warn(`[suno-cli] create spawn error args=${redactArgs(args).join(" ")}`);
      return { accepted: false, runId, reason: "suno_cli_internal", urls: [], dryRun: false };
    }

    if (run.exitCode === 0) {
      return this.parseSuccess(run.stdout, runId);
    }

    this.logger.warn(`[suno-cli] create failed exit=${run.exitCode} args=${redactArgs(args).join(" ")}`);
    return {
      accepted: false,
      runId,
      reason: EXIT_REASONS[run.exitCode] ?? "suno_cli_internal",
      urls: [],
      dryRun: false
    };
  }

  async importResults(input: { runId: string; urls: string[] }): Promise<SunoImportResult> {
    const runId = input.runId;

    const entry = this.entryPath();
    if (!entry) {
      return { urls: [], runId, reason: "suno_cli_not_configured" };
    }

    const args = this.buildDownloadArgs(runId);
    // Cookie/JWT envs (SUNO_KIT_COOKIE / SUNO_KIT_COOKIE_FILE) flow into the child
    // for the authenticated audio fetch; their values are never read or logged here.
    const childEnv: NodeJS.ProcessEnv = { ...this.env };

    let run: CliRunResult;
    try {
      run = await this.runner(entry, args, childEnv);
    } catch {
      this.logger.warn(`[suno-cli] download spawn error args=${redactArgs(args).join(" ")}`);
      return { urls: [], runId, reason: "suno_cli_internal" };
    }

    if (run.exitCode === 0) {
      return this.parseDownload(run.stdout, runId);
    }

    // Exit 50 (retryable_unknown) -> audio not ready yet. An empty urls result makes
    // the autopilot/adoption import path retry rather than fail (matching how the
    // browser worker signals "not ready yet"). Other non-zero codes map to their
    // stable fail-closed reason. Never fabricate URLs. Judge by exit code only.
    this.logger.warn(`[suno-cli] download failed exit=${run.exitCode} args=${redactArgs(args).join(" ")}`);
    return { urls: [], runId, reason: EXIT_REASONS[run.exitCode] ?? "suno_cli_internal" };
  }

  private entryPath(): string | undefined {
    return readText(this.env.OPENCLAW_SUNO_CLI_ENTRY);
  }

  private cookieConfigured(): boolean {
    return Boolean(readText(this.env.SUNO_KIT_COOKIE) || readText(this.env.SUNO_KIT_COOKIE_FILE));
  }

  private parseSuccess(stdout: string, fallbackRunId: string): SunoCreateResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { accepted: false, runId: fallbackRunId, reason: "suno_cli_schema_drift", urls: [], dryRun: false };
    }

    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const clips = Array.isArray(record.clips) ? record.clips : [];
    const urls = clips
      .map((clip) => (typeof (clip as Record<string, unknown>)?.songUrl === "string" ? (clip as Record<string, unknown>).songUrl as string : undefined))
      .filter((url): url is string => Boolean(url));

    const runId = readText(record.runId) ?? fallbackRunId;
    if (urls.length === 0) {
      return { accepted: false, runId, reason: "suno_cli_schema_drift", urls: [], dryRun: false };
    }

    return {
      accepted: true,
      runId,
      reason: "suno_cli_submitted",
      urls,
      pendingTakeUrl: urls[0],
      dryRun: false
    };
  }

  private parseDownload(stdout: string, fallbackRunId: string): SunoImportResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { urls: [], runId: fallbackRunId, reason: "suno_cli_schema_drift" };
    }

    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const clips = Array.isArray(record.clips) ? record.clips : [];
    const urls = clips
      .map((clip) => (typeof (clip as Record<string, unknown>)?.songUrl === "string" ? (clip as Record<string, unknown>).songUrl as string : undefined))
      .filter((url): url is string => Boolean(url));
    const paths = Array.isArray(record.downloadedFiles)
      ? record.downloadedFiles.filter((path): path is string => typeof path === "string")
      : [];

    const runId = readText(record.runId) ?? fallbackRunId;
    if (urls.length === 0 || paths.length === 0) {
      return { urls: [], runId, reason: "suno_cli_schema_drift" };
    }

    return {
      accepted: true,
      urls,
      paths,
      runId,
      importedAt: new Date().toISOString(),
      reason: "suno_cli_downloaded"
    };
  }

  private buildDownloadArgs(runId: string): string[] {
    const args: string[] = ["download", runId, "--out", this.downloadDir()];
    const dataDir = this.dataDir();
    if (dataDir) {
      args.push("--data-dir", dataDir);
    }
    return args;
  }

  private downloadDir(): string {
    const base = !this.workspaceRoot || this.workspaceRoot === "." ? "." : this.workspaceRoot;
    return join(base, "runtime", "suno", "cli", "downloads");
  }

  // Resolve the optional captcha escape-hatch. Returns the pair only when BOTH
  // OPENCLAW_SUNO_CAPTCHA_TOKEN (non-empty) and OPENCLAW_SUNO_TOKEN_PROVIDER
  // (safe integer) are present; a half pair yields undefined (omit both flags).
  private resolveCaptcha(): { token: string; provider: number } | undefined {
    const token = readText(this.env.OPENCLAW_SUNO_CAPTCHA_TOKEN);
    const providerRaw = readText(this.env.OPENCLAW_SUNO_TOKEN_PROVIDER);
    const provider = providerRaw !== undefined ? Number(providerRaw) : Number.NaN;
    if (!token || !Number.isSafeInteger(provider)) {
      return undefined;
    }
    return { token, provider };
  }

  private buildArgs(input: SunoCreateRequest, runId: string, captcha: { token: string; provider: number } | undefined): string[] {
    const payload = input.payload ?? {};
    const args: string[] = ["create", "--live"];

    const title = readText(payload.songName);
    if (title) {
      args.push("--title", title);
    }
    const style = readText(payload.styleAndFeel);
    if (style) {
      args.push("--style", style);
    }

    const instrumental = Boolean(payload.instrumental);
    const lyrics = extractLyrics(payload);
    if (instrumental) {
      args.push("--instrumental");
    } else if (lyrics) {
      args.push("--lyrics", lyrics);
    }

    const exclude = readText(payload.excludeStyles);
    if (exclude) {
      args.push("--exclude", exclude);
    }

    if (captcha) {
      args.push("--captcha-token", captcha.token);
      args.push("--token-provider", String(captcha.provider));
    }
    args.push("--run-id", runId);

    const vocal = vocalGenderFlag(payload.vocalGender);
    if (vocal) {
      args.push("--vocal-gender", vocal);
    }

    const sliders = payload.sliders;
    if (sliders && typeof sliders === "object") {
      const record = sliders as Record<string, unknown>;
      const weirdness = readSlider(record.weirdness);
      if (weirdness !== undefined) {
        args.push("--weirdness", String(weirdness));
      }
      const styleInfluence = readSlider(record.styleInfluence);
      if (styleInfluence !== undefined) {
        args.push("--style-influence", String(styleInfluence));
      }
      const audioInfluence = readSlider(record.audioInfluence);
      if (audioInfluence !== undefined) {
        args.push("--audio-influence", String(audioInfluence));
      }
    }

    const personaId = readText(payload.personaId);
    if (personaId) {
      args.push("--persona-id", personaId);
    }

    args.push("--min-minutes-between-creates", "0");
    args.push("--max-generations-per-day", String(MAX_GENERATIONS_PER_DAY));

    const dataDir = this.dataDir();
    if (dataDir) {
      args.push("--data-dir", dataDir);
    }

    return args;
  }

  private dataDir(): string | undefined {
    if (!this.workspaceRoot || this.workspaceRoot === ".") {
      return undefined;
    }
    return join(this.workspaceRoot, "runtime", "suno", "cli");
  }
}

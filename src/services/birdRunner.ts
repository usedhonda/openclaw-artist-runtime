import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { secretLikePattern } from "./personaMigrator.js";

export type BirdErrorReason =
  | "bird_cli_not_installed"
  | "bird_auth_missing"
  | "bird_auth_expired"
  | "bird_rate_limited"
  | "bird_publish_failed"
  | "bird_command_failed";

export interface BirdResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  status: "success" | "failed";
  error?: BirdErrorReason;
}

export interface BirdRunnerOptions {
  spawnImpl?: SpawnImpl;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs?: number;
  useFirefoxProfile?: boolean;
}

interface SpawnStreams {
  stdout?: EventEmitter;
  stderr?: EventEmitter;
  stdin?: { write: (value: string) => void; end: () => void };
}

interface SpawnedProcess extends EventEmitter, SpawnStreams {
  kill?: (signal?: NodeJS.Signals) => void;
}

export type SpawnImpl = typeof spawn;

const defaultTimeoutMs = 10_000;

export function buildBirdArgs(args: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const firefoxProfile = env.OPENCLAW_X_FIREFOX_PROFILE?.trim();
  return firefoxProfile ? ["--firefox-profile", firefoxProfile, ...args] : args;
}

export function combinedBirdOutput(result: Pick<BirdResult, "stdout" | "stderr">): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

function looksLikeAuthMissing(output: string): boolean {
  return /(no auth|missing auth|not logged in|login required|cookie.*missing|credential.*missing)/i.test(output);
}

function looksLikeAuthExpired(output: string): boolean {
  return /(401|unauthorized|could not authenticate|auth[_ ]token|expired)/i.test(output);
}

function looksLikeRateLimit(output: string): boolean {
  return /(429|rate limit|too many requests|temporarily locked|spam)/i.test(output);
}

export function mapBirdFailure(output: string, errorCode?: string, fallback: BirdErrorReason = "bird_command_failed"): BirdErrorReason {
  if (errorCode === "ENOENT") {
    return "bird_cli_not_installed";
  }
  if (looksLikeAuthMissing(output)) {
    return "bird_auth_missing";
  }
  if (looksLikeAuthExpired(output)) {
    return "bird_auth_expired";
  }
  if (looksLikeRateLimit(output)) {
    return "bird_rate_limited";
  }
  return fallback;
}

export function parseTweetUrl(output: string): string | undefined {
  return output.match(/https:\/\/(?:x|twitter)\.com\/[^\s/]+\/status\/\d+/i)?.[0];
}

export async function runBirdCommand(args: string[], options: BirdRunnerOptions = {}): Promise<BirdResult> {
  const spawnImpl = options.spawnImpl ?? spawn;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const env = options.env ?? process.env;
  const finalArgs = options.useFirefoxProfile === false ? args : buildBirdArgs(args, env);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (partial: { code: number | null; stdout: string; stderr: string; errorCode?: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      const result = {
        stdout: partial.stdout.trim(),
        stderr: partial.stderr.trim()
      };
      const output = combinedBirdOutput(result);
      const error = partial.code === 0 ? undefined : mapBirdFailure(output, partial.errorCode);
      const secretGuardFailed =
        secretLikePattern.test(output) && error !== "bird_auth_missing" && error !== "bird_auth_expired";
      resolve({
        ...result,
        exitCode: partial.code,
        status: partial.code === 0 && !secretGuardFailed ? "success" : "failed",
        error: secretGuardFailed ? "bird_command_failed" : error
      });
    };

    try {
      const child = spawnImpl("bird", finalArgs, {
        stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"],
        env
      }) as SpawnedProcess;

      timeout = setTimeout(() => {
        child.kill?.("SIGTERM");
        finish({ code: null, stdout, stderr, errorCode: "ETIMEDOUT" });
      }, timeoutMs);

      if (options.stdin && child.stdin) {
        child.stdin.write(options.stdin);
        child.stdin.end();
      }
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
        finish({ code: null, stdout, stderr, errorCode: error.code });
      });
      child.once("close", (code: number | null) => {
        finish({ code, stdout, stderr });
      });
    } catch (error) {
      finish({
        code: null,
        stdout,
        stderr,
        errorCode: error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : undefined
      });
    }
  });
}

export async function birdWhoami(
  options: BirdRunnerOptions = {}
): Promise<{ authed: boolean; account?: string; error?: BirdErrorReason }> {
  const result = await runBirdCommand(["whoami", "--plain"], options);
  if (result.status !== "success") {
    return { authed: false, error: result.error };
  }
  const account = combinedBirdOutput(result)
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return { authed: true, account };
}

export async function birdComposeDryRun(
  text: string,
  options: BirdRunnerOptions = {}
): Promise<{ ok: boolean; output?: string; error?: BirdErrorReason }> {
  const result = await runBirdCommand(["--plain", "compose", text], options);
  return result.status === "success"
    ? { ok: true, output: combinedBirdOutput(result) || undefined }
    : { ok: false, error: result.error };
}

export async function birdTweet(
  text: string,
  options: BirdRunnerOptions = {}
): Promise<{ ok: boolean; tweetUrl?: string; error?: BirdErrorReason }> {
  const result = await runBirdCommand(["--plain", "tweet", text], options);
  if (result.status !== "success") {
    return { ok: false, error: result.error === "bird_command_failed" ? "bird_publish_failed" : result.error };
  }
  const tweetUrl = parseTweetUrl(combinedBirdOutput(result));
  return tweetUrl ? { ok: true, tweetUrl } : { ok: false, error: "bird_publish_failed" };
}

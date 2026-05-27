import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export const MIN_CHROMIUM_APP_BUNDLE_BYTES = 100 * 1024 * 1024;
export const MIN_CHROMIUM_EXECUTABLE_BYTES = 10 * 1024 * 1024;

export interface SunoBrowserBinaryHealth {
  ok: boolean;
  executablePath?: string;
  executableSizeBytes?: number;
  appBundlePath?: string;
  appBundleSizeBytes?: number;
  detail?: string;
  checkedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function macAppBundlePath(executablePath: string): string | undefined {
  const marker = ".app/";
  const index = executablePath.indexOf(marker);
  if (index < 0) return undefined;
  return executablePath.slice(0, index + marker.length - 1);
}

async function directorySizeBytes(path: string): Promise<number> {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await directorySizeBytes(child);
    } else if (entry.isFile()) {
      total += (await stat(child)).size;
    }
  }
  return total;
}

export async function checkSunoBrowserBinaryHealth(): Promise<SunoBrowserBinaryHealth> {
  const { chromium } = await import("playwright");
  const executablePath = chromium.executablePath();
  const executable = await stat(executablePath).catch((error) => {
    throw new Error(`playwright_chromium_executable_missing: ${error instanceof Error ? error.message : String(error)}`);
  });
  const appBundlePath = macAppBundlePath(executablePath);
  if (appBundlePath) {
    const appBundleSizeBytes = await directorySizeBytes(appBundlePath);
    const ok = appBundleSizeBytes >= MIN_CHROMIUM_APP_BUNDLE_BYTES;
    return {
      ok,
      executablePath,
      executableSizeBytes: executable.size,
      appBundlePath,
      appBundleSizeBytes,
      detail: ok ? undefined : `playwright_chromium_app_bundle_too_small:${appBundleSizeBytes}`,
      checkedAt: nowIso()
    };
  }
  const ok = executable.size >= MIN_CHROMIUM_EXECUTABLE_BYTES;
  return {
    ok,
    executablePath,
    executableSizeBytes: executable.size,
    detail: ok ? undefined : `playwright_chromium_executable_too_small:${executable.size}`,
    checkedAt: nowIso()
  };
}

export function isSunoBrowserLaunchFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /sigabrt|crashpad|bootstrap_check_in|browser closed|failed to launch|executable doesn't exist|executable missing/i.test(message);
}

export async function reinstallPlaywrightChromium(reason = "suno_browser_binary_repair"): Promise<void> {
  const playwrightBin = join(process.cwd(), "node_modules", ".bin", "playwright");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(playwrightBin, ["install", "chromium", "--force"], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env
    });
    child.on("error", (error) => reject(new Error(`${reason}: ${error.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${reason}: playwright install failed code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}


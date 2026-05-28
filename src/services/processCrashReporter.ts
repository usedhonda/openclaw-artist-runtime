import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveDefaultWorkspaceRoot } from "./runtimeConfig.js";

let installed = false;

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return { message: String(error) };
}

async function appendProcessCrash(kind: string, error: unknown): Promise<void> {
  const root = resolveDefaultWorkspaceRoot();
  const path = join(root, "runtime", "gateway-process-crash.jsonl");
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    kind,
    pid: process.pid,
    error: serializeError(error)
  })}\n`, "utf8");
}

export function installGatewayProcessCrashReporter(): void {
  if (installed) {
    return;
  }
  installed = true;

  process.prependListener("uncaughtExceptionMonitor", (error) => {
    void appendProcessCrash("uncaughtException", error).catch(() => undefined);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[artist-runtime] unhandledRejection", reason);
    void appendProcessCrash("unhandledRejection", reason).catch(() => undefined);
  });
}

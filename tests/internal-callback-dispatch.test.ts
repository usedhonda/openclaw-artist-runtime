import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildInternalCallbackDispatchResponse, registerRoutes } from "../src/routes/index.js";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService.js";
import { markCallbackResolved, registerCallbackAction } from "../src/services/callbackActionRegistry.js";

const enabledEnv = { OPENCLAW_DEBUG_CALLBACK_DISPATCH: "on" } as NodeJS.ProcessEnv;
const disabledEnv = {} as NodeJS.ProcessEnv;

async function seedPending(action = "prompt_pack_go"): Promise<{ root: string; callbackId: string }> {
  const root = await mkdtemp(join(tmpdir(), "artist-runtime-callback-dispatch-"));
  await ensureArtistWorkspace(root);
  await writeAutopilotRunState(root, {
    runId: "prompt-ready",
    currentSongId: "song-ready",
    stage: "prompt_pack",
    suspendedAt: "prompt_pack_ready",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    lastSuccessfulStage: "prompt_pack"
  });
  const entry = await registerCallbackAction(root, {
    action,
    songId: "song-ready",
    chatId: 123,
    messageId: 77,
    userId: 456
  });
  return { root, callbackId: entry.callbackId };
}

function request(root: string, callbackId?: string, extra: Record<string, unknown> = {}) {
  return {
    callbackId,
    remoteAddress: "127.0.0.1",
    config: { artist: { workspaceRoot: root } },
    ...extra
  };
}

describe("internal callback dispatch endpoint", () => {
  it("registers the internal recovery endpoint", () => {
    const paths: string[] = [];
    registerRoutes({
      registerHttpRoute(definition: { path: string }) {
        paths.push(definition.path);
      }
    });
    expect(paths).toContain("/plugins/artist-runtime/api/telegram/callback-dispatch");
  });

  it("is disabled unless OPENCLAW_DEBUG_CALLBACK_DISPATCH is on", async () => {
    const { root, callbackId } = await seedPending();

    await expect(buildInternalCallbackDispatchResponse(request(root, callbackId), disabledEnv)).resolves.toMatchObject({
      dispatched: false,
      statusCode: 403,
      error: "debug_callback_dispatch_disabled"
    });
  });

  it("rejects invalid or non-local dispatch attempts", async () => {
    const { root, callbackId } = await seedPending();

    await expect(buildInternalCallbackDispatchResponse(request(root, ""), enabledEnv)).resolves.toMatchObject({
      statusCode: 400,
      error: "invalid_callback_id"
    });
    await expect(buildInternalCallbackDispatchResponse(request(root, callbackId, { remoteAddress: "192.0.2.10" }), enabledEnv)).resolves.toMatchObject({
      statusCode: 403,
      error: "debug_callback_dispatch_not_local"
    });
  });

  it("dispatches a pending prompt_pack callback using ledger owner metadata and writes recovery audit", async () => {
    const { root, callbackId } = await seedPending();

    const response = await buildInternalCallbackDispatchResponse(request(root, callbackId), enabledEnv);

    expect(response).toMatchObject({ dispatched: true, statusCode: 200, callbackId, action: "prompt_pack_go", result: "applied" });
    expect(await readAutopilotRunState(root)).toMatchObject({ stage: "suno_generation", suspendedAt: null });
    const audit = (await readFile(join(root, "runtime", "callback-audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(audit.at(-1)).toMatchObject({ callbackId, action: "prompt_pack_go", actor: "internal_recovery", result: "applied" });
  });

  it("rejects callbacks that are no longer pending", async () => {
    const applied = await seedPending();
    await markCallbackResolved(applied.root, applied.callbackId, { status: "applied", reason: "done" });

    await expect(buildInternalCallbackDispatchResponse(request(applied.root, applied.callbackId), enabledEnv)).resolves.toMatchObject({
      dispatched: false,
      statusCode: 404,
      error: "callback_action_not_pending"
    });

    const discarded = await seedPending();
    await markCallbackResolved(discarded.root, discarded.callbackId, { status: "discarded", reason: "cancelled" });
    await expect(buildInternalCallbackDispatchResponse(request(discarded.root, discarded.callbackId), enabledEnv)).resolves.toMatchObject({
      dispatched: false,
      statusCode: 404,
      error: "callback_action_not_pending"
    });
  });
});

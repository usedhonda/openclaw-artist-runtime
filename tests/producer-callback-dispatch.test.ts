import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProducerCallbackDispatchResponse } from "../src/routes/index";
import { registerCallbackAction, resolveCallbackAction } from "../src/services/callbackActionRegistry";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";

const OWNER = { chatId: 100, messageId: 200, userId: 300 };

describe("producer callback dispatch (Plan v10.65 Layer 2)", () => {
  it("R10: rejects any non-allowlisted action before dispatch (403)", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-l2-allowlist-"));
    // Even with a real pending publish callback present, the Console path must refuse it.
    await registerCallbackAction(root, { action: "x_publish_confirm", songId: "song-x", ...OWNER });
    for (const action of ["x_publish_confirm", "song_archive", "song_discard", "daily_voice_publish"]) {
      const res = await buildProducerCallbackDispatchResponse(root, { action, songId: "song-x" });
      expect(res.dispatched).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.error).toBe("action_not_allowed_from_console");
    }
  });

  it("returns 404 when no pending callback matches an allowed action", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-l2-notfound-"));
    const res = await buildProducerCallbackDispatchResponse(root, { action: "prompt_pack_go", songId: "song-001" });
    expect(res.dispatched).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.error).toBe("pending_callback_not_found");
  });

  it("dispatches prompt_pack_go from the Console (state advances, callback resolved)", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-l2-promptgo-"));
    const seeded = await readAutopilotRunState(root);
    await writeAutopilotRunState(root, { ...seeded, currentSongId: "song-009", stage: "prompt_pack" });
    const entry = await registerCallbackAction(root, { action: "prompt_pack_go", songId: "song-009", ...OWNER });

    const res = await buildProducerCallbackDispatchResponse(root, { action: "prompt_pack_go", songId: "song-009" });

    expect(res.dispatched).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.action).toBe("prompt_pack_go");
    expect(res.callbackId).toBe(entry.callbackId);

    const state = await readAutopilotRunState(root);
    expect(state.stage).toBe("suno_generation");
    const resolved = await resolveCallbackAction(root, entry.callbackId);
    expect(resolved?.status).toBe("applied");
  });

  it("picks the newest pending entry when duplicates exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-l2-dup-"));
    const seeded = await readAutopilotRunState(root);
    await writeAutopilotRunState(root, { ...seeded, currentSongId: "song-009", stage: "prompt_pack" });
    const older = await registerCallbackAction(root, { action: "prompt_pack_go", songId: "song-009", now: 1_000, ...OWNER });
    const newer = await registerCallbackAction(root, { action: "prompt_pack_go", songId: "song-009", now: 2_000, ...OWNER });

    const res = await buildProducerCallbackDispatchResponse(root, { action: "prompt_pack_go", songId: "song-009" });

    expect(res.callbackId).toBe(newer.callbackId);
    expect(res.callbackId).not.toBe(older.callbackId);
  });
});

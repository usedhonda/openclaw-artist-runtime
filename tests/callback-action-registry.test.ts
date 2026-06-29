import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  callbackActionTtlCategory,
  defaultCallbackActionExpiresAt,
  isProducerDecisionAction,
  isResurfaceAllowedAction,
  markPendingCallbacksByActionResolved,
  markCallbackResolved,
  readCallbackActionEntries,
  registerCallbackAction,
  resolveCallbackAction
} from "../src/services/callbackActionRegistry";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

function root(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-callback-registry-"));
}

describe("callback action registry", () => {
  it("registers and resolves pending callback actions", async () => {
    const workspace = root();

    const entry = await registerCallbackAction(workspace, {
      action: "proposal_yes",
      proposalId: "proposal-1",
      chatId: 123,
      messageId: 456,
      userId: 789,
      now: 1000
    });

    expect(entry.callbackId).toMatch(/^[A-Za-z0-9]{8,12}$/);
    expect(entry.expiresAt).toBe(defaultCallbackActionExpiresAt(1000));
    await expect(resolveCallbackAction(workspace, entry.callbackId)).resolves.toMatchObject({
      callbackId: entry.callbackId,
      action: "proposal_yes",
      status: "pending"
    });
  });

  it("marks resolved entries through append-only updates", async () => {
    const workspace = root();
    const entry = await registerCallbackAction(workspace, {
      action: "proposal_no",
      chatId: 1,
      messageId: 2,
      userId: 3,
      now: 100
    });

    await markCallbackResolved(workspace, entry.callbackId, { status: "discarded", reason: "operator_no", now: 200 });

    const resolved = await resolveCallbackAction(workspace, entry.callbackId);
    const entries = await readCallbackActionEntries(workspace);
    expect(resolved).toMatchObject({ status: "discarded", resolvedAt: 200, resolveReason: "operator_no" });
    expect(entries).toHaveLength(2);
  });

  it("marks pending callbacks by action while preserving an excluded song", async () => {
    const workspace = root();
    const oldInject = await registerCallbackAction(workspace, {
      action: "song_spawn_inject",
      songId: "spawn-old",
      chatId: 1,
      messageId: 2,
      userId: 3,
      now: 100
    });
    const currentInject = await registerCallbackAction(workspace, {
      action: "song_spawn_inject",
      songId: "spawn-current",
      chatId: 1,
      messageId: 3,
      userId: 3,
      now: 100
    });
    await registerCallbackAction(workspace, {
      action: "song_discard",
      songId: "song-other",
      chatId: 1,
      messageId: 4,
      userId: 3,
      now: 100
    });

    const resolved = await markPendingCallbacksByActionResolved(workspace, {
      actions: new Set(["song_spawn_inject"]),
      excludeSongId: "spawn-current",
      status: "updated",
      reason: "superseded_by_new_song_spawn_proposal",
      now: 200
    });

    expect(resolved.map((entry) => entry.callbackId)).toEqual([oldInject.callbackId]);
    await expect(resolveCallbackAction(workspace, oldInject.callbackId)).resolves.toMatchObject({
      status: "updated",
      resolveReason: "superseded_by_new_song_spawn_proposal"
    });
    await expect(resolveCallbackAction(workspace, currentInject.callbackId)).resolves.toMatchObject({ status: "pending" });
  });

  it("generates unique short ids for multiple registrations", async () => {
    const workspace = root();
    const ids = new Set<string>();
    for (let index = 0; index < 25; index += 1) {
      const entry = await registerCallbackAction(workspace, {
        action: "proposal_yes",
        chatId: 1,
        messageId: index,
        userId: 2
      });
      ids.add(entry.callbackId);
    }

    expect(ids.size).toBe(25);
  });

  it("uses 30-day TTL for producer-decision actions (Plan v10.39)", async () => {
    const workspace = root();
    const now = 1_000_000;

    for (const action of ["song_archive", "song_discard", "song_spawn_inject", "song_spawn_skip", "prompt_pack_go", "prompt_pack_edit", "prompt_pack_skip", "lyrics_redraft", "take_select_accept", "take_select_regenerate", "take_select_skip"] as const) {
      const entry = await registerCallbackAction(workspace, {
        action,
        chatId: 1,
        messageId: 1,
        userId: 1,
        now
      });
      expect(entry.expiresAt - now).toBe(THIRTY_DAYS_MS);
      expect(entry.expiresAt).toBe(defaultCallbackActionExpiresAt(now, action));
      expect(isProducerDecisionAction(action)).toBe(true);
      expect(callbackActionTtlCategory(action)).toBe("producer_decision");
    }
    expect(isResurfaceAllowedAction("lyrics_redraft")).toBe(false);
  });

  it("keeps 24-hour TTL for working-confirmation actions", async () => {
    const workspace = root();
    const now = 1_000_000;

    for (const action of ["proposal_yes", "x_publish_confirm", "daily_voice_publish"] as const) {
      const entry = await registerCallbackAction(workspace, {
        action,
        chatId: 1,
        messageId: 1,
        userId: 1,
        now
      });
      expect(entry.expiresAt - now).toBe(ONE_DAY_MS);
      expect(isProducerDecisionAction(action)).toBe(false);
      expect(callbackActionTtlCategory(action)).toBe("working_confirmation");
    }
  });

  it("honors explicit expiresAt override regardless of action category", async () => {
    const workspace = root();
    const now = 1_000_000;
    const override = now + 7 * ONE_DAY_MS;

    const archived = await registerCallbackAction(workspace, {
      action: "song_archive",
      chatId: 1,
      messageId: 1,
      userId: 1,
      now,
      expiresAt: override
    });
    expect(archived.expiresAt).toBe(override);

    const confirm = await registerCallbackAction(workspace, {
      action: "prompt_pack_go",
      chatId: 1,
      messageId: 2,
      userId: 1,
      now,
      expiresAt: override
    });
    expect(confirm.expiresAt).toBe(override);
  });

  it("treats unknown actions as working_confirmation (default 24h)", () => {
    expect(callbackActionTtlCategory("never_seen_action")).toBe("working_confirmation");
    expect(callbackActionTtlCategory(undefined)).toBe("working_confirmation");
    expect(isProducerDecisionAction(undefined)).toBe(false);
  });
});

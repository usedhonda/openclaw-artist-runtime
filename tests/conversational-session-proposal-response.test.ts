import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as changeSetApplier from "../src/services/changeSetApplier";
import {
  createConversationalSession,
  handleProposalResponse,
  listPendingProposalDetails
} from "../src/services/conversationalSession";
import type { ChangeSetProposal } from "../src/services/freeformChangesetProposer";

function root(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-proposal-response-"));
}

function proposal(id = "changeset-test"): ChangeSetProposal {
  return {
    id,
    domain: "persona",
    summary: "Persona update.",
    fields: [
      {
        domain: "persona",
        targetFile: "ARTIST.md",
        field: "socialVoice",
        currentValue: "old",
        proposedValue: "new",
        reasoning: "producer direction",
        status: "proposed"
      }
    ],
    warnings: [],
    createdAt: "2026-04-29T00:00:00.000Z",
    source: "conversation"
  };
}

async function seed(rootPath: string, pending = proposal()): Promise<ChangeSetProposal> {
  await createConversationalSession(rootPath, {
    chatId: 100,
    userId: 200,
    topic: { kind: "persona" },
    pendingChangeSet: pending
  });
  return pending;
}

async function audit(rootPath: string): Promise<Array<Record<string, unknown>>> {
  const contents = await readFile(join(rootPath, "runtime", "proposal-audit.jsonl"), "utf8");
  return contents.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("handleProposalResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies a proposal and clears it", async () => {
    const workspace = root();
    const pending = await seed(workspace);
    const applySpy = vi.spyOn(changeSetApplier, "applyChangeSet").mockResolvedValue({
      applied: pending.fields,
      skipped: [],
      warnings: [],
      backups: { sessionId: pending.id, entries: [] }
    });

    const result = await handleProposalResponse(workspace, {
      proposalId: pending.id,
      action: "yes",
      actor: { kind: "telegram_text", chatId: 100, userId: 200 },
      now: 2000
    });

    expect(result).toMatchObject({ status: "applied", applyResult: { applied: [{ field: "socialVoice" }] } });
    expect(applySpy).toHaveBeenCalledWith(workspace, pending);
    expect(await listPendingProposalDetails(workspace)).toEqual([]);
    expect(await audit(workspace)).toEqual([
      expect.objectContaining({ eventType: "proposal_apply_yes", proposalId: pending.id, actorKind: "telegram_text" })
    ]);
  });

  it("discards a proposal without applying", async () => {
    const workspace = root();
    const pending = await seed(workspace);
    const applySpy = vi.spyOn(changeSetApplier, "applyChangeSet");

    const result = await handleProposalResponse(workspace, {
      proposalId: pending.id,
      action: "no",
      actor: { kind: "telegram_text", chatId: 100, userId: 200 }
    });

    expect(result).toMatchObject({ status: "discarded" });
    expect(applySpy).not.toHaveBeenCalled();
    expect(await listPendingProposalDetails(workspace)).toEqual([]);
  });

  it("updates proposed fields and treats missing proposals as already resolved", async () => {
    const workspace = root();
    const pending = await seed(workspace);

    const updated = await handleProposalResponse(workspace, {
      proposalId: pending.id,
      action: "edit",
      actor: { kind: "ui_api" },
      fieldUpdates: { socialVoice: "edited voice" }
    });

    expect(updated).toMatchObject({
      status: "updated",
      proposal: { fields: [{ field: "socialVoice", proposedValue: "edited voice" }] }
    });

    const missing = await handleProposalResponse(workspace, {
      proposalId: "missing",
      action: "yes",
      actor: { kind: "ui_api" }
    });
    expect(missing).toMatchObject({ status: "already_resolved" });
  });

  it("rejects mismatched telegram actors", async () => {
    const workspace = root();
    const pending = await seed(workspace);

    const result = await handleProposalResponse(workspace, {
      proposalId: pending.id,
      action: "yes",
      actor: { kind: "telegram_callback", chatId: 100, userId: 201 }
    });

    expect(result).toMatchObject({ status: "unauthorized" });
    expect(await listPendingProposalDetails(workspace)).toHaveLength(1);
  });
});

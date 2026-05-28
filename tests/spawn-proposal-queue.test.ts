import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { SpawnProposal } from "../src/types";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import {
  appendSpawnProposal,
  clearSpawnProposalQueueCacheForTest,
  listPendingSpawnProposals,
  loadSpawnProposalQueue,
  markSpawnProposalAcceptedWaiting,
  markSpawnProposalApproved,
  markSpawnProposalDiscarded,
  spawnProposalLedgerPath
} from "../src/services/spawnProposalQueue";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-spawn-proposal-queue-"));
}

function proposal(id: string): SpawnProposal {
  return {
    proposalId: id,
    createdAt: `2026-05-28T00:00:0${id.at(-1) ?? "0"}.000Z`,
    status: "pending",
    title: `proposal ${id}`,
    voiceTop: "次の曲、ここから考える。",
    coreTheme: `theme ${id}`,
    observationSources: [
      { kind: "news", label: "news", quote: "街の違和感", url: "https://example.com/news" }
    ],
    motifRank: 1,
    cascadeTrace: {
      observationSources: [
        { kind: "news", label: "news", quote: "街の違和感", url: "https://example.com/news" }
      ],
      artistVoice: "街の違和感を切る。",
      title: `proposal ${id}`,
      lyricsTheme: `theme ${id}`,
      styleLayer: "dry male vocal, tight drums"
    }
  };
}

describe("spawnProposalQueue", () => {
  beforeEach(() => {
    clearSpawnProposalQueueCacheForTest();
    getRuntimeEventBus().clearForTest();
  });

  it("appends proposals to the runtime ledger and lists pending entries", async () => {
    const root = workspace();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    await appendSpawnProposal(root, proposal("p1"), { now: 1 });
    await appendSpawnProposal(root, proposal("p2"), { now: 2 });

    unsubscribe();
    expect((await listPendingSpawnProposals(root)).map((entry) => entry.proposalId)).toEqual(["p1", "p2"]);
    expect(await readFile(spawnProposalLedgerPath(root), "utf8")).toContain("\"proposalId\":\"p1\"");
    expect(events).toContainEqual(expect.objectContaining({
      type: "spawn_proposal_appended",
      proposalId: "p2",
      pendingCount: 2,
      timestamp: 2
    }));
  });

  it("enforces the max-three pending proposal limit and emits queue-full audit", async () => {
    const root = workspace();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    await appendSpawnProposal(root, proposal("p1"), { now: 1 });
    await appendSpawnProposal(root, proposal("p2"), { now: 2 });
    await appendSpawnProposal(root, proposal("p3"), { now: 3 });
    await expect(appendSpawnProposal(root, proposal("p4"), { now: 4 })).rejects.toThrow("spawn_proposal_queue_full:3/3");

    unsubscribe();
    expect((await listPendingSpawnProposals(root)).map((entry) => entry.proposalId)).toEqual(["p1", "p2", "p3"]);
    expect(events.at(-1)).toMatchObject({
      type: "spawn_proposal_queue_full",
      proposalId: "p4",
      limit: 3,
      pendingCount: 3,
      timestamp: 4
    });
  });

  it("records status transitions append-only and rebuilds latest state on load", async () => {
    const root = workspace();

    await appendSpawnProposal(root, proposal("p1"));
    await appendSpawnProposal(root, proposal("p2"));
    await expect(markSpawnProposalApproved(root, "p1")).resolves.toMatchObject({ status: "approved" });
    await expect(markSpawnProposalAcceptedWaiting(root, "p1")).resolves.toMatchObject({ status: "accepted_waiting" });
    await expect(markSpawnProposalDiscarded(root, "p2")).resolves.toMatchObject({ status: "discarded" });
    clearSpawnProposalQueueCacheForTest();

    expect(await listPendingSpawnProposals(root)).toEqual([]);
    expect((await loadSpawnProposalQueue(root)).map((entry) => [entry.proposalId, entry.status])).toEqual([
      ["p1", "accepted_waiting"],
      ["p2", "discarded"]
    ]);
    expect((await readFile(spawnProposalLedgerPath(root), "utf8")).trim().split("\n")).toHaveLength(5);
  });
});

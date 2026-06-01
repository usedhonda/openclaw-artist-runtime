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
  markSpawnProposalBuilding,
  markSpawnProposalDismissed,
  markSpawnProposalDone,
  spawnProposalLedgerPath
} from "../src/services/spawnProposalQueue";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-spawn-proposal-queue-"));
}

function proposal(id: string): SpawnProposal {
  return {
    proposalId: id,
    createdAt: `2026-05-28T00:00:0${id.at(-1) ?? "0"}.000Z`,
    status: "draft",
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

  it("appends drafts to the runtime ledger and lists draft entries", async () => {
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

  it("keeps drafts permanently without enforcing a queue limit", async () => {
    const root = workspace();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    await appendSpawnProposal(root, proposal("p1"), { now: 1 });
    await appendSpawnProposal(root, proposal("p2"), { now: 2 });
    await appendSpawnProposal(root, proposal("p3"), { now: 3 });
    await appendSpawnProposal(root, proposal("p4"), { now: 4 });

    unsubscribe();
    expect((await listPendingSpawnProposals(root)).map((entry) => entry.proposalId)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(events.filter((event) => event.type === "spawn_proposal_appended")).toHaveLength(4);
    expect(events.some((event) => event.type === "spawn_proposal_queue_full")).toBe(false);
  });

  it("records status transitions append-only and rebuilds latest state on load", async () => {
    const root = workspace();

    await appendSpawnProposal(root, proposal("p1"));
    await appendSpawnProposal(root, proposal("p2"));
    await expect(markSpawnProposalBuilding(root, "p1")).resolves.toMatchObject({ status: "building" });
    await expect(markSpawnProposalDone(root, "p1")).resolves.toMatchObject({ status: "done" });
    await expect(markSpawnProposalDismissed(root, "p2")).resolves.toMatchObject({ status: "dismissed" });
    clearSpawnProposalQueueCacheForTest();

    expect(await listPendingSpawnProposals(root)).toEqual([]);
    expect((await loadSpawnProposalQueue(root)).map((entry) => [entry.proposalId, entry.status])).toEqual([
      ["p1", "done"],
      ["p2", "dismissed"]
    ]);
    expect((await readFile(spawnProposalLedgerPath(root), "utf8")).trim().split("\n")).toHaveLength(5);
  });

  it("normalizes old queue statuses into draft-box statuses on load", async () => {
    const root = workspace();
    await appendSpawnProposal(root, { ...proposal("p1"), status: "pending" as never });
    await appendSpawnProposal(root, { ...proposal("p2"), status: "approved" as never });
    await appendSpawnProposal(root, { ...proposal("p3"), status: "accepted_waiting" as never });
    await appendSpawnProposal(root, { ...proposal("p4"), status: "discarded" as never });
    clearSpawnProposalQueueCacheForTest();

    expect((await loadSpawnProposalQueue(root)).map((entry) => [entry.proposalId, entry.status])).toEqual([
      ["p1", "draft"],
      ["p2", "draft"],
      ["p3", "draft"],
      ["p4", "dismissed"]
    ]);
  });
});

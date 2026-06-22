import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { SpawnProposal } from "../src/types";
import { appendSpawnProposal, clearSpawnProposalQueueCacheForTest, markSpawnProposalBuilding, markSpawnProposalDismissed, markSpawnProposalDone } from "../src/services/spawnProposalQueue";
import { createProducerProposalInbox } from "../src/services/producerProposalInbox";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-producer-inbox-"));
}

function proposal(id: string, title: string, createdAt: string, overrides: Partial<SpawnProposal> = {}): SpawnProposal {
  return {
    proposalId: id,
    createdAt,
    status: "draft",
    title,
    voiceTop: `ゆずるさん、${title}で行く案がある。`,
    coreTheme: overrides.coreTheme ?? `${title}の違和感`,
    observationSources: overrides.observationSources ?? [
      { kind: "news", label: "石油", quote: "赤い看板とナフサ価格", url: "https://example.com/news" }
    ],
    motifRank: 1,
    cascadeTrace: overrides.cascadeTrace ?? {
      observationSources: [
        { kind: "news", label: "石油", quote: "赤い看板とナフサ価格", url: "https://example.com/news" }
      ],
      artistVoice: `ゆずるさん、${title}で行く案がある。`,
      title,
      lyricsTheme: overrides.coreTheme ?? `${title}の違和感`,
      styleLayer: "dry male vocal, spacious hook"
    },
    ...overrides
  };
}

describe("ProducerProposalInbox", () => {
  beforeEach(() => {
    clearSpawnProposalQueueCacheForTest();
  });

  it("normalizes draft proposals into stable inbox labels", async () => {
    const root = workspace();
    await appendSpawnProposal(root, proposal("spawn_old", "ロビーの時計", "2026-06-20T00:00:00.000Z"));
    await appendSpawnProposal(root, proposal("spawn_377f64", "ナフサと赤星", "2026-06-21T00:00:00.000Z"));

    const inbox = createProducerProposalInbox(root, { now: new Date("2026-06-23T00:00:00.000Z") });
    const entries = await inbox.list();

    expect(entries.map((entry) => entry.number)).toEqual(["01", "02"]);
    expect(entries[0]).toMatchObject({
      proposalId: "spawn_377f64",
      shortId: "P-377f64",
      title: "ナフサと赤星",
      sourceSummary: "news: 石油/赤い看板とナフサ価格",
      age: "2日前"
    });
    expect(entries[0].label).toBe("01 | ナフサと赤星 | news: 石油/赤い看板とナフサ価格 | 2日前 | P-377f64");
  });

  it("searches by partial title so a producer can find a named proposal", async () => {
    const root = workspace();
    await appendSpawnProposal(root, proposal("spawn_377f64", "ナフサと赤星", "2026-06-21T00:00:00.000Z"));
    await appendSpawnProposal(root, proposal("spawn_clock", "ロビーの時計", "2026-06-20T00:00:00.000Z"));

    const inbox = createProducerProposalInbox(root, { now: new Date("2026-06-23T00:00:00.000Z") });

    await expect(inbox.search("ナフサ")).resolves.toMatchObject([
      { proposalId: "spawn_377f64", title: "ナフサと赤星" }
    ]);
    await expect(inbox.search("赤星")).resolves.toMatchObject([
      { proposalId: "spawn_377f64", title: "ナフサと赤星" }
    ]);
  });

  it("pages backlog without dismissing or superseding old drafts", async () => {
    const root = workspace();
    for (let index = 0; index < 10; index += 1) {
      await appendSpawnProposal(root, proposal(`spawn_${index}`, `草稿 ${index}`, `2026-06-${String(1 + index).padStart(2, "0")}T00:00:00.000Z`));
    }

    const inbox = createProducerProposalInbox(root, { now: new Date("2026-06-23T00:00:00.000Z"), pageSize: 5 });
    const first = await inbox.page(0);
    const second = await inbox.page(1);
    const all = await inbox.list();

    expect(first.entries).toHaveLength(5);
    expect(first.hasNext).toBe(true);
    expect(second.entries).toHaveLength(5);
    expect(second.hasPrevious).toBe(true);
    expect(all).toHaveLength(10);
    expect(all.filter((entry) => entry.flags.includes("stale")).length).toBeGreaterThan(0);
  });

  it("summarizes latest statuses while keeping draft as the default operating surface", async () => {
    const root = workspace();
    await appendSpawnProposal(root, proposal("spawn_draft", "ナフサと赤星", "2026-06-21T00:00:00.000Z"));
    await appendSpawnProposal(root, proposal("spawn_build", "ロビーの時計", "2026-06-20T00:00:00.000Z"));
    await appendSpawnProposal(root, proposal("spawn_done", "火葬場の出口", "2026-06-19T00:00:00.000Z"));
    await appendSpawnProposal(root, proposal("spawn_dismiss", "スムーズ教", "2026-06-18T00:00:00.000Z"));
    await markSpawnProposalBuilding(root, "spawn_build");
    await markSpawnProposalDone(root, "spawn_done");
    await markSpawnProposalDismissed(root, "spawn_dismiss");

    const summary = await createProducerProposalInbox(root, { now: new Date("2026-06-23T00:00:00.000Z") }).summary();

    expect(summary).toMatchObject({
      totalCount: 4,
      draftCount: 1,
      buildingCount: 1,
      doneCount: 1,
      dismissedCount: 1,
      newestTitle: "ナフサと赤星",
      nextAction: "/proposals で提案一覧を見る"
    });
  });

  it("returns a snapshot with summary, page, and generated timestamp", async () => {
    const root = workspace();
    await appendSpawnProposal(root, proposal("spawn_377f64", "ナフサと赤星", "2026-06-21T00:00:00.000Z"));

    const snapshot = await createProducerProposalInbox(root, { now: new Date("2026-06-23T00:00:00.000Z") }).snapshot();

    expect(snapshot.generatedAt).toBe("2026-06-23T00:00:00.000Z");
    expect(snapshot.summary.draftCount).toBe(1);
    expect(snapshot.page.entries[0]).toMatchObject({
      number: "01",
      title: "ナフサと赤星"
    });
  });
});

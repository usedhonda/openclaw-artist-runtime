import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { writeAutopilotRunState } from "../src/services/autopilotService";
import { markCallbackResolved, readCallbackActionEntries, registerCallbackAction, type CallbackActionEntry } from "../src/services/callbackActionRegistry";
import {
  runStaleQueueMaintenance,
  staleQueueCleanupAuditPath
} from "../src/services/staleQueueMaintenance";
import {
  clearSpawnProposalQueueCacheForTest,
  listAcceptedWaitingSpawnProposals,
  listPendingSpawnProposals,
  loadSpawnProposalQueue,
  spawnProposalLedgerPath
} from "../src/services/spawnProposalQueue";
import type { AutopilotRunState, CommissionBrief, SpawnProposal } from "../src/types";

type SpawnProposalLedgerIssueReason =
  | "stale_pending"
  | "applied_callback_pending_proposal"
  | "current_song_pending_proposal"
  | "accepted_waiting_without_applied_callback";

interface SpawnProposalLedgerIssue {
  proposalId: string;
  status: SpawnProposal["status"];
  reason: SpawnProposalLedgerIssueReason;
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "artist-runtime-spawn-proposal-stale-"));
}

function brief(songId: string): CommissionBrief {
  return {
    songId,
    title: `title ${songId}`,
    brief: "Queue proposal under producer review.",
    lyricsTheme: "街の違和感を短いサビに畳む。",
    mood: "tense",
    tempo: "142 BPM",
    duration: "2:45",
    styleNotes: "dry male vocal, restrained hi-hats, thick bass",
    sourceText: "test",
    createdAt: "2026-05-28T00:00:00.000Z"
  };
}

function proposal(
  proposalId: string,
  status: SpawnProposal["status"],
  createdAt = "2026-05-28T00:00:00.000Z"
): SpawnProposal {
  return {
    proposalId,
    createdAt,
    status,
    title: `proposal ${proposalId}`,
    voiceTop: "次の曲、ここから考える。",
    coreTheme: `core theme ${proposalId}`,
    observationSources: [
      { kind: "news", label: "news", quote: "街の違和感", url: "https://example.com/news" }
    ],
    motifRank: 1,
    cascadeTrace: {
      observationSources: [
        { kind: "news", label: "news", quote: "街の違和感", url: "https://example.com/news" }
      ],
      artistVoice: "街の違和感を切る。",
      title: `proposal ${proposalId}`,
      lyricsTheme: `core theme ${proposalId}`,
      styleLayer: "dry male vocal, restrained hi-hats"
    }
  };
}

async function writeProposalLedger(root: string, entries: SpawnProposal[]): Promise<void> {
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(spawnProposalLedgerPath(root), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function latestCallbacks(entries: CallbackActionEntry[]): CallbackActionEntry[] {
  const latest = new Map<string, CallbackActionEntry>();
  for (const entry of entries) {
    latest.set(entry.callbackId, entry);
  }
  return [...latest.values()];
}

function callbackMatchesProposal(entry: CallbackActionEntry, proposal: SpawnProposal): boolean {
  return entry.action === "song_spawn_inject"
    && (entry.proposalId === proposal.proposalId
      || entry.songId === proposal.proposalId
      || entry.commissionBrief?.songId === proposal.proposalId);
}

async function detectSpawnProposalLedgerIssues(
  root: string,
  options: { now: Date; staleHours: number; state?: AutopilotRunState }
): Promise<SpawnProposalLedgerIssue[]> {
  const cutoff = options.now.getTime() - options.staleHours * 60 * 60 * 1000;
  const proposals = await loadSpawnProposalQueue(root, { force: true });
  const callbacks = latestCallbacks(await readCallbackActionEntries(root));
  const issues: SpawnProposalLedgerIssue[] = [];

  for (const item of proposals) {
    const hasAppliedInject = callbacks.some((entry) => entry.status === "applied" && callbackMatchesProposal(entry, item));
    if (item.status === "pending" && Date.parse(item.createdAt) < cutoff) {
      issues.push({ proposalId: item.proposalId, status: item.status, reason: "stale_pending" });
    }
    if (item.status === "pending" && hasAppliedInject) {
      issues.push({ proposalId: item.proposalId, status: item.status, reason: "applied_callback_pending_proposal" });
    }
    if (item.status === "pending" && options.state?.currentSongId === item.proposalId) {
      issues.push({ proposalId: item.proposalId, status: item.status, reason: "current_song_pending_proposal" });
    }
    if (item.status === "accepted_waiting" && !hasAppliedInject) {
      issues.push({ proposalId: item.proposalId, status: item.status, reason: "accepted_waiting_without_applied_callback" });
    }
  }

  return issues;
}

async function readAuditLines(root: string): Promise<Array<Record<string, unknown>>> {
  return readFile(staleQueueCleanupAuditPath(root), "utf8")
    .then((text) => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>));
}

describe("spawn proposal stale ledger invariants", () => {
  it("rebuilds latest proposal status from the append-only jsonl ledger at startup", async () => {
    const root = await tempRoot();
    await writeProposalLedger(root, [
      proposal("spawn-old", "pending", "2026-05-28T00:00:00.000Z"),
      proposal("spawn-waiting", "pending", "2026-05-28T00:01:00.000Z"),
      proposal("spawn-old", "accepted_waiting", "2026-05-28T00:02:00.000Z"),
      proposal("spawn-old", "approved", "2026-05-28T00:03:00.000Z")
    ]);

    clearSpawnProposalQueueCacheForTest();

    expect((await loadSpawnProposalQueue(root, { force: true })).map((entry) => [entry.proposalId, entry.status])).toEqual([
      ["spawn-waiting", "pending"],
      ["spawn-old", "approved"]
    ]);
    await expect(listPendingSpawnProposals(root)).resolves.toMatchObject([{ proposalId: "spawn-waiting", status: "pending" }]);
    await expect(listAcceptedWaitingSpawnProposals(root)).resolves.toEqual([]);
  });

  it("detects stale pending, applied callback, current song, and accepted_waiting inconsistencies", async () => {
    const root = await tempRoot();
    await writeProposalLedger(root, [
      proposal("spawn-stale", "pending", "2026-05-27T00:00:00.000Z"),
      proposal("spawn-applied", "pending", "2026-05-28T00:00:00.000Z"),
      proposal("spawn-current", "pending", "2026-05-28T00:00:00.000Z"),
      proposal("spawn-orphan-waiting", "accepted_waiting", "2026-05-28T00:00:00.000Z")
    ]);
    const applied = await registerCallbackAction(root, {
      action: "song_spawn_inject",
      proposalId: "spawn-applied",
      songId: "spawn-applied",
      commissionBrief: brief("spawn-applied"),
      chatId: 1,
      messageId: 2,
      userId: 3,
      now: Date.parse("2026-05-28T01:00:00.000Z")
    });
    await markCallbackResolved(root, applied.callbackId, {
      status: "applied",
      reason: "song_spawn_injected",
      now: Date.parse("2026-05-28T01:01:00.000Z")
    });
    await registerCallbackAction(root, {
      action: "song_spawn_inject",
      proposalId: "spawn-current",
      songId: "spawn-current",
      commissionBrief: brief("spawn-current"),
      chatId: 1,
      messageId: 3,
      userId: 3,
      now: Date.parse("2026-05-28T01:00:00.000Z")
    });
    await writeAutopilotRunState(root, {
      runId: "run-current",
      currentSongId: "spawn-current",
      stage: "planning",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: "2026-05-28T01:00:00.000Z"
    });
    const issues = await detectSpawnProposalLedgerIssues(root, {
      now: new Date("2026-05-28T13:00:00.000Z"),
      staleHours: 12,
      state: {
        runId: "run-current",
        currentSongId: "spawn-current",
        stage: "planning",
        paused: false,
        retryCount: 0,
        cycleCount: 0,
        updatedAt: "2026-05-28T01:00:00.000Z"
      }
    });

    expect(issues).toEqual(expect.arrayContaining([
      { proposalId: "spawn-stale", status: "pending", reason: "stale_pending" },
      { proposalId: "spawn-applied", status: "pending", reason: "applied_callback_pending_proposal" },
      { proposalId: "spawn-current", status: "pending", reason: "current_song_pending_proposal" },
      { proposalId: "spawn-orphan-waiting", status: "accepted_waiting", reason: "accepted_waiting_without_applied_callback" }
    ]));
  });

  it("audits and expires pending producer callbacks for terminal songs instead of leaving silent drift", async () => {
    const root = await tempRoot();
    await ensureSongState(root, "spawn-terminal", "terminal proposal");
    await updateSongState(root, "spawn-terminal", { status: "archived", reason: "producer archived" });
    const callback = await registerCallbackAction(root, {
      action: "song_spawn_inject",
      proposalId: "spawn-terminal",
      songId: "spawn-terminal",
      commissionBrief: brief("spawn-terminal"),
      chatId: 1,
      messageId: 2,
      userId: 3,
      now: Date.parse("2026-05-28T00:00:00.000Z")
    });

    const result = await runStaleQueueMaintenance(root, {
      now: new Date("2026-05-28T01:00:00.000Z"),
      ttlHours: 168
    });

    expect(result.inconsistencies).toEqual([expect.objectContaining({
      callbackId: callback.callbackId,
      action: "song_spawn_inject",
      songId: "spawn-terminal",
      status: "pending",
      reason: "pending_callback_terminal_song"
    })]);
    expect(result.resolvedCallbacks).toEqual([expect.objectContaining({ callbackId: callback.callbackId })]);
    await expect(readAuditLines(root)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "callback_ledger_inconsistency", callbackId: callback.callbackId }),
      expect.objectContaining({ type: "callback_ledger_auto_expired", callbackId: callback.callbackId })
    ]));
  });
});

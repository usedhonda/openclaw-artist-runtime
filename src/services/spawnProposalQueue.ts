import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SpawnProposal, SpawnProposalStatus } from "../types.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";

export const SPAWN_PROPOSAL_QUEUE_LIMIT = 3;

const cache = new Map<string, SpawnProposal[]>();

export function spawnProposalLedgerPath(root: string): string {
  return join(root, "runtime", "spawn-proposals.jsonl");
}

function activePending(proposals: SpawnProposal[]): SpawnProposal[] {
  return proposals.filter((proposal) => proposal.status === "pending");
}

function latestByProposalId(entries: SpawnProposal[]): SpawnProposal[] {
  const latest = new Map<string, SpawnProposal>();
  for (const entry of entries) {
    latest.set(entry.proposalId, entry);
  }
  return [...latest.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

async function writeProposal(root: string, proposal: SpawnProposal): Promise<void> {
  const path = spawnProposalLedgerPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(proposal)}\n`, "utf8");
}

export async function loadSpawnProposalQueue(root: string, options: { force?: boolean } = {}): Promise<SpawnProposal[]> {
  if (!options.force && cache.has(root)) {
    return [...cache.get(root)!];
  }
  const contents = await readFile(spawnProposalLedgerPath(root), "utf8").catch(() => "");
  const entries = contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SpawnProposal);
  const latest = latestByProposalId(entries);
  cache.set(root, latest);
  return [...latest];
}

export async function listPendingSpawnProposals(root: string): Promise<SpawnProposal[]> {
  return activePending(await loadSpawnProposalQueue(root));
}

export async function listAcceptedWaitingSpawnProposals(root: string): Promise<SpawnProposal[]> {
  return (await loadSpawnProposalQueue(root)).filter((proposal) => proposal.status === "accepted_waiting");
}

export async function appendSpawnProposal(
  root: string,
  proposal: SpawnProposal,
  options: { limit?: number; now?: number } = {}
): Promise<SpawnProposal> {
  const limit = options.limit ?? SPAWN_PROPOSAL_QUEUE_LIMIT;
  const proposals = await loadSpawnProposalQueue(root);
  const pendingCount = activePending(proposals).length;
  if (pendingCount >= limit) {
    emitRuntimeEvent({
      type: "spawn_proposal_queue_full",
      proposalId: proposal.proposalId,
      limit,
      pendingCount,
      timestamp: options.now ?? Date.now()
    });
    throw new Error(`spawn_proposal_queue_full:${pendingCount}/${limit}`);
  }
  await writeProposal(root, proposal);
  const next = [...proposals.filter((entry) => entry.proposalId !== proposal.proposalId), proposal]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  cache.set(root, next);
  emitRuntimeEvent({
    type: "spawn_proposal_appended",
    proposalId: proposal.proposalId,
    pendingCount: pendingCount + (proposal.status === "pending" ? 1 : 0),
    timestamp: options.now ?? Date.now()
  });
  return proposal;
}

async function markSpawnProposalStatus(root: string, proposalId: string, status: SpawnProposalStatus): Promise<SpawnProposal> {
  const proposals = await loadSpawnProposalQueue(root);
  const current = proposals.find((proposal) => proposal.proposalId === proposalId);
  if (!current) {
    throw new Error(`spawn_proposal_not_found:${proposalId}`);
  }
  const updated: SpawnProposal = { ...current, status };
  await writeProposal(root, updated);
  cache.set(root, proposals.map((proposal) => proposal.proposalId === proposalId ? updated : proposal));
  return updated;
}

export function markSpawnProposalApproved(root: string, proposalId: string): Promise<SpawnProposal> {
  return markSpawnProposalStatus(root, proposalId, "approved");
}

export function markSpawnProposalDiscarded(root: string, proposalId: string): Promise<SpawnProposal> {
  return markSpawnProposalStatus(root, proposalId, "discarded");
}

export function markSpawnProposalAcceptedWaiting(root: string, proposalId: string): Promise<SpawnProposal> {
  return markSpawnProposalStatus(root, proposalId, "accepted_waiting");
}

export function clearSpawnProposalQueueCacheForTest(): void {
  cache.clear();
}

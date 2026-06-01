import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SpawnProposal, SpawnProposalStatus } from "../types.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";

const cache = new Map<string, SpawnProposal[]>();

export function spawnProposalLedgerPath(root: string): string {
  return join(root, "runtime", "spawn-proposals.jsonl");
}

function draftProposals(proposals: SpawnProposal[]): SpawnProposal[] {
  return proposals.filter((proposal) => proposal.status === "draft");
}

function normalizeLegacyStatus(status: string): SpawnProposalStatus {
  switch (status) {
    case "draft":
    case "building":
    case "done":
    case "dismissed":
      return status;
    case "discarded":
      return "dismissed";
    case "pending":
    case "approved":
    case "accepted_waiting":
    default:
      return "draft";
  }
}

function normalizeProposal(entry: SpawnProposal): SpawnProposal {
  return { ...entry, status: normalizeLegacyStatus(String(entry.status)) };
}

function latestByProposalId(entries: SpawnProposal[]): SpawnProposal[] {
  const latest = new Map<string, SpawnProposal>();
  for (const entry of entries) {
    latest.set(entry.proposalId, normalizeProposal(entry));
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
  return draftProposals(await loadSpawnProposalQueue(root));
}

export async function listBuildingSpawnProposals(root: string): Promise<SpawnProposal[]> {
  return (await loadSpawnProposalQueue(root)).filter((proposal) => proposal.status === "building");
}

export async function appendSpawnProposal(
  root: string,
  proposal: SpawnProposal,
  options: { now?: number } = {}
): Promise<SpawnProposal> {
  const proposals = await loadSpawnProposalQueue(root);
  const normalized = normalizeProposal({ ...proposal, status: normalizeLegacyStatus(String(proposal.status)) });
  await writeProposal(root, normalized);
  const next = [...proposals.filter((entry) => entry.proposalId !== normalized.proposalId), normalized]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  cache.set(root, next);
  emitRuntimeEvent({
    type: "spawn_proposal_appended",
    proposalId: normalized.proposalId,
    pendingCount: draftProposals(next).length,
    timestamp: options.now ?? Date.now()
  });
  return normalized;
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

export function markSpawnProposalBuilding(root: string, proposalId: string): Promise<SpawnProposal> {
  return markSpawnProposalStatus(root, proposalId, "building");
}

export function markSpawnProposalDone(root: string, proposalId: string): Promise<SpawnProposal> {
  return markSpawnProposalStatus(root, proposalId, "done");
}

export function markSpawnProposalDismissed(root: string, proposalId: string): Promise<SpawnProposal> {
  return markSpawnProposalStatus(root, proposalId, "dismissed");
}

export function clearSpawnProposalQueueCacheForTest(): void {
  cache.clear();
}

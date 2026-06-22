import type { SpawnProposal, SpawnProposalStatus } from "../types.js";
import { loadSpawnProposalQueue } from "./spawnProposalQueue.js";

export const PRODUCER_PROPOSAL_INBOX_PAGE_SIZE = 5;

export interface ProducerProposalInboxEntry {
  number: string;
  proposalId: string;
  shortId: string;
  label: string;
  createdAt: string;
  status: SpawnProposalStatus;
  title: string;
  sourceSummary: string;
  age: string;
  voiceTop: string;
  coreTheme: string;
  observationSources: SpawnProposal["observationSources"];
  motifRank?: number;
  cascadeTrace: SpawnProposal["cascadeTrace"];
  flags: Array<"stale" | "maybe_duplicate">;
  proposal: SpawnProposal;
}

export interface ProducerProposalInboxSummary {
  totalCount: number;
  draftCount: number;
  buildingCount: number;
  doneCount: number;
  dismissedCount: number;
  defaultPageSize: number;
  pageCount: number;
  newestTitle?: string;
  nextAction: string;
}

export interface ProducerProposalInboxPage {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  totalCount: number;
  entries: ProducerProposalInboxEntry[];
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface ProducerProposalInboxSnapshot {
  summary: ProducerProposalInboxSummary;
  page: ProducerProposalInboxPage;
  generatedAt: string;
}

export interface ProducerProposalInboxOptions {
  now?: Date;
  pageSize?: number;
}

function padNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function shortProposalId(proposalId: string): string {
  return `P-${proposalId.replace(/^spawn_/, "").replace(/^proposal_/, "").slice(0, 6)}`;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function proposalTimestamp(proposal: SpawnProposal): number {
  const timestamp = Date.parse(proposal.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortForInbox(proposals: SpawnProposal[]): SpawnProposal[] {
  return [...proposals].sort((left, right) => proposalTimestamp(right) - proposalTimestamp(left) || left.proposalId.localeCompare(right.proposalId));
}

function ageLabel(createdAt: string, now: Date): string {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return "日時不明";
  const diffMs = Math.max(0, now.getTime() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

function compactToken(value: string | undefined): string | undefined {
  const token = value?.trim().replace(/\s+/g, " ");
  return token ? token.slice(0, 16) : undefined;
}

function sourceTokens(proposal: SpawnProposal): string[] {
  const tokens: string[] = [];
  for (const source of proposal.observationSources ?? []) {
    tokens.push(...[
      compactToken(source.label),
      compactToken(source.quote)
    ].filter((value): value is string => Boolean(value)));
  }
  tokens.push(...[
    compactToken(proposal.coreTheme),
    compactToken(proposal.cascadeTrace.lyricsTheme)
  ].filter((value): value is string => Boolean(value)));
  return [...new Set(tokens)].slice(0, 2);
}

function sourceSummary(proposal: SpawnProposal): string {
  const kind = proposal.observationSources?.[0]?.kind ?? proposal.cascadeTrace.observationSources?.[0]?.kind ?? "artist";
  const tokens = sourceTokens(proposal);
  return tokens.length > 0 ? `${kind}: ${tokens.join("/")}` : `${kind}: 観察`;
}

function duplicateKeys(proposals: SpawnProposal[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const proposal of proposals) {
    const key = normalizeText(`${proposal.title}:${proposal.coreTheme}`);
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }
  return duplicates;
}

function flagsForProposal(proposal: SpawnProposal, proposals: SpawnProposal[], now: Date): ProducerProposalInboxEntry["flags"] {
  const flags: ProducerProposalInboxEntry["flags"] = [];
  if (now.getTime() - proposalTimestamp(proposal) > 14 * 24 * 60 * 60 * 1000) {
    flags.push("stale");
  }
  if (duplicateKeys(proposals).has(normalizeText(`${proposal.title}:${proposal.coreTheme}`))) {
    flags.push("maybe_duplicate");
  }
  return flags;
}

function toEntry(proposal: SpawnProposal, index: number, proposals: SpawnProposal[], now: Date): ProducerProposalInboxEntry {
  const number = padNumber(index);
  const shortId = shortProposalId(proposal.proposalId);
  const source = sourceSummary(proposal);
  return {
    number,
    proposalId: proposal.proposalId,
    shortId,
    label: `${number} | ${proposal.title} | ${source} | ${ageLabel(proposal.createdAt, now)} | ${shortId}`,
    createdAt: proposal.createdAt,
    status: proposal.status,
    title: proposal.title,
    sourceSummary: source,
    age: ageLabel(proposal.createdAt, now),
    voiceTop: proposal.voiceTop,
    coreTheme: proposal.coreTheme,
    observationSources: proposal.observationSources,
    motifRank: proposal.motifRank,
    cascadeTrace: proposal.cascadeTrace,
    flags: flagsForProposal(proposal, proposals, now),
    proposal
  };
}

function pageSize(options: ProducerProposalInboxOptions): number {
  const value = Math.floor(options.pageSize ?? PRODUCER_PROPOSAL_INBOX_PAGE_SIZE);
  return value > 0 ? value : PRODUCER_PROPOSAL_INBOX_PAGE_SIZE;
}

export class ProducerProposalInbox {
  constructor(private readonly root: string, private readonly options: ProducerProposalInboxOptions = {}) {}

  private now(): Date {
    return this.options.now ?? new Date();
  }

  private async entries(): Promise<ProducerProposalInboxEntry[]> {
    const proposals = sortForInbox(await loadSpawnProposalQueue(this.root, { force: true }));
    const now = this.now();
    return proposals.map((proposal, index) => toEntry(proposal, index, proposals, now));
  }

  async list(status: SpawnProposalStatus | "all" = "draft"): Promise<ProducerProposalInboxEntry[]> {
    const entries = await this.entries();
    return status === "all" ? entries : entries.filter((entry) => entry.status === status);
  }

  async search(query: string): Promise<ProducerProposalInboxEntry[]> {
    const needle = normalizeText(query);
    if (!needle) return this.list("draft");
    return (await this.list("all")).filter((entry) => normalizeText(entry.title).includes(needle));
  }

  async page(index = 0, status: SpawnProposalStatus | "all" = "draft"): Promise<ProducerProposalInboxPage> {
    const entries = await this.list(status);
    const size = pageSize(this.options);
    const pageCount = Math.max(1, Math.ceil(entries.length / size));
    const safeIndex = Math.min(Math.max(0, Math.floor(index)), pageCount - 1);
    const start = safeIndex * size;
    return {
      pageIndex: safeIndex,
      pageSize: size,
      pageCount,
      totalCount: entries.length,
      entries: entries.slice(start, start + size),
      hasNext: safeIndex + 1 < pageCount,
      hasPrevious: safeIndex > 0
    };
  }

  async summary(): Promise<ProducerProposalInboxSummary> {
    const entries = await this.entries();
    const draftEntries = entries.filter((entry) => entry.status === "draft");
    return {
      totalCount: entries.length,
      draftCount: draftEntries.length,
      buildingCount: entries.filter((entry) => entry.status === "building").length,
      doneCount: entries.filter((entry) => entry.status === "done").length,
      dismissedCount: entries.filter((entry) => entry.status === "dismissed").length,
      defaultPageSize: pageSize(this.options),
      pageCount: Math.max(1, Math.ceil(draftEntries.length / pageSize(this.options))),
      newestTitle: draftEntries[0]?.title,
      nextAction: draftEntries.length > 0 ? "/proposals で提案一覧を見る" : "草稿箱は空。アーティストが次の提案を考えています"
    };
  }

  async snapshot(index = 0): Promise<ProducerProposalInboxSnapshot> {
    return {
      summary: await this.summary(),
      page: await this.page(index),
      generatedAt: this.now().toISOString()
    };
  }
}

export function createProducerProposalInbox(root: string, options: ProducerProposalInboxOptions = {}): ProducerProposalInbox {
  return new ProducerProposalInbox(root, options);
}

import type { SunoArtifactsPageResponse } from "../types.js";
import { buildSunoArtifactIndex } from "./sunoRuns.js";

export const DEFAULT_SUNO_ARTIFACT_PAGE_LIMIT = 20;
export const MAX_SUNO_ARTIFACT_PAGE_LIMIT = 100;
export const STATUS_SUNO_ARTIFACT_LIMIT = 8;

function sanitizeInteger(value: unknown, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function normalizeSunoArtifactPagination(offset: unknown, limit: unknown): { offset: number; limit: number } {
  return {
    offset: Math.max(0, sanitizeInteger(offset, 0)),
    limit: Math.min(MAX_SUNO_ARTIFACT_PAGE_LIMIT, Math.max(1, sanitizeInteger(limit, DEFAULT_SUNO_ARTIFACT_PAGE_LIMIT)))
  };
}

export async function buildSunoArtifactsPage(root: string, offset?: unknown, limit?: unknown): Promise<SunoArtifactsPageResponse> {
  const normalized = normalizeSunoArtifactPagination(offset, limit);
  const artifacts = await buildSunoArtifactIndex(root);
  const page = artifacts.slice(normalized.offset, normalized.offset + normalized.limit);
  return {
    artifacts: page,
    totalCount: artifacts.length,
    offset: normalized.offset,
    limit: normalized.limit,
    hasMore: normalized.offset + normalized.limit < artifacts.length
  };
}

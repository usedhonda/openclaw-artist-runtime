import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AiReviewProvider, DebugAiReviewInput, DebugAiReviewResult } from "../types.js";
import { callAiProvider } from "./aiProviderClient.js";

export interface DebugAiReviewer {
  review(input: DebugAiReviewInput): Promise<DebugAiReviewResult>;
}

function timestampForPath(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function nowIso(): string {
  return new Date().toISOString();
}

export class MockDebugAiReviewer implements DebugAiReviewer {
  async review(input: DebugAiReviewInput): Promise<DebugAiReviewResult> {
    return {
      songId: input.songId,
      score: 0,
      summary: "Mock provider: debug review placeholder only. No take selection was changed.",
      reasons: [
        `Read ${input.takes.length} take(s).`,
        input.selectedTake ? "Existing selected take was observed read-only." : "No selected take was present."
      ],
      cautions: [],
      provider: "mock",
      createdAt: nowIso()
    };
  }
}

class NotConfiguredDebugAiReviewer implements DebugAiReviewer {
  constructor(private readonly provider: AiReviewProvider) {}

  async review(input: DebugAiReviewInput): Promise<DebugAiReviewResult> {
    const summary = await callAiProvider(`Debug review unavailable for ${input.songId}`, { provider: this.provider });
    return {
      songId: input.songId,
      score: 0,
      summary: `${summary} Debug review did not call an external model.`,
      reasons: [],
      cautions: ["Configure a debug AI provider before expecting scored review output."],
      provider: "not_configured",
      createdAt: nowIso()
    };
  }
}

export function createDebugAiReviewer(provider: AiReviewProvider | undefined = "mock"): DebugAiReviewer {
  return provider === "mock" ? new MockDebugAiReviewer() : new NotConfiguredDebugAiReviewer(provider);
}

export function formatDebugAiReviewResult(result: DebugAiReviewResult): string {
  return [
    `Debug review: ${result.songId}`,
    `Provider: ${result.provider}`,
    `Score: ${result.score}`,
    `Summary: ${result.summary}`,
    result.reasons.length > 0 ? `Reasons: ${result.reasons.join(" / ")}` : undefined,
    result.cautions.length > 0 ? `Cautions: ${result.cautions.join(" / ")}` : undefined
  ].filter(Boolean).join("\n");
}

export async function saveDebugAiReviewResult(
  root: string,
  result: DebugAiReviewResult,
  timestamp = timestampForPath()
): Promise<DebugAiReviewResult> {
  const outputPath = join(root, "runtime", "debug-ai-reviews", `${result.songId}-${timestamp}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  const withPath = { ...result, outputPath };
  await writeFile(outputPath, `${JSON.stringify(withPath, null, 2)}\n`, "utf8");
  return withPath;
}

export async function reviewSongDebugMaterial(
  root: string,
  input: DebugAiReviewInput,
  provider?: AiReviewProvider
): Promise<DebugAiReviewResult> {
  const reviewer = createDebugAiReviewer(provider);
  const result = await reviewer.review(input);
  return saveDebugAiReviewResult(root, result);
}

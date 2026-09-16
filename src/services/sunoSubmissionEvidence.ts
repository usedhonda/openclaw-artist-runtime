import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Request, Response } from "playwright";
import type { SunoCreatePayload } from "../types.js";
import { secretLikePattern } from "./personaMigrator.js";

/** Only musical inputs, never a copy of a network request or account metadata. */
export interface SunoSubmissionFields {
  title?: string;
  lyrics?: string;
  style?: string;
  excludeStyles?: string;
  model?: string;
  weirdness?: number;
  styleInfluence?: number;
  audioInfluence?: number;
  variety?: number;
  maxMode?: boolean;
}

export interface SunoEvidenceBinding {
  workspaceRoot: string;
  songId: string;
  runId: string;
}

interface SunoUiControls {
  model?: string; weirdness?: number; styleInfluence?: number; audioInfluence?: number; variety?: number;
  maxMode?: boolean; personalize?: boolean; duration?: string;
}

const ID = /^[a-zA-Z0-9_-]{1,120}$/;
const CLIP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERATE_URL = "https://studio-api-prod.suno.com/api/generate/v2-web/";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string" || value.length > limit || secretLikePattern.test(value)
    || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)) return undefined;
  return value;
}

/** Unknown/omitted fields stay unknown; in particular Off/Auto omission is not false. */
export function sanitizeSunoSubmission(body: unknown): SunoSubmissionFields {
  const input = record(body);
  const metadata = record(input.metadata);
  const sliders = record(metadata.control_sliders);
  const result: SunoSubmissionFields = {};
  for (const [target, source, limit] of [
    ["title", "title", 300], ["lyrics", "prompt", 20000], ["style", "tags", 4000],
    ["excludeStyles", "negative_tags", 2000], ["model", "mv", 100]
  ] as const) {
    const value = safeText(input[source], limit);
    if (value !== undefined) result[target] = value;
  }
  for (const [target, source] of [
    ["weirdness", "weirdness_constraint"], ["styleInfluence", "style_weight"], ["audioInfluence", "audio_weight"]
  ] as const) {
    const value = sliders[source];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) result[target] = Math.round(value * 10000) / 100;
  }
  const variety = sliders.aug_creativity;
  if (typeof variety === "number" && Number.isInteger(variety) && variety >= 0 && variety <= 4) result.variety = variety;
  if (typeof metadata.is_max_mode === "boolean") result.maxMode = metadata.is_max_mode;
  // Personalize and Duration have no confirmed enabled wire mapping. Do not guess it.
  return result;
}

function evidenceDir(binding: SunoEvidenceBinding): string {
  if (!ID.test(binding.songId) || !ID.test(binding.runId)) throw new Error("suno_evidence_invalid_binding");
  return join(binding.workspaceRoot, "songs", binding.songId, "suno-evidence", binding.runId);
}

async function writeEvidence(binding: SunoEvidenceBinding, name: string, data: object): Promise<void> {
  const dir = evidenceDir(binding);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), JSON.stringify({ version: 1, songId: binding.songId, runId: binding.runId,
    observedAt: new Date().toISOString(), ...data }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

export function buildSunoV6Recommendation(payload: SunoCreatePayload) {
  const style = typeof payload.styleAndFeel === "string" ? payload.styleAndFeel : "";
  const exploratory = /\b(?:experimental|collage|unpredictable|polyrhyth|odd[- ]meter|genre[- ]bending)/i.test(style);
  const precise = /\b(?:spoken|sparse|minimal|a cappella|dry close|tight rap)/i.test(style);
  const variety = exploratory ? 3 : precise ? 1 : 2;
  return {
    model: "v6", variety,
    rationale: exploratory
      ? "曲の変則的な展開を広げる試聴用にVariety 3。意図が薄れたら0へ戻して比較する。"
      : precise
        ? "言葉の輪郭と余白を守りつつ、小さな変化を試すVariety 1。忠実さを優先するなら0。"
        : "主ジャンルを保ちながら編成の別案を試すVariety 2。狙いが決まったら0と比較する。",
    personalize: false,
    personalizeReason: "今回は曲の指示を比較しやすくするためOffを提案。My Tasteを使う場合は画面で選ぶ。",
    maxMode: false,
    maxModeReason: "まず通常モードで構成を確認する提案。Max Modeの効果は保証せず、使うかは画面で決める。",
    policy: "recommendation_only_not_applied"
  };
}

export async function writeSunoPreparationEvidence(binding: SunoEvidenceBinding, payload: SunoCreatePayload, prepared: {
  title?: string; lyrics?: string; style?: string; excludeStyles?: string;
  controls: SunoUiControls;
}): Promise<void> {
  // Re-use the strict musical allowlist even for locally prepared inputs.
  const fields = sanitizeSunoSubmission({ title: prepared.title, prompt: prepared.lyrics, tags: prepared.style,
    negative_tags: prepared.excludeStyles, mv: prepared.controls.model });
  const controls = sanitizeUiControls(prepared.controls);
  await writeEvidence(binding, "proposal.json", { recommendation: buildSunoV6Recommendation(payload) });
  await writeEvidence(binding, "prepared.json", { fields, controls, source: "verified_ui_readback" });
}

function sanitizeUiControls(input: SunoUiControls): Record<string, string | number | boolean> {
  const controls: Record<string, string | number | boolean> = {};
  for (const key of ["weirdness", "styleInfluence", "audioInfluence", "variety"] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= (key === "variety" ? 4 : 100)) controls[key] = value;
  }
  for (const key of ["maxMode", "personalize"] as const) {
    if (typeof input[key] === "boolean") controls[key] = input[key];
  }
  const duration = safeText(input.duration, 100);
  if (duration !== undefined) controls.duration = duration;
  const model = safeText(input.model, 100);
  if (model !== undefined) controls.model = model;
  return controls;
}

export async function hasSunoPreparationEvidence(workspaceRoot: string, songId: string, runId: string): Promise<boolean> {
  try {
    const value = record(JSON.parse(await readFile(join(evidenceDir({ workspaceRoot, songId, runId }), "prepared.json"), "utf8")));
    return value.songId === songId && value.runId === runId && value.source === "verified_ui_readback";
  } catch { return false; }
}

export async function readObservedSunoSubmission(workspaceRoot: string, songId: string, runId: string, urls: readonly string[]): Promise<SunoSubmissionFields | undefined> {
  const dir = evidenceDir({ workspaceRoot, songId, runId });
  const matches: SunoSubmissionFields[] = [];
  for (const file of await readdir(dir).catch(() => [])) {
    if (!/^submission-[a-f0-9-]+\.json$/.test(file)) continue;
    const item = record(JSON.parse(await readFile(join(dir, file), "utf8").catch(() => "{}")));
    const clipUrls = Array.isArray(item.urls) ? item.urls : [];
    if (item.songId !== songId || item.runId !== runId || item.source !== "observed_generate_response"
      || !urls.length || !urls.every((url) => clipUrls.includes(url))) continue;
    const f = record(item.fields);
    // Revalidate stored evidence: never promote arbitrary JSON fields to prose.
    matches.push(sanitizeSunoSubmission({ title: f.title, prompt: f.lyrics, tags: f.style, negative_tags: f.excludeStyles,
      mv: f.model, metadata: { is_max_mode: f.maxMode, control_sliders: {
        weirdness_constraint: typeof f.weirdness === "number" ? f.weirdness / 100 : undefined,
        style_weight: typeof f.styleInfluence === "number" ? f.styleInfluence / 100 : undefined,
        audio_weight: typeof f.audioInfluence === "number" ? f.audioInfluence / 100 : undefined, aug_creativity: f.variety
      } } }));
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** Passive, exact-page observer. No request routing, injection, raw bodies, or headers. */
export function observeSunoSubmission(page: Page, binding: SunoEvidenceBinding | undefined, readUi?: () => Promise<SunoUiControls>) {
  const requests = new WeakMap<Request, { fields: SunoSubmissionFields; ui: Promise<object | undefined> }>();
  const pending = new Set<Promise<void>>();
  let accepted: { fields: SunoSubmissionFields; urls: string[] } | undefined;
  let failed = false;
  const request = (req: Request) => {
    try {
      if (req.url() !== GENERATE_URL || req.method() !== "POST" || req.frame() !== page.mainFrame()) return;
      requests.set(req, {
        fields: sanitizeSunoSubmission(req.postDataJSON()),
        // Asynchronous DOM read is explicitly NOT a wire value or an exact click snapshot.
        ui: readUi ? readUi().then((value) => ({ controls: sanitizeUiControls(value),
          sampledAt: new Date().toISOString(), source: "ui_after_request_not_wire" })).catch(() => undefined) : Promise.resolve(undefined)
      });
    } catch { /* Unreadable request means unknown, never raw diagnostics. */ }
  };
  const response = (res: Response) => {
    const capture = requests.get(res.request());
    if (!capture || !res.ok() || accepted) return;
    const task = (async () => {
      const body = record(await res.json());
      const clips = Array.isArray(body.clips) ? body.clips : [];
      const ids = clips.map((clip) => record(clip).id).filter((id): id is string => typeof id === "string" && CLIP_ID.test(id));
      const urls = [...new Set(ids)].map((id) => `https://suno.com/song/${id}`);
      if (urls.length < 1 || urls.length > 2 || accepted) return;
      // A response is authoritative only for the exact observed request on this page.
      const uiNearSubmit = await capture.ui;
      if (binding) await writeEvidence(binding, `submission-${randomUUID()}.json`, { fields: capture.fields, urls, uiNearSubmit, source: "observed_generate_response" });
      accepted = { fields: capture.fields, urls };
    })().catch(() => { failed = true; });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  page.on("request", request);
  page.on("response", response);
  return {
    accepted: () => accepted,
    assertSaved: () => { if (failed) throw new Error("suno_submission_evidence_failed"); },
    async flush() {
      await Promise.all(pending);
      if (failed) throw new Error("suno_submission_evidence_failed");
    },
    async close() {
      page.off("request", request);
      page.off("response", response);
      await Promise.all(pending);
      if (failed) throw new Error("suno_submission_evidence_failed");
    }
  };
}

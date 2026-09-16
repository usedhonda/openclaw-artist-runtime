import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { buildSunoV6Recommendation, hasSunoPreparationEvidence, observeSunoSubmission, readObservedSunoSubmission,
  sanitizeSunoSubmission, writeSunoPreparationEvidence } from "../src/services/sunoSubmissionEvidence";

const clipId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const urls = [`https://suno.com/song/${clipId}`];
const endpoint = "https://studio-api-prod.suno.com/api/generate/v2-web/";
const body = { title: "Producer edit", prompt: "[Hook]\nseventy-two hours", tags: "spoken verse; brass chorus", negative_tags: "crowd",
  mv: "chirp-hawk", token: "DO_NOT_PERSIST_TOKEN", persona_id: "DO_NOT_PERSIST_ID",
  metadata: { create_session_token: "DO_NOT_PERSIST_SESSION", is_max_mode: false,
    control_sliders: { weirdness_constraint: 0.51, style_weight: 1, audio_weight: 0, aug_creativity: 3 } } };

function fakePage() {
  const emitter = new EventEmitter();
  const frame = {};
  const page = Object.assign(emitter, { mainFrame: () => frame }) as unknown as Page;
  const send = (options: { url?: string; frame?: object; body?: unknown; status?: boolean } = {}) => {
    const request = { url: () => options.url ?? endpoint, method: () => "POST", frame: () => options.frame ?? frame,
      postDataJSON: () => options.body ?? body };
    emitter.emit("request", request);
    emitter.emit("response", { request: () => request, ok: () => options.status ?? true, json: async () => ({ clips: [{ id: clipId }], secret: "NEVER_COPY_RESPONSE" }) });
  };
  return { page, emitter, send };
}

describe("run-bound manual Suno submission evidence", () => {
  it("keeps Variety integer, maps other sliders, and omits unknown controls and secrets", () => {
    expect(sanitizeSunoSubmission(body)).toEqual({ title: body.title, lyrics: body.prompt, style: body.tags,
      excludeStyles: "crowd", model: "chirp-hawk", weirdness: 51, styleInfluence: 100, audioInfluence: 0, variety: 3, maxMode: false });
    expect(sanitizeSunoSubmission({ prompt: "TOKEN=not-a-real-secret-value", metadata: { control_sliders: { aug_creativity: 0.5 } } })).toEqual({});
    expect(sanitizeSunoSubmission({})).not.toHaveProperty("maxMode");
  });

  it("writes separate prepared and actual artifacts, bound to the exact run and returned clips", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "suno-evidence-"));
    const binding = { workspaceRoot, songId: "song-one", runId: "run-one" };
    await writeSunoPreparationEvidence(binding, { styleAndFeel: "sparse" }, { lyrics: "before edit", controls: { variety: 2, personalize: false } });
    const { page, send, emitter } = fakePage();
    const observer = observeSunoSubmission(page, binding);
    send();
    await observer.flush();
    expect(await hasSunoPreparationEvidence(workspaceRoot, "song-one", "run-one")).toBe(true);
    expect((await readObservedSunoSubmission(workspaceRoot, "song-one", "run-one", urls))?.lyrics).toBe(body.prompt);
    expect(await readObservedSunoSubmission(workspaceRoot, "song-one", "different-run", urls)).toBeUndefined();
    expect(await readObservedSunoSubmission(workspaceRoot, "song-one", "run-one", ["https://suno.com/song/other"])).toBeUndefined();
    const dir = join(workspaceRoot, "songs/song-one/suno-evidence/run-one");
    const files = await readdir(dir);
    expect(files).toHaveLength(3);
    const all = (await Promise.all(files.map((file) => readFile(join(dir, file), "utf8")))).join("\n");
    expect(all).not.toMatch(/DO_NOT_PERSIST|NEVER_COPY_RESPONSE/);
    expect(await readFile(join(dir, "prepared.json"), "utf8")).toContain("before edit");
    await observer.close();
    expect(emitter.listenerCount("request")).toBe(0);
    expect(emitter.listenerCount("response")).toBe(0);
  });

  it("ignores other pages, endpoints, and failed generations without UI mutation", async () => {
    const { page, send } = fakePage();
    const observer = observeSunoSubmission(page, undefined);
    send({ frame: {} });
    send({ url: "https://example.com/api/generate/v2-web/" });
    send({ status: false });
    await observer.flush();
    expect(observer.accepted()).toBeUndefined();
    await observer.close();
  });

  it("rejects path traversal and changes recommendation with song direction without applying it", async () => {
    expect(buildSunoV6Recommendation({ styleAndFeel: "dry close spoken verse" }).variety).toBe(1);
    expect(buildSunoV6Recommendation({ styleAndFeel: "experimental collage" }).variety).toBe(3);
    expect(buildSunoV6Recommendation({ styleAndFeel: "pop" }).policy).toBe("recommendation_only_not_applied");
    expect(buildSunoV6Recommendation({ styleAndFeel: "pop", variety: 2, maxMode: false, personalize: true,
      duration: "3:30", styleInfluence: 100 })).toMatchObject({
      variety: 2, personalize: true, maxMode: false, policy: "payload_defaults_applied"
    });
    await expect(writeSunoPreparationEvidence({ workspaceRoot: ".", songId: "../bad", runId: "run" }, {}, { controls: {} })).rejects.toThrow("invalid_binding");
  });
});

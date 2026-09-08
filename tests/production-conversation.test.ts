import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeRegisterTool, type ArtistToolContext } from "../src/pluginApi";
import { updateSongState } from "../src/services/artistState";
import { productionContextIdentity, productionPromptContext, readProductionConversation, recordProductionRunBinding, recordProductionSubmission, resolveProductionSubmission, updateProductionConversation, updateProductionRunConversation, type ProductionRunBinding } from "../src/services/productionConversation";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";
import { registerProductionTools } from "../src/tools/productionTools";
import { registerRevisionTools } from "../src/tools/revisionTools";
import { registerSunoTools } from "../src/tools/sunoTools";
import { registerSongTools } from "../src/tools/songTools";
import { assertProducer } from "../src/services/telegramAuth";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";

type Tool = { name: string; execute: (id: string, payload: unknown) => Promise<{ details: unknown }> };
function tools(register: (api: unknown) => void, context: ArtistToolContext): Map<string, Tool> {
  const result = new Map<string, Tool>();
  register({ registerTool(factory: (context: ArtistToolContext) => Tool) { const tool = factory(context); result.set(tool.name, tool); } });
  return result;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "production-conversation-"));
  for (const songId of ["song-a", "song-b"]) {
    await mkdir(join(root, "songs", songId), { recursive: true });
    await writeFile(join(root, "songs", songId, "song.md"), `# ${songId}\n`);
    await updateSongState(root, songId, { title: songId, status: "take_selected", selectedTakeId: "old-take" });
  }
  const context: ArtistToolContext = { workspaceDir: root, sessionKey: "agent:artist:telegram:direct:123", sessionId: "resettable-1", messageChannel: "telegram", requesterSenderId: "123", senderIsOwner: true, deliveryContext: { channel: "telegram", to: "123", accountId: "artist" } };
  return { root, context };
}

describe("producer conversation continuity", () => {
  beforeEach(() => vi.stubEnv("TELEGRAM_OWNER_USER_IDS", "123"));
  afterEach(() => vi.unstubAllEnvs());

  it("denies absent identity and empty allowlists while preserving explicit non-Telegram owners", () => {
    expect(() => assertProducer(undefined, "test")).toThrow("producer-only");
    expect(() => assertProducer({ messageChannel: "webchat", senderIsOwner: true }, "test")).not.toThrow();
    vi.stubEnv("TELEGRAM_OWNER_USER_IDS", "");
    expect(() => assertProducer({ messageChannel: "telegram", requesterSenderId: "123", senderIsOwner: true }, "test")).toThrow("producer-only");
  });

  it("authenticates all four producer actions using trusted identity, never payload claims", async () => {
    const { context } = await fixture();
    const cases = [
      [registerProductionTools, "artist_production_conversation", { songId: "song-a" }],
      [registerProductionTools, "artist_song_production_revise", {}],
      [registerSunoTools, "artist_suno_generate", {}],
      [registerSongTools, "artist_take_select", {}]
    ] as const;
    for (const [register, name, payload] of cases) {
      for (const denied of [
        { ...context, requesterSenderId: "456", senderIsOwner: true },
        { ...context, requesterSenderId: undefined },
        { ...context, requesterSenderId: "456", messageChannel: undefined },
        { ...context, messageChannel: "webchat" },
        { ...context, deliveryContext: { channel: "webchat" } },
        {},
        { messageChannel: "webchat", senderIsOwner: false }
      ]) {
        const tool = tools(register, denied).get(name)!;
        await expect(tool.execute("spoof", { ...payload, requesterSenderId: "123", senderIsOwner: true, messageChannel: "webchat", deliveryContext: { channel: "webchat" } })).rejects.toThrow("producer-only");
      }
      const tool = tools(register, { ...context, senderIsOwner: false }).get(name)!;
      const result = await tool.execute("producer", payload).catch((error: Error) => error);
      if (result instanceof Error) expect(result.message).not.toContain("producer-only");
      else expect(name).toBe("artist_production_conversation");
    }
  });
  it("passes trusted factory identity, never model-supplied identity or workspace", async () => {
    const { root, context } = await fixture();
    let captured: unknown;
    const registered = tools((api) => safeRegisterTool(api, { name: "probe", handler: (payload, trusted) => { captured = { payload, trusted }; return true; } }), context);
    await registered.get("probe")!.execute("trusted-call", { workspaceRoot: "wrong", sessionKey: "forged", deliveryContext: { to: "other" }, senderIsOwner: true });
    expect(captured).toMatchObject({ payload: { workspaceRoot: root }, trusted: { ...context, toolCallId: "trusted-call" } });
  });

  it("survives session reset and prevents late trials stealing a new subject", async () => {
    const { root, context } = await fixture();
    await updateProductionConversation(root, context, { songId: "song-a", instruction: "same lyrics, faster", preserve: ["lyrics", "old audio"], pendingDecision: "title language", runId: "run-a" });
    expect(await readProductionConversation(root, { ...context, sessionId: "resettable-2" })).toMatchObject({ songId: "song-a", preserve: ["lyrics", "old audio"] });
    expect(await productionPromptContext(root, context.sessionKey!)).toContain("same lyrics, faster");
    await updateProductionConversation(root, context, { songId: "song-b", instruction: "work on this instead" });
    const binding: ProductionRunBinding = { songId: "song-a", runId: "run-a", packVersion: 1, payloadHash: "hash", baselineStatus: "take_selected", contextKey: productionContextIdentity(context)!.key, createdAt: new Date().toISOString() };
    await updateProductionRunConversation(root, binding, "submitted");
    expect(await readProductionConversation(root, context)).toMatchObject({ songId: "song-b", instruction: "work on this instead", phase: "discussing" });
  });

  it("does not inject a memo into shared sessions or a second producer route", async () => {
    const { root, context } = await fixture();
    const shared = { ...context, sessionKey: "agent:artist:main" };
    await updateProductionConversation(root, shared, { songId: "song-a", instruction: "private direction" });
    expect(await productionPromptContext(root, shared.sessionKey)).toBeUndefined();
    expect(await readProductionConversation(root, { ...shared, requesterSenderId: "456", deliveryContext: { channel: "telegram", to: "456" } })).toBeUndefined();
  });

  it("resolves historical submission replies within the exact conversation", async () => {
    const { root, context } = await fixture();
    await updateProductionConversation(root, context, { songId: "song-b" });
    await recordProductionSubmission(root, { songId: "song-a", runId: "run-old", messageId: 321, urls: ["https://suno.com/song/old"], packVersion: 2, payloadHash: "exact-old", contextKey: productionContextIdentity(context)!.key, deliveredAt: new Date().toISOString() });
    expect(await resolveProductionSubmission(root, context, 321)).toMatchObject({ songId: "song-a", runId: "run-old" });
    expect(await resolveProductionSubmission(root, { ...context, requesterSenderId: "456" }, 321)).toBeUndefined();
    const registered = tools(registerRevisionTools, context);
    const response = await registered.get("artist_song_material_lookup")!.execute("reply", { replyMessageId: 321, includeMaterial: false });
    expect(response.details).toMatchObject({ songId: "song-a", replySubmission: { runId: "run-old" }, conversation: { runId: "run-old", packVersion: 2 } });
  });

  it("revises arrangement through the tool without inventing lyric edits or replacing adoption", async () => {
    const { root, context } = await fixture();
    context.senderIsOwner = false;
    const lyrics = "[Verse]\nkeep this line\n[Hook]\nkeep this hook";
    const base = await createAndPersistSunoPromptPack({ workspaceRoot: root, songId: "song-a", songTitle: "song-a", artistReason: "dry rap", lyricsText: lyrics, bpm: 92, preserveSongStatus: true });
    const registered = tools(registerProductionTools, context);
    const result = await registered.get("artist_song_production_revise")!.execute("revise", { songId: "song-a", basePackVersion: base.packVersion, expectedBasePayloadHash: base.pack.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: createHash("sha256").update(lyrics).digest("hex") }, producerInstruction: "same lyrics, faster", patch: { bpm: 148, direction: "urgent clipped drums" } });
    expect(result.details).toMatchObject({ effective: { bpm: 148 }, lyric: { kind: "adopted_lyrics", version: 1 }, baseline: { selectedTakeId: "old-take", status: "take_selected" } });
    expect(await readProductionConversation(root, context)).toMatchObject({ songId: "song-a", instruction: "same lyrics, faster", packVersion: 2, phase: "requested" });
    const revision = result.details as { revisionId: string; packVersion: number; payloadHash: string };
    const urls = ["https://suno.com/song/trial"];
    await recordProductionRunBinding(root, { songId: "song-a", runId: "run-trial", ...revision, baselineStatus: "take_selected", baselineTake: { takeId: "old-take", url: "https://suno.com/song/old-take" }, createdAt: new Date().toISOString() });
    await writeFile(join(root, "songs/song-a/suno/runs.jsonl"), JSON.stringify({ runId: "run-trial", songId: "song-a", status: "accepted", urls, payloadHash: revision.payloadHash, createdAt: new Date().toISOString() }) + "\n");
    const report = await formatRuntimeEvent({ type: "song_take_completed", songId: "song-a", urls, timestamp: Date.now() }, { workspaceRoot: root });
    expect(report).toContain("148 BPMを狙って");
    expect(report).toContain("アレンジの狙い: urgent clipped drums");
    expect(report).toContain("歌詞はそのまま");
    expect(report).toContain("聴いてほしい点:");
    expect(report).toContain("言葉の抜けと疾走感");
    expect(report).toContain("https://suno.com/song/old-take");
    expect(report.match(/same lyrics, faster/g)).toHaveLength(1);
    expect(report).not.toContain("歌詞 v");
  });
});

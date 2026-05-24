import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeArtistReflection } from "../src/services/artistReflectionComposer";
import type { CommissionBrief } from "../src/types";

function root(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-reflection-"));
}

async function writePersona(workspaceRoot: string): Promise<void> {
  await mkdir(join(workspaceRoot, "artist"), { recursive: true });
  await writeFile(join(workspaceRoot, "ARTIST.md"), "Core obsessions: 社会風刺\nPlaces: 六本木\n", "utf8");
  await writeFile(join(workspaceRoot, "IDENTITY.md"), "俺は街のざらつきを拾う。\n", "utf8");
  await writeFile(join(workspaceRoot, "INNER.md"), "迷いながら近くで話す。\n", "utf8");
  await writeFile(join(workspaceRoot, "PRODUCER.md"), "ゆずるさんに先に聴かせる。\n", "utf8");
  await writeFile(join(workspaceRoot, "artist", "CURRENT_STATE.md"), "Emotional weather: cold\n", "utf8");
  await writeFile(join(workspaceRoot, "SOUL.md"), [
    "# SOUL.md",
    "## 文体 variation rule",
    "### sentence_endings",
    "- だ。",
    "### forbidden_phrases",
    "- ARTIST.md",
    "## Producer (relationship in music-making)",
    "### Producer call",
    "- producer_callname: ゆずるさん",
    "- first_person: 俺"
  ].join("\n"), "utf8");
}

function brief(sources: CommissionBrief["sources"] = []): CommissionBrief {
  return {
    songId: "spawn_reflect",
    title: "コピー機の夜景",
    brief: "都市の明るさに疲れが映る。",
    lyricsTheme: "六本木のコピー機の光で、経営者の言葉を少しだけ刺す。",
    mood: "tense",
    tempo: "142 BPM",
    duration: "2:45",
    styleNotes: "thick bass, restrained hi-hats, sparse arrangement",
    sourceText: "test",
    createdAt: "2026-05-25T00:00:00.000Z",
    sources
  };
}

describe("artist reflection narrative", () => {
  it("weaves observation source, voice, title, lyrics, and style into one reflection", async () => {
    const workspaceRoot = root();
    await writePersona(workspaceRoot);
    const result = await composeArtistReflection({
      workspaceRoot,
      songId: "spawn_reflect",
      brief: brief([
        { kind: "news", url: "https://example.com/news", author: "City Desk", quote: "コピー機の灯りが深夜の街に残っている" },
        { kind: "x", url: "https://x.com/observer/status/12345", author: "observer", quote: "六本木の朝だけ妙に白い" }
      ]),
      reason: "六本木の社会風刺に繋がるから。",
      voiceTop: "ゆずるさん、コピー機の夜景を切るやつ、どう。",
      seed: "spawn_reflect"
    });

    expect(result.narrative).toContain("ゆずるさん");
    expect(result.narrative).toContain("コピー機の灯り");
    expect(result.narrative).toContain("https://x.com/observer/status/12345");
    expect(result.narrative).toContain("voice: ゆずるさん、コピー機の夜景を切るやつ、どう。");
    expect(result.narrative).toContain("title: コピー機の夜景");
    expect(result.narrative).toContain("lyrics: 六本木のコピー機の光");
    expect(result.narrative).toContain("style: thick bass");
    expect(result.cascadeTrace.observationSources).toHaveLength(2);
  });

  it("falls back to persona-only reflection when observation is empty", async () => {
    const workspaceRoot = root();
    await writePersona(workspaceRoot);
    const result = await composeArtistReflection({
      workspaceRoot,
      songId: "spawn_empty",
      brief: brief(),
      reason: "まだ観察は薄い。",
      seed: "spawn_empty"
    });

    expect(result.narrative).toContain("今日は外の観察が薄い");
    expect(result.narrative).toContain("六本木");
    expect(result.narrative).not.toContain("ARTIST.md");
    expect(result.narrative).not.toContain("TBD");
  });
});

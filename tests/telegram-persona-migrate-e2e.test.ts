import { readdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TelegramConfig } from "../src/types";
import { artistPersonaBlockStart } from "../src/services/personaFileBuilder";
import { soulPersonaBlockStart } from "../src/services/soulFileBuilder";
import { TelegramBotWorker } from "../src/services/telegramBotWorker";

const enabledConfig: TelegramConfig = {
  enabled: true,
  pollIntervalMs: 2000,
  notifyStages: true,
  acceptFreeText: true
};

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-persona-migrate-e2e-"));
}

async function writeImportedPersona(root: string): Promise<void> {
  await writeFile(
    join(root, "ARTIST.md"),
    [
      "# ARTIST.md",
      "",
      "## Public Identity",
      "",
      "Artist name: Migrating Obsidian Artist",
      "",
      "A notebook imported identity line that should be folded into markers.",
      "",
      "## Sound",
      "",
      "- Damaged pop, close vocal, static, and night buses.",
      "",
      "## Lyrics",
      "",
      "- Avoid cheap uplift and copied voices.",
      "",
      "## Voice",
      "",
      "- Preserve this custom voice section.",
      "",
      "## Listener",
      "",
      "- Preserve this custom listener section.",
      "",
      "### 人物像",
      "",
      "- Preserve this nested custom note."
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(root, "SOUL.md"), "# SOUL.md\n\n## Conversational Core\n\nKeep it spare and loyal.\n", "utf8");
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as Response;
}

function makeTelegramFetch(messages: string[]) {
  const sent: string[] = [];
  let index = 0;
  const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
    if (input.includes("/getUpdates")) {
      const text = messages[index];
      index += 1;
      return jsonResponse({
        ok: true,
        result: text
          ? [
              {
                update_id: index,
                message: {
                  message_id: index,
                  text,
                  chat: { id: 456 },
                  from: { id: 123 }
                }
              }
            ]
          : []
      });
    }
    const payload = JSON.parse(String(init.body)) as { text?: string };
    sent.push(payload.text ?? "");
    return jsonResponse({ ok: true, result: { message_id: sent.length, text: payload.text, chat: { id: 456 } } });
  });
  return { fetchImpl, sent };
}

describe("telegram persona migrate e2e", () => {
  it("does not fetch persona migrate updates while Telegram is disabled", async () => {
    const fetchImpl = vi.fn();
    const worker = new TelegramBotWorker({
      root: makeRoot(),
      config: { ...enabledConfig, enabled: false },
      token: "test-token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    const result = await worker.pollOnce();

    expect(result).toMatchObject({ enabled: false, fetched: false, reason: "disabled_config" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("previews migration without writing marker blocks before confirmation", async () => {
    const root = makeRoot();
    await writeImportedPersona(root);
    const before = await readFile(join(root, "ARTIST.md"), "utf8");
    const { fetchImpl, sent } = makeTelegramFetch(["/persona migrate"]);
    const worker = new TelegramBotWorker({
      root,
      config: enabledConfig,
      token: "test-token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    await worker.pollOnce();
    worker.stop();

    expect(sent[0]).toContain("Persona migrate plan:");
    expect(sent[0]).toContain("/confirm migrate");
    await expect(readFile(join(root, "ARTIST.md"), "utf8")).resolves.toBe(before);
    const files = await readdir(root);
    expect(files.some((file) => file.startsWith("ARTIST.md.backup-"))).toBe(false);
  });

  it("previews, confirms migration, writes backups, preserves custom sections, and reports already migrated", async () => {
    const root = makeRoot();
    await writeImportedPersona(root);
    const { fetchImpl, sent } = makeTelegramFetch(["/persona migrate", "/confirm migrate", "/persona migrate"]);
    const worker = new TelegramBotWorker({
      root,
      config: enabledConfig,
      token: "test-token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    await worker.pollOnce();
    await worker.pollOnce();
    await worker.pollOnce();
    worker.stop();

    expect(sent[0]).toContain("Persona migrate plan:");
    expect(sent[0]).toContain("/confirm migrate");
    expect(sent[1]).toContain("Persona migrated");
    expect(sent[2]).toContain("already migrated");
    const artist = await readFile(join(root, "ARTIST.md"), "utf8");
    const soul = await readFile(join(root, "SOUL.md"), "utf8");
    expect(artist).toContain(artistPersonaBlockStart);
    expect(soul).toContain(soulPersonaBlockStart);
    expect(artist).toContain("## Voice");
    expect(artist).toContain("## Listener");
    expect(artist).toContain("### 人物像");
    const files = await readdir(root);
    expect(files.some((file) => file.startsWith("ARTIST.md.backup-"))).toBe(true);
    expect(files.some((file) => file.startsWith("SOUL.md.backup-"))).toBe(true);
  });
});

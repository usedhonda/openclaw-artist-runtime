import { readFile, stat, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artistPersonaBlockStart } from "../src/services/personaFileBuilder";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";
import { handleTelegramPersonaSessionMessage } from "../src/services/telegramPersonaSession";

const input = { fromUserId: 123, chatId: 456 };

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-persona-migrate-command-"));
}

async function writePersona(root: string): Promise<void> {
  await writeFile(
    join(root, "ARTIST.md"),
    ["# ARTIST.md", "", "## Public Identity", "", "Artist name: Command Artist", "", "A command migration fixture.", "", "## Voice", "", "Keep me."].join("\n"),
    "utf8"
  );
  await writeFile(join(root, "SOUL.md"), "# SOUL.md\n\n## Conversational Core\n\nKeep it short.\n", "utf8");
}

describe("telegram persona migrate command", () => {
  it("previews a migrate plan and does not write before confirmation", async () => {
    const root = makeRoot();
    await writePersona(root);
    const before = await readFile(join(root, "ARTIST.md"), "utf8");

    const result = await routeTelegramCommand({ ...input, text: "/persona migrate", workspaceRoot: root });

    expect(result.responseText).toContain("Persona migrate plan:");
    expect(result.responseText).toContain("/confirm migrate");
    await expect(readFile(join(root, "ARTIST.md"), "utf8")).resolves.toBe(before);
    expect(result.responseText).toContain("ARTIST backup:");
  });

  it("executes migration only after /confirm migrate", async () => {
    const root = makeRoot();
    await writePersona(root);
    const planPreview = await routeTelegramCommand({ ...input, text: "/persona migrate", workspaceRoot: root });
    const backupMatch = planPreview.responseText.match(/ARTIST backup: (.+)/);
    expect(backupMatch).toBeTruthy();

    await expect(handleTelegramPersonaSessionMessage(root, "/confirm migrate")).resolves.toContain("Persona migrated");
    const artist = await readFile(join(root, "ARTIST.md"), "utf8");

    expect(artist).toContain(artistPersonaBlockStart);
    expect(artist).toContain("## Voice");
    await expect(stat(backupMatch?.[1] ?? "")).resolves.toBeTruthy();
  });

  it("cancels migration without writing files", async () => {
    const root = makeRoot();
    await writePersona(root);
    const before = await readFile(join(root, "ARTIST.md"), "utf8");

    await routeTelegramCommand({ ...input, text: "/persona migrate", workspaceRoot: root });
    await expect(handleTelegramPersonaSessionMessage(root, "/cancel")).resolves.toContain("cancelled");

    await expect(readFile(join(root, "ARTIST.md"), "utf8")).resolves.toBe(before);
  });
});

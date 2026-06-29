import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import registerArtistRuntime from "../src/index";

interface CapturedCommand {
  name: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  handler: (ctx: Record<string, unknown>) => Promise<{ text: string }> | { text: string };
}

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-openclaw-telegram-wire-"));
}

async function writeSparsePersona(root: string): Promise<void> {
  await writeFile(
    join(root, "ARTIST.md"),
    [
      "# ARTIST.md",
      "",
      "## Public Identity",
      "",
      "Artist name: Wired Artist",
      "",
      "A detailed identity line for native Telegram command wiring.",
      "",
      "## Sound",
      "",
      "- Cold folk tape hiss and close vocal detail.",
      "",
      "## Lyrics",
      "",
      "- Avoid fake uplift and copied voices.",
      "",
      "## Voice",
      "",
      "- Keep this custom section."
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(root, "SOUL.md"), "# SOUL.md\n\nCustom direct voice rules without standard marker.\n", "utf8");
}

function captureCommands(root: string): Map<string, CapturedCommand> {
  const commands = new Map<string, CapturedCommand>();
  registerArtistRuntime.register({
    pluginConfig: { artist: { workspaceRoot: root } },
    registerCommand(command: CapturedCommand) {
      commands.set(command.name, command);
    }
  });
  return commands;
}

function commandContext(args: string, root: string): Record<string, unknown> {
  return {
    args,
    senderId: "123",
    from: "telegram:456",
    to: "telegram:456",
    config: { plugins: { entries: { "artist-runtime": { config: { artist: { workspaceRoot: root } } } } } }
  };
}

describe("OpenClaw Telegram persona command wire", () => {
  it("registers persona commands through OpenClaw native command API", () => {
    const commands = captureCommands(makeRoot());

    expect(commands.get("persona")?.acceptsArgs).toBe(true);
    expect(commands.get("persona")?.requireAuth).toBe(true);
    expect(commands.get("setup")?.acceptsArgs).toBe(true);
    expect(commands.get("yes")?.acceptsArgs).toBe(true);
    expect(commands.get("suno")?.acceptsArgs).toBe(true);
    expect(commands.get("lyrics")?.acceptsArgs).toBe(true);
    expect(commands.get("plan")?.acceptsArgs).toBe(true);
    expect(commands.get("take")?.acceptsArgs).toBe(true);
    expect(commands.get("draft")?.acceptsArgs).toBe(true);
    expect(commands.get("dist")?.acceptsArgs).toBe(true);
    expect(commands.get("pulse")?.acceptsArgs).toBe(true);
  });

  it("routes /persona check through the production plugin command handler", async () => {
    const root = makeRoot();
    await writeSparsePersona(root);
    const command = captureCommands(root).get("persona");

    const result = await command?.handler(commandContext("check", root));

    expect(result?.text).toContain("socialVoice: missing");
    expect(result?.text).toContain("Custom sections: Voice");
  });

  it("routes setup into the conversational artist without starting a second poller", async () => {
    const root = makeRoot();
    const commands = captureCommands(root);

    const setup = await commands.get("setup")?.handler(commandContext("", root));

    expect(setup?.text).not.toContain("I heard this:");
    expect(setup?.text.length).toBeGreaterThan(0);
  });

  it("routes /confirm migrate through native command session control", async () => {
    const root = makeRoot();
    await writeSparsePersona(root);
    const commands = captureCommands(root);

    await commands.get("persona")?.handler(commandContext("migrate", root));
    const result = await commands.get("confirm")?.handler(commandContext("migrate", root));
    const artist = await readFile(join(root, "ARTIST.md"), "utf8");

    expect(result?.text).toContain("Persona migrated");
    expect(artist).toContain("artist-runtime:persona:core:start");
  });
});

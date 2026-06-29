import { describe, expect, it, vi } from "vitest";
import registerArtistRuntime from "../src/index";
import { safeRegisterCommand, type CommandRegistration } from "../src/pluginApi";

const noopCommand: CommandRegistration = {
  name: "noop",
  description: "No-op command for diagnostics.",
  acceptsArgs: true,
  requireAuth: true,
  handler: () => ({ text: "ok" })
};

describe("artist-runtime command registration diagnostics", () => {
  it("reports safeRegisterCommand success and unavailable API cases", () => {
    const seen: Array<[boolean, string]> = [];
    const registered: string[] = [];

    safeRegisterCommand(
      { registerCommand: (command: CommandRegistration) => registered.push(command.name) },
      noopCommand,
      (ok, name) => seen.push([ok, name])
    );
    safeRegisterCommand({}, noopCommand, (ok, name) => seen.push([ok, name]));

    expect(registered).toEqual(["noop"]);
    expect(seen).toEqual([[true, "noop"], [false, "noop"]]);
  });

  it("logs persona command registration and telegram command spec snapshots", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const commands: string[] = [];

    registerArtistRuntime.register({
      registerCommand(command: CommandRegistration) {
        commands.push(command.name);
      },
      getPluginCommandSpecs(provider?: string) {
        expect(provider).toBe("telegram");
        return commands.map((name) => ({ name }));
      }
    });

    expect(commands).toEqual([
      "persona",
      "song",
      "commission",
      "setup",
      "observations",
      "resume",
      "confirm",
      "cancel",
      "suno",
      "lyrics",
      "plan",
      "take",
      "draft",
      "dist",
      "pulse",
      "yes",
      "no",
      "edit",
      "one",
      "talk"
    ]);
    expect(info).toHaveBeenCalledWith("[artist-runtime] registered runtime-slash command: persona");
    expect(info).toHaveBeenCalledWith("[artist-runtime] registered runtime-slash command: song");
    expect(info).toHaveBeenCalledWith("[artist-runtime] registered runtime-slash command: talk");
    expect(info).toHaveBeenCalledWith("[artist-runtime] registered runtime-slash command: observations");
    expect(info).toHaveBeenCalledWith("[artist-runtime] registered runtime-slash command: resume");
    expect(info).toHaveBeenCalledWith("[artist-runtime] registered runtime-slash command: suno");
    expect(info).toHaveBeenCalledWith("[artist-runtime] registered runtime-slash command: draft");
    expect(info).toHaveBeenCalledWith(
      "[artist-runtime] telegram plugin command specs: persona,song,commission,setup,observations,resume,confirm,cancel,suno,lyrics,plan,take,draft,dist,pulse,yes,no,edit,one,talk (count=20, persona=true)"
    );
    expect(warn).not.toHaveBeenCalled();

    info.mockRestore();
    warn.mockRestore();
  });

  it("logs unavailable registerCommand without throwing", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => registerArtistRuntime.register({})).not.toThrow();

    expect(warn).toHaveBeenCalledWith("[artist-runtime] registerCommand unavailable for: persona");
    expect(warn).toHaveBeenCalledWith("[artist-runtime] registerCommand unavailable for: talk");
    expect(info).not.toHaveBeenCalled();

    info.mockRestore();
    warn.mockRestore();
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hydrateSunoBrowserSession,
  parseSunoSessionCookieHeader
} from "../src/services/cdpHumanAssistDriver";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Suno CLI session hydration", () => {
  it("parses cookie values without truncating embedded equals signs", () => {
    expect(parseSunoSessionCookieHeader("__session=header.payload==; theme=dark")).toEqual([
      { name: "__session", value: "header.payload==", url: "https://suno.com" },
      { name: "theme", value: "dark", url: "https://suno.com" }
    ]);
  });

  it("hydrates the browser only when the saved CLI session contains __session", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-suno-session-"));
    tempRoots.push(root);
    const sessionFile = join(root, "session.json");
    await writeFile(sessionFile, JSON.stringify({ cookie: "__session=test-session; theme=dark" }), "utf8");
    const addCookies = vi.fn(async () => undefined);

    await expect(hydrateSunoBrowserSession({ addCookies }, sessionFile)).resolves.toBe(true);
    expect(addCookies).toHaveBeenCalledWith([
      { name: "__session", value: "test-session", url: "https://suno.com" },
      { name: "theme", value: "dark", url: "https://suno.com" }
    ]);
  });

  it("does not mutate browser cookies for an unrelated saved cookie", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-suno-session-"));
    tempRoots.push(root);
    const sessionFile = join(root, "session.json");
    await writeFile(sessionFile, JSON.stringify({ cookie: "theme=dark" }), "utf8");
    const addCookies = vi.fn(async () => undefined);

    await expect(hydrateSunoBrowserSession({ addCookies }, sessionFile)).resolves.toBe(false);
    expect(addCookies).not.toHaveBeenCalled();
  });
});

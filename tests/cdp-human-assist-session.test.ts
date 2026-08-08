import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hydrateSunoBrowserSession,
  parseSunoSessionCookieHeader
} from "../src/services/cdpHumanAssistDriver";

const tempRoots: string[] = [];

function cookieHeader(entries: Array<[string, string]>): string {
  return entries.map(([name, value]) => `${name}=${value}`).join("; ");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Suno CLI session hydration", () => {
  it("preserves duplicate Clerk sessions on their original host scopes", () => {
    expect(parseSunoSessionCookieHeader("__session=parent==; __client_uat=uat; __session=host; __client=auth; theme=dark")).toEqual([
      { name: "__session", value: "parent==", domain: ".suno.com", path: "/", secure: true },
      { name: "__client_uat", value: "uat", domain: ".suno.com", path: "/", secure: true },
      { name: "__session", value: "host", url: "https://suno.com" },
      { name: "__client", value: "auth", url: "https://auth.suno.com" }
    ]);
  });

  it("hydrates the browser only when the saved CLI session contains __session", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-suno-session-"));
    tempRoots.push(root);
    const sessionFile = join(root, "session.json");
    await writeFile(sessionFile, JSON.stringify({ cookie: cookieHeader([
      ["__session", "domain-session"],
      ["__session", "host-session"],
      ["theme", "dark"]
    ]) }), "utf8");
    const addCookies = vi.fn(async () => undefined);

    await expect(hydrateSunoBrowserSession({ addCookies }, sessionFile)).resolves.toBe(true);
    expect(addCookies).toHaveBeenCalledWith([
      { name: "__session", value: "domain-session", domain: ".suno.com", path: "/", secure: true },
      { name: "__session", value: "host-session", url: "https://suno.com" }
    ]);
  });

  it("does not mutate browser cookies for an unrelated saved cookie", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-suno-session-"));
    tempRoots.push(root);
    const sessionFile = join(root, "session.json");
    await writeFile(sessionFile, JSON.stringify({ cookie: cookieHeader([["theme", "dark"]]) }), "utf8");
    const addCookies = vi.fn(async () => undefined);

    await expect(hydrateSunoBrowserSession({ addCookies }, sessionFile)).resolves.toBe(false);
    expect(addCookies).not.toHaveBeenCalled();
  });
});

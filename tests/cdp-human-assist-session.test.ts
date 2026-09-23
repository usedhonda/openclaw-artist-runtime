import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hydrateSunoBrowserSession,
  parseSunoSessionCookieHeader
} from "../src/services/cdpHumanAssistDriver";
import { checkSunoCliSessionStatus, readSunoCliSessionStatus } from "../src/services/sunoCliSessionStatus";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import type { SunoFeedFetchResult } from "../src/services/sunoFeedHarvest";

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

describe("checkSunoCliSessionStatus / readSunoCliSessionStatus", () => {
  afterEach(() => {
    getRuntimeEventBus().clearForTest();
  });

  function fetchStatus(result: SunoFeedFetchResult) {
    return vi.fn(async () => result);
  }

  it("persists an invalid result and emits suno_cli_session_expired once", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-cli-session-status-"));
    tempRoots.push(root);
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const now = Date.parse("2026-09-06T00:00:00.000Z");

    const status = await checkSunoCliSessionStatus(root, join(root, "runtime", "suno", "cli", "session.json"), {
      fetchStatus: fetchStatus({ clips: [], available: false, reason: "clerk_token_error" }),
      now: () => now
    });
    unsubscribe();

    expect(status).toEqual({ valid: false, checkedAt: new Date(now).toISOString(), reason: "clerk_token_error" });
    expect(await readSunoCliSessionStatus(root)).toEqual(status);
    const notices = events.filter((event) => event.type === "suno_cli_session_expired");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ type: "suno_cli_session_expired", reason: "clerk_token_error" });
  });

  it("does not re-notify within an hour of the last notice, then notifies again after an hour", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-cli-session-status-"));
    tempRoots.push(root);
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    let now = Date.parse("2026-09-06T00:00:00.000Z");
    const deps = { fetchStatus: fetchStatus({ clips: [], available: false, reason: "http_error" }), now: () => now };
    const sessionFile = join(root, "runtime", "suno", "cli", "session.json");

    await checkSunoCliSessionStatus(root, sessionFile, deps);
    now += 30 * 60 * 1000; // 30 min later: still within the hourly window
    await checkSunoCliSessionStatus(root, sessionFile, deps);
    now += 31 * 60 * 1000; // now 61 min after the first notice
    await checkSunoCliSessionStatus(root, sessionFile, deps);
    unsubscribe();

    const notices = events.filter((event) => event.type === "suno_cli_session_expired");
    expect(notices).toHaveLength(2);
  });

  it("clears the tombstone and persists valid:true once the session recovers", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-cli-session-status-"));
    tempRoots.push(root);
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const now = Date.parse("2026-09-06T00:00:00.000Z");
    const sessionFile = join(root, "runtime", "suno", "cli", "session.json");

    await checkSunoCliSessionStatus(root, sessionFile, {
      fetchStatus: fetchStatus({ clips: [], available: false, reason: "network_error" }),
      now: () => now
    });
    const recovered = await checkSunoCliSessionStatus(root, sessionFile, {
      fetchStatus: fetchStatus({ clips: [{ id: "a" }], available: true }),
      now: () => now
    });
    // A later invalid check after recovery notifies again immediately (tombstone cleared).
    await checkSunoCliSessionStatus(root, sessionFile, {
      fetchStatus: fetchStatus({ clips: [], available: false, reason: "network_error" }),
      now: () => now
    });
    unsubscribe();

    expect(recovered).toEqual({ valid: true, checkedAt: new Date(now).toISOString(), reason: undefined });
    expect(await readSunoCliSessionStatus(root)).toMatchObject({ valid: false });
    expect(events.filter((event) => event.type === "suno_cli_session_expired")).toHaveLength(2);
  });

  it("returns undefined from readSunoCliSessionStatus when no precheck has ever run", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-cli-session-status-"));
    tempRoots.push(root);
    expect(await readSunoCliSessionStatus(root)).toBeUndefined();
  });
});

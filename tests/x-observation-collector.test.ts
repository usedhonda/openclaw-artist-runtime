import { mkdtempSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn()
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, execFile: execFileMock };
});
import { collectObservations, decomposeToQueryTokens, readTodayObservations } from "../src/services/xObservationCollector";
import { writeSongBrief } from "../src/services/artistState";
import { readXObservationDiagnostics } from "../src/services/xObservationDiagnostics";
import { isInCooldown, readBirdRateLimitStatus } from "../src/services/birdRateLimiter";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-x-observation-collector-"));
}

describe("x observation collector", () => {
  afterEach(() => {
    execFileMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("passes the configured Firefox profile to the default Bird search runner", async () => {
    const root = workspace();
    vi.stubEnv("OPENCLAW_X_FIREFOX_PROFILE", "artist-x");
    execFileMock.mockImplementationOnce((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
      queueMicrotask(() => callback(null, JSON.stringify([{
        id: "1111111111111111111",
        text: "fresh city observation",
        createdAt: "2026-04-29T00:30:00.000Z",
        author: { username: "watcher" }
      }]), ""));
    });

    const result = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      query: "city culture"
    });

    expect(result.status).toBe("collected");
    expect(execFileMock).toHaveBeenCalledOnce();
    expect(execFileMock.mock.calls[0]?.[0]).toBe("bird");
    expect(execFileMock.mock.calls[0]?.[1]).toEqual([
      "--firefox-profile",
      "artist-x",
      "search",
      "city culture",
      "--json"
    ]);
  });

  it("uses bird runner once and then reads the daily cache", async () => {
    const root = workspace();
    const runner = vi.fn(async () => ({
      stdout: [
        "@watch_a society satire is spiking https://x.com/watch_a/status/1111111111111111111 2026-04-29T00:30:00.000Z",
        "@watch_b unrelated market noise https://x.com/watch_b/status/2222222222222222222 2026-04-29T00:45:00.000Z"
      ].join("\n")
    }));

    const first = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      personaText: "society satire",
      runner
    });
    const second = await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      personaText: "society satire",
      runner
    });

    expect(first.status).toBe("collected");
    expect(second.status).toBe("cached");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(await readTodayObservations(root, new Date("2026-04-29T03:00:00.000Z"))).toContain("society satire");
  });

  it("refreshes the daily cache after six hours", async () => {
    const root = workspace();
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "@firstwatcher first city observation https://x.com/firstwatcher/status/1111111111111111111 2026-04-29T01:00:00.000Z" })
      .mockResolvedValueOnce({ stdout: "@secondwatcher second city observation https://x.com/secondwatcher/status/2222222222222222222 2026-04-29T08:00:00.000Z" });
    const first = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      runner
    });
    await utimes(first.path, new Date("2026-04-29T01:00:00.000Z"), new Date("2026-04-29T01:00:00.000Z"));

    const second = await collectObservations(root, {
      now: new Date("2026-04-29T08:00:00.000Z"),
      runner
    });

    expect(second.status).toBe("collected");
    expect(runner).toHaveBeenCalledTimes(2);
    expect(await readTodayObservations(root, new Date("2026-04-29T08:00:00.000Z"))).toContain("second city observation");
  });

  it("refreshes a fresh cache when the requested news reaction query changes", async () => {
    const root = workspace();
    await mkdir(join(root, "observations"), { recursive: true });
    const path = join(root, "observations", "2026-04-29.md");
    await writeFile(path, [
      "# X Observations 2026-04-29",
      "",
      "Query: music OR society OR culture",
      "",
      "- text: \"generic culture chatter\"",
      "  author: \"watcher\"",
      "  url: \"https://x.com/watcher/status/1111111111111111111\"",
      "  postedAt: \"2026-04-29T01:00:00.000Z\"",
      ""
    ].join("\n"), "utf8");
    await utimes(path, new Date("2026-04-29T01:00:00.000Z"), new Date("2026-04-29T01:00:00.000Z"));
    const runner = vi.fn(async () => ({
      stdout: "@citywatch 渋谷の昆虫展に反応が集まる https://x.com/citywatch/status/2222222222222222222 2026-04-29T01:30:00.000Z"
    }));

    const result = await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      query: "夜の昆虫観察 OR 渋谷 OR 昆虫展",
      reactionSeed: {
        title: "夜の昆虫観察、渋谷で開催",
        source: "BCN+R"
      },
      runner
    });

    expect(result.status).toBe("collected");
    expect(runner).toHaveBeenCalledOnce();
    const cache = await readTodayObservations(root, new Date("2026-04-29T02:00:00.000Z"));
    expect(cache).toContain("Query: 夜の昆虫観察 OR 渋谷 OR 昆虫展");
    expect(cache).toContain("ReactionFor: \"夜の昆虫観察、渋谷で開催\"");
    expect(cache).toContain("渋谷の昆虫展");
    expect(cache).not.toContain("generic culture chatter");
  });

  it("tries the next reaction query when the first query has no acceptable entries", async () => {
    const root = workspace();
    const runner = vi.fn(async (query?: string) => ({
      stdout: query === "\"LUUP 事故\""
        ? ""
        : "@citywatch 便利の顔で危険を薄める街 https://x.com/citywatch/status/2222222222222222222 2026-04-29T01:30:00.000Z"
    }));

    const result = await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      queries: ["\"LUUP 事故\"", "\"LUUP 事故\" lang:ja since:2026-04-22"],
      reactionSeed: {
        title: "LUUP 事故、渋谷で発生",
        source: "Example"
      },
      runner
    });

    expect(result.status).toBe("collected");
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls.map(([query]) => query)).toEqual(["\"LUUP 事故\"", "\"LUUP 事故\" lang:ja since:2026-04-22"]);
    const cache = await readTodayObservations(root, new Date("2026-04-29T02:00:00.000Z"));
    expect(cache).toContain("Query: \"LUUP 事故\" lang:ja since:2026-04-22");
    expect(cache).toContain("便利の顔で危険を薄める街");
  });

  it("keeps a news reaction first and reserves the same query budget for an alternate lens", async () => {
    const root = workspace();
    await writeSongBrief(root, "spawn_recent", "## Direction\n- Lyrics theme: 整形広告で埋まる駅を切る。\n");
    const runner = vi.fn(async (query?: string) => ({
      stdout: query === '"news reaction"'
        ? ""
        : "@citywatch 街の熱が商品になる https://x.com/citywatch/status/2222222222222222222 2026-04-29T01:30:00.000Z"
    }));

    await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      queries: ['"news reaction"', '"later reaction"', '"unused reaction"'],
      personaText: [
        "### Consumption & Face Material Bank",
        "- 整形広告で埋まる駅: 顔がカタログになる。",
        "### Net & Generation Material Bank",
        "- 炎上の賞味期限: 熱が在庫になる。",
        "### Shibuya Diss Material Bank",
        "- 再開発ビルが作るビル風: 路地の空気が消える。"
      ].join("\n"),
      runner
    });

    const queries = runner.mock.calls.map(([query]) => query);
    // The news reaction stays first and the attempt budget is unchanged; any
    // lens query that survives decomposition is appended after it.
    expect(queries[0]).toBe('"news reaction"');
    expect(queries.length).toBeLessThanOrEqual(3);
    // The alternate lens is decomposed into AND tokens with lang:ja, never an
    // exact-phrase (double-quoted) search that matches no tweet.
    for (const query of queries.filter((entry) => entry.includes("lang:ja"))) {
      // A lens query is space-joined common-word tokens, never an exact phrase.
      expect(query).not.toContain('"');
      expect(query).not.toContain("整形広告で埋まる駅");
    }
  });

  it("persists latest search diagnostics without rejected tweet content", async () => {
    const root = workspace();
    const result = await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      queries: ["\"narrow\"", "\"broad\""],
      runner: async (query?: string) => ({
        stdout: query === "\"narrow\""
          ? "private rejected body https://t.co/secret"
          : ""
      })
    });

    expect(result.status).toBe("collected");
    const diagnostics = await readXObservationDiagnostics(root);
    expect(diagnostics).toMatchObject({
      date: "2026-04-29",
      emptyCache: {
        active: true,
        ttlMinutes: 20,
        until: "2026-04-29T02:20:00.000Z"
      }
    });
    expect(diagnostics?.attempts.length).toBeGreaterThanOrEqual(2);
    expect(diagnostics?.attempts[0]).toMatchObject({
      query: "\"narrow\"",
      rawCount: 1,
      acceptedCount: 0,
      rejectedCountsByReason: { short_url_only: 1 },
      firstRejectionSample: {
        reason: "short_url_only",
        hasAuthor: false,
        urlKind: "short",
        hasPostedAt: false
      }
    });
    const payload = JSON.stringify(diagnostics);
    expect(payload).not.toContain("private rejected body");
    expect(payload).not.toContain("https://t.co/secret");
  });

  it("does not exceed the remaining bird call budget while broadening", async () => {
    const root = workspace();
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "config-overrides.json"), JSON.stringify({ bird: { rateLimits: { dailyMax: 1, minIntervalMinutes: 60 } } }), "utf8");
    const runner = vi.fn(async () => ({ stdout: "" }));

    const result = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      queries: ["\"too narrow\"", "\"broader\""],
      runner
    });

    expect(result.status).toBe("collected");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("uses a short TTL for empty observation caches", async () => {
    const root = workspace();
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "config-overrides.json"), JSON.stringify({ bird: { rateLimits: { dailyMax: 5, minIntervalMinutes: 1 } } }), "utf8");
    const runner = vi.fn(async () => ({ stdout: "" }));
    const firstNow = new Date("2026-04-29T01:00:00.000Z");
    const first = await collectObservations(root, {
      now: firstNow,
      query: "\"empty topic\"",
      runner
    });
    await utimes(first.path, firstNow, firstNow);

    const cached = await collectObservations(root, {
      now: new Date("2026-04-29T01:10:00.000Z"),
      query: "\"empty topic\"",
      runner
    });
    const refreshed = await collectObservations(root, {
      now: new Date("2026-04-29T01:25:00.000Z"),
      query: "\"empty topic\"",
      runner
    });

    expect(cached.status).toBe("cached");
    expect(refreshed.status).toBe("collected");
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("emits query attempt diagnostics without rejected tweet body or URL", async () => {
    const root = workspace();
    const bus = getRuntimeEventBus();
    bus.clearForTest();
    const events: RuntimeEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));
    try {
      await collectObservations(root, {
        now: new Date("2026-04-29T02:00:00.000Z"),
        queries: ["\"narrow\"", "\"broad\""],
        runner: async (query?: string) => ({
          stdout: query === "\"narrow\""
            ? "private rejected body https://t.co/secret"
            : "@citywatch accepted note https://x.com/citywatch/status/2222222222222222222 2026-04-29T01:30:00.000Z"
        })
      });
    } finally {
      unsubscribe();
    }

    const event = events.find((entry): entry is Extract<RuntimeEvent, { type: "observation_collected" }> => entry.type === "observation_collected");
    expect(event).toBeDefined();
    expect(event?.rawCount).toBe(2);
    expect(event?.acceptedCount).toBe(1);
    expect(event?.rejectedCountsByReason).toMatchObject({ short_url_only: 1 });
    expect(event?.firstRejectionSample).toEqual({
      reason: "short_url_only",
      hasAuthor: false,
      urlKind: "short",
      hasPostedAt: false
    });
    expect(event?.queryAttempts).toHaveLength(2);
    const payload = JSON.stringify(event);
    expect(payload).not.toContain("private rejected body");
    expect(payload).not.toContain("https://t.co/secret");
  });

  it("blocks secret-like observation output", async () => {
    const root = workspace();
    const result = await collectObservations(root, {
      runner: async () => ({ stdout: "API_KEY=do-not-store" })
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("secret");
  });

  it("triggers cooldown for bird rate-limit output on stderr", async () => {
    const root = workspace();
    const result = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      runner: async () => ({ stdout: "", stderr: "HTTP 429 rate limit" })
    });

    expect(result.status).toBe("cooldown");
    expect(result.reason).toBe("ban_indication: 429 (source: stderr)");
    expect(await isInCooldown(root, new Date("2026-04-29T02:00:00.000Z"))).toBe(true);
  });

  it("does not cool down on ordinary tweets containing 制限/凍結 when entries parse", async () => {
    const root = workspace();
    const result = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      personaText: "都市 交通",
      runner: async () => ({
        stdout: [
          "@watch_a 首都高の速度制限が解除された https://x.com/watch_a/status/1111111111111111111 2026-04-29T00:30:00.000Z",
          "@watch_b 路面凍結に注意して https://x.com/watch_b/status/2222222222222222222 2026-04-29T00:45:00.000Z"
        ].join("\n")
      })
    });

    expect(result.status).toBe("collected");
    expect(await isInCooldown(root, new Date("2026-04-29T02:00:00.000Z"))).toBe(false);
  });

  it("keeps tweet bodies out of the cooldown reason and writes cooldown diagnostics", async () => {
    const root = workspace();
    const tweetBody = "首都高の速度制限が解除された";
    const result = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      personaText: "都市 交通",
      runner: async () => ({
        stdout: `@watch_a ${tweetBody} https://x.com/watch_a/status/1111111111111111111 2026-04-29T00:30:00.000Z`,
        stderr: "bird: HTTP 429 rate limit exceeded"
      })
    });

    expect(result.status).toBe("cooldown");
    expect(result.reason).toBe("ban_indication: 429 (source: stderr)");
    const status = await readBirdRateLimitStatus(root, new Date("2026-04-29T01:05:00.000Z"));
    expect(status.cooldownReason).toBe("ban_indication: 429 (source: stderr)");
    expect(status.cooldownReason).not.toContain(tweetBody);

    const diagnostics = await readXObservationDiagnostics(root);
    expect(diagnostics?.outcome).toBe("cooldown");
    expect(diagnostics?.reason).toBe("ban_indication: 429 (source: stderr)");
    expect(JSON.stringify(diagnostics)).not.toContain(tweetBody);
  });

  it("writes error-outcome diagnostics when collection throws", async () => {
    const root = workspace();
    const result = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      runner: async () => ({ stdout: "API_KEY=do-not-store" })
    });

    expect(result.status).toBe("skipped");
    const diagnostics = await readXObservationDiagnostics(root);
    expect(diagnostics?.outcome).toBe("error");
    expect(diagnostics?.reason).toContain("secret");
  });

  it("parses bird v0.8 chunk-by-record output with 50-char separator lines", async () => {
    const root = workspace();
    const separator = "──────────────────────────────────────────────────";
    const chunkOutput = [
      "@watch_a (Watch Alpha):",
      "society satire is spiking in 六本木 tonight",
      "https://t.co/short",
      "date: Sat May 23 01:17:15 +0000 2026",
      "url: https://x.com/watch_a/status/2057994231491568042",
      separator,
      "@watch_b (Watch Beta):",
      "都市 再開発 white facade",
      "PHOTO: https://pbs.twimg.com/media/example.jpg",
      "date: Sat May 23 00:57:13 +0000 2026",
      "url: https://x.com/watch_b/status/2057989190898573621",
      separator,
      "@watch_c (Watch Gamma):",
      "経営者 が ロビイング してる話",
      "date: Sat May 23 00:33:43 +0000 2026",
      "url: https://x.com/watch_c/status/2057983275981996161",
      ""
    ].join("\n");
    const runner = vi.fn(async () => ({ stdout: chunkOutput }));

    const result = await collectObservations(root, {
      now: new Date("2026-05-23T01:30:00.000Z"),
      personaText: "society satire 経営者 再開発",
      runner
    });

    expect(result.status).toBe("collected");
    expect(runner).toHaveBeenCalledTimes(1);
    const cache = await readTodayObservations(root, new Date("2026-05-23T01:30:00.000Z"));
    expect(cache).toContain("society satire");
    expect(cache).toContain("再開発");
    expect(cache).toContain("ロビイング");
    expect(cache).toContain("watch_a");
    expect(cache).toContain("watch_b");
    expect(cache).toContain("watch_c");
    expect(cache).toContain("Sat May 23");
  });

  it("skips when the rate limiter denies another call", async () => {
    const root = workspace();
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "config-overrides.json"), JSON.stringify({ bird: { rateLimits: { dailyMax: 1, minIntervalMinutes: 60 } } }), "utf8");
    await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      runner: async () => ({ stdout: "@watcher first observation https://x.com/watcher/status/1111111111111111111 2026-04-29T01:00:00.000Z" })
    });
    await writeFile(join(root, "observations", "2026-04-29.md"), "", "utf8");

    const result = await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      runner: async () => ({ stdout: "@watcher second observation https://x.com/watcher/status/2222222222222222222 2026-04-29T02:00:00.000Z" })
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("daily bird call limit");
  });

  // Expected values were measured against the live search API: a coined
  // compound returns nothing ("原宿 転売列" -> 0 hits) while its common-noun form
  // does ("原宿 転売" -> 10), so a lyric coinage is reduced to the word a real
  // person would type, and two tokens are emitted rather than three.
  it("decomposes a bank noun phrase into quote-free common-word AND tokens", () => {
    const cases: Array<[string, string[]]> = [
      ["顔のローン", ["顔", "ローン"]],
      ["整形広告で埋まる駅", ["整形広告", "駅"]],
      ["ツアーと客と店、全員渋谷", ["ツアー", "客"]],
      ["原宿の転売列", ["原宿", "転売"]],
      ["同じ顔の量産ライン", ["同じ顔", "量産"]],
      ["推し活の損益", ["推し活", "損益"]],
      ["炎上の賞味期限", ["炎上", "賞味期限"]],
      ["十五秒の寿命", ["十五秒", "寿命"]]
    ];
    for (const [phrase, expected] of cases) {
      const tokens = decomposeToQueryTokens(phrase);
      expect(tokens).toEqual(expected);
      expect(tokens.length).toBeLessThanOrEqual(3);
      for (const token of tokens) {
        expect(token).not.toContain('"');
        expect(token).not.toMatch(/[のにとがをはもでへ、。]/);
      }
    }
  });

  it("does not wrap any generated lens query in double quotes", async () => {
    const root = workspace();
    await writeSongBrief(root, "spawn_recent", "## Direction\n- Lyrics theme: 何か別の話題。\n");
    // Primary news query returns nothing so the rotating lens queries are tried.
    const runner = vi.fn(async (query?: string) => ({
      stdout: query?.includes("lang:ja")
        ? "@citywatch 街の熱が商品になる https://x.com/citywatch/status/2222222222222222222 2026-04-29T01:30:00.000Z"
        : ""
    }));

    await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      personaText: [
        "### Consumption & Face Material Bank",
        "- 顔のローン: 輪郭を分割払い。",
        "### Net & Generation Material Bank",
        "- 炎上の賞味期限: 熱が在庫になる。",
        "### Shibuya Diss Material Bank",
        "- 免税袋のドンキ巡礼: 街が導線になる。"
      ].join("\n"),
      runner
    });

    const lensQueries = runner.mock.calls
      .map(([query]) => query)
      .filter((query): query is string => typeof query === "string" && query.includes("lang:ja"));
    expect(lensQueries.length).toBeGreaterThan(0);
    for (const query of lensQueries) {
      expect(query).not.toContain('"');
      expect(query.split(" ").filter((token) => token !== "lang:ja").length).toBeLessThanOrEqual(3);
    }
  });

  it("never lets a free-text manual-seed instruction become a search query", async () => {
    const root = workspace();
    const runner = vi.fn(async () => ({
      stdout: "@citywatch 街の熱が商品になる https://x.com/citywatch/status/2222222222222222222 2026-04-29T01:30:00.000Z"
    }));

    await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      personaText: [
        "### Consumption & Face Material Bank",
        "- 顔のローン: 輪郭を分割払い。"
      ].join("\n"),
      manualSeed: { hint: "今日のXで話題の出来事を素材に新曲を1曲 canon の回転規則に従う" },
      runner
    });

    for (const [query] of runner.mock.calls) {
      for (const marker of ["新曲", "canon", "素材", "回転規則"]) {
        expect(String(query ?? "")).not.toContain(marker);
      }
    }
  });
});

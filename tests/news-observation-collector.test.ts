import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMotifNewsSearchUrls,
  collectNewsObservations,
  parseNewsObservationFile,
  readTodayNewsObservations
} from "../src/services/newsObservationCollector";
import { extractPersonaMotifs } from "../src/services/personaMotifExtractor";

const originalRssUrls = process.env.OPENCLAW_NEWS_RSS_URLS;

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-news-observation-"));
  return root;
}

const rssSample = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Sample News</title>
  <item>
    <title>LUUP 事故、 渋谷で発生</title>
    <description>渋谷の交差点で電動キックボード LUUP に乗った男性が転倒、 X 上で再開発と都市の安全について議論。</description>
    <link>https://example.test/news/luup-shibuya-incident</link>
    <pubDate>Sat, 23 May 2026 09:30:00 +0000</pubDate>
  </item>
  <item>
    <title>六本木の経営者、 文化均質化を語る</title>
    <description>港区の経営者団体が街の文化均質化と再開発について議論、 観光地化への懸念を表明。</description>
    <link>https://example.test/news/roppongi-culture-roundtable</link>
    <pubDate>Sat, 23 May 2026 06:00:00 +0000</pubDate>
  </item>
</channel>
</rss>`;

const atomSample = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Sample Atom Feed</title>
  <entry>
    <title>新宿の路地裏で経営者ロビイング集会</title>
    <summary>新宿の経営者層によるロビイング活動が活発化、 ビジネス用語が地べたに降りる二面性をめぐる議論。</summary>
    <link href="https://atom.example.test/shinjuku-roby"/>
    <updated>2026-05-23T05:00:00Z</updated>
  </entry>
</feed>`;

const encodedHtmlSample = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Google News Search</title>
  <item>
    <title>&lt;a href="https://example.com/articles/nafusa-redstar"&gt;ナフサと赤星&lt;/a&gt;</title>
    <description>&lt;a href="https://news.google.com/rss/articles/${"y".repeat(120)}"&gt;石油と野球の夜&lt;/a&gt;</description>
    <link>https://news.google.com/rss/articles/example</link>
    <source url="https://example.com/">Example News</source>
  </item>
</channel>
</rss>`;

const googleIntermediateOnlySample = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Google News Search</title>
  <item>
    <title>夜の昆虫観察、渋谷で開催</title>
    <description>体験型昆虫展の内容を紹介。</description>
    <link>https://news.google.com/rss/articles/example</link>
    <source url="https://www.bcnretail.com/">BCN+R</source>
  </item>
</channel>
</rss>`;

beforeEach(() => {
  delete process.env.OPENCLAW_NEWS_RSS_URLS;
});

afterEach(() => {
  if (originalRssUrls === undefined) {
    delete process.env.OPENCLAW_NEWS_RSS_URLS;
  } else {
    process.env.OPENCLAW_NEWS_RSS_URLS = originalRssUrls;
  }
});

describe("news observation collector", () => {
  it("skips when OPENCLAW_NEWS_RSS_URLS is unset", async () => {
    const root = workspace();
    const result = await collectNewsObservations(root, {
      now: new Date("2026-05-23T01:00:00.000Z")
    });
    expect(result.status).toBe("skipped");
    expect(result.entries).toEqual([]);
    expect(result.reason).toContain("OPENCLAW_NEWS_RSS_URLS");
  });

  it("builds Google News search RSS URLs from persona motifs", () => {
    const motifs = extractPersonaMotifs("## Lyrics\n- テーマ: 社会風刺\n- テーマ: 再開発\n## Geographies\n六本木\n");
    const urls = buildMotifNewsSearchUrls(motifs);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("https://news.google.com/rss/search?");
    expect(decodeURIComponent(urls[0])).toContain("六本木");
    expect(decodeURIComponent(urls[0])).toContain("社会風刺");
    expect(decodeURIComponent(urls[0])).toContain("再開発");
    expect(decodeURIComponent(urls[0])).toContain(" OR ");
    expect(urls[0]).toContain("ceid=JP:ja");
  });

  it("parses RSS 2.0 items and writes a daily cache", async () => {
    const root = workspace();
    process.env.OPENCLAW_NEWS_RSS_URLS = "https://example.test/rss.xml";
    const fetcher = vi.fn(async () => rssSample);

    const result = await collectNewsObservations(root, {
      now: new Date("2026-05-23T01:00:00.000Z"),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.status).toBe("collected");
    expect(result.entries.length).toBe(2);
    expect(result.entries[0].text).toContain("LUUP");
    expect(result.entries.some((entry) => entry.text.includes("六本木"))).toBe(true);
    expect(result.entries.some((entry) => entry.text.includes("文化均質化"))).toBe(true);
    expect(result.entries[0].url).toContain("example.test");
    expect(result.entries[0].source).toBe("example.test");

    const cached = await readFile(join(root, "observations", "2026-05-23.md").replace("2026-05-23.md", "news-2026-05-23.md"), "utf8");
    expect(cached).toContain("LUUP");
    expect(cached).toContain("六本木");

    const reread = await readTodayNewsObservations(root, new Date("2026-05-23T02:00:00.000Z"));
    expect(reread.length).toBe(2);
    expect(reread[0].url).toContain("example.test");
  });

  it("parses Atom entries with link href and updated date", async () => {
    const root = workspace();
    process.env.OPENCLAW_NEWS_RSS_URLS = "https://atom.example.test/feed.xml";
    const fetcher = vi.fn(async () => atomSample);

    const result = await collectNewsObservations(root, {
      now: new Date("2026-05-23T01:00:00.000Z"),
      fetcher
    });
    expect(result.status).toBe("collected");
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].url).toBe("https://atom.example.test/shinjuku-roby");
    expect(result.entries[0].postedAt).toBe("2026-05-23T05:00:00Z");
    expect(result.entries[0].text).toContain("新宿");
  });

  it("decodes RSS entities before stripping encoded HTML tags", async () => {
    const root = workspace();
    process.env.OPENCLAW_NEWS_RSS_URLS = "https://news.google.com/rss/search?q=test";
    const fetcher = vi.fn(async () => encodedHtmlSample);

    const result = await collectNewsObservations(root, {
      now: new Date("2026-05-23T01:00:00.000Z"),
      fetcher
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].text).toContain("ナフサと赤星");
    expect(result.entries[0].text).toContain("石油と野球の夜");
    expect(result.entries[0].text).not.toContain("<a");
    expect(result.entries[0].text).not.toContain("href=");
    expect(result.entries[0].source).toBe("Example News");
    expect(result.entries[0].url).toBe("https://example.com/articles/nafusa-redstar");
  });

  it("does not cache Google News RSS article intermediates as article URLs", async () => {
    const root = workspace();
    process.env.OPENCLAW_NEWS_RSS_URLS = "https://news.google.com/rss/search?q=test";
    const fetcher = vi.fn(async () => googleIntermediateOnlySample);

    const result = await collectNewsObservations(root, {
      now: new Date("2026-05-23T01:00:00.000Z"),
      fetcher
    });

    expect(result.status).toBe("collected");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].source).toBe("BCN+R");
    expect(result.entries[0].url).toBeUndefined();
    const cached = await readTodayNewsObservations(root, new Date("2026-05-23T01:30:00.000Z"));
    expect(cached[0].url).toBeUndefined();
  });

  it("returns cached entries on subsequent runs within TTL", async () => {
    const root = workspace();
    process.env.OPENCLAW_NEWS_RSS_URLS = "https://example.test/rss.xml";
    const fetcher = vi.fn(async () => rssSample);

    const first = await collectNewsObservations(root, {
      now: new Date("2026-05-23T01:00:00.000Z"),
      fetcher
    });
    const second = await collectNewsObservations(root, {
      now: new Date("2026-05-23T02:00:00.000Z"),
      fetcher
    });

    expect(first.status).toBe("collected");
    expect(second.status).toBe("cached");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(second.entries.length).toBe(first.entries.length);
  });

  it("scores entries against persona motifs so news related to ARTIST.md rises", async () => {
    const root = workspace();
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("news.google.com/rss/search");
      expect(decodeURIComponent(url)).toContain("六本木");
      return rssSample;
    });

    const result = await collectNewsObservations(root, {
      now: new Date("2026-05-23T01:00:00.000Z"),
      personaText: "## Lyrics\n- テーマ: 社会風刺、文化の均質化\n- 地理: 六本木\n",
      fetcher
    });

    // The roppongi article should outscore luup news because it carries
    // multiple persona motifs (六本木 + 文化均質化 + 経営者).
    expect(result.entries[0].text).toContain("六本木");
    expect((result.entries[0].motifScore ?? 0)).toBeGreaterThan(0);
  });

  it("parseNewsObservationFile rehydrates entries from cache contents", () => {
    const content = `# News Observations 2026-05-23\n\n- text: "LUUP 事故、 渋谷で発生 — content"\n  source: "example.test"\n  url: "https://example.test/news/luup"\n  postedAt: "Sat, 23 May 2026 09:30:00 +0000"\n  motifMatch: "geographies:渋谷"\n  motifScore: 4\n`;
    const parsed = parseNewsObservationFile(content);
    expect(parsed.length).toBe(1);
    expect(parsed[0].text).toContain("LUUP");
    expect(parsed[0].source).toBe("example.test");
    expect(parsed[0].motifScore).toBe(4);
  });
});

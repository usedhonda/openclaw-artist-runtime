import { describe, expect, it } from "vitest";
import { applyConfigDefaults } from "../src/config/schema";
import { getNewsRssUrls } from "../src/services/runtimeConfig";

describe("observation.newsRssUrls config resolution", () => {
  it("prefers config over OPENCLAW_NEWS_RSS_URLS", () => {
    const config = applyConfigDefaults({
      observation: { newsRssUrls: ["https://config.example.test/rss.xml"] }
    });

    expect(getNewsRssUrls(config, { OPENCLAW_NEWS_RSS_URLS: "https://env.example.test/rss.xml" })).toEqual([
      "https://config.example.test/rss.xml"
    ]);
  });

  it("falls back to OPENCLAW_NEWS_RSS_URLS when config list is empty", () => {
    const config = applyConfigDefaults({
      observation: { newsRssUrls: [] }
    });

    expect(getNewsRssUrls(config, { OPENCLAW_NEWS_RSS_URLS: "https://env.example.test/a.xml, https://env.example.test/b.xml" })).toEqual([
      "https://env.example.test/a.xml",
      "https://env.example.test/b.xml"
    ]);
  });

  it("falls back to OPENCLAW_NEWS_RSS_URLS when config is undefined", () => {
    expect(getNewsRssUrls(undefined, { OPENCLAW_NEWS_RSS_URLS: "https://env.example.test/rss.xml" })).toEqual([
      "https://env.example.test/rss.xml"
    ]);
  });

  it("returns [] when neither config nor env provides feeds", () => {
    const config = applyConfigDefaults({ observation: { newsRssUrls: [] } });

    expect(getNewsRssUrls(config, {})).toEqual([]);
  });
});

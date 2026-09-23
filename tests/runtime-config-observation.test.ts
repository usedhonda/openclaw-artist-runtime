import { describe, expect, it } from "vitest";
import { applyConfigDefaults } from "../src/config/schema";
import { getNewsRssUrls, isXTcoFetchEnabled } from "../src/services/runtimeConfig";

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

describe("observation.xTcoFetchEnabled config resolution", () => {
  it("prefers config true over OPENCLAW_X_TCO_FETCH_ENABLED unset", () => {
    const config = applyConfigDefaults({
      observation: { xTcoFetchEnabled: true }
    });

    expect(isXTcoFetchEnabled(config, {})).toBe(true);
  });

  it("prefers config false over OPENCLAW_X_TCO_FETCH_ENABLED=1", () => {
    const config = applyConfigDefaults({
      observation: { xTcoFetchEnabled: false }
    });

    expect(isXTcoFetchEnabled(config, { OPENCLAW_X_TCO_FETCH_ENABLED: "1" })).toBe(false);
  });

  it("falls back to OPENCLAW_X_TCO_FETCH_ENABLED when config is undefined", () => {
    expect(isXTcoFetchEnabled(undefined, { OPENCLAW_X_TCO_FETCH_ENABLED: "1" })).toBe(true);
    expect(isXTcoFetchEnabled(undefined, {})).toBe(false);
  });

  it("leaves the toggle unset by default so env stays the fallback", () => {
    const config = applyConfigDefaults({});

    expect(config.observation.xTcoFetchEnabled).toBeUndefined();
    expect(isXTcoFetchEnabled(config, {})).toBe(false);
    expect(isXTcoFetchEnabled(config, { OPENCLAW_X_TCO_FETCH_ENABLED: "1" })).toBe(true);
  });
});

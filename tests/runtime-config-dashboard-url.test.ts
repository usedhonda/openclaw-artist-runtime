import { describe, expect, it } from "vitest";
import { applyConfigDefaults } from "../src/config/schema";
import { getDashboardBaseUrl } from "../src/services/runtimeConfig";

describe("dashboard base URL config resolution", () => {
  it("prefers config over OPENCLAW_DASHBOARD_BASE_URL", () => {
    const config = applyConfigDefaults({
      dashboard: { baseUrl: "https://config.example.test" }
    });

    expect(getDashboardBaseUrl(config, { OPENCLAW_DASHBOARD_BASE_URL: "https://env.example.test" })).toBe("https://config.example.test");
  });

  it("falls back to OPENCLAW_DASHBOARD_BASE_URL when config is blank", () => {
    const config = applyConfigDefaults({
      dashboard: { baseUrl: "" }
    });

    expect(getDashboardBaseUrl(config, { OPENCLAW_DASHBOARD_BASE_URL: " https://env.example.test " })).toBe("https://env.example.test");
  });

  it("returns undefined when neither config nor env provides a URL", () => {
    const config = applyConfigDefaults({
      dashboard: { baseUrl: "" }
    });

    expect(getDashboardBaseUrl(config, {})).toBeUndefined();
  });
});

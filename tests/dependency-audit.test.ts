import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("dependency audit policy", () => {
  it("keeps Vitest on the 2.x framework line", () => {
    expect(packageJson.devDependencies?.vitest).toMatch(/^\^?2\./);
    expect(packageJson.devDependencies?.["@vitest/coverage-v8"]).toMatch(/^\^?2\./);
  });

  it("pins vulnerable transitive dependencies through root overrides", () => {
    expect(packageJson.overrides).toMatchObject({
      esbuild: "^0.25.0",
      uuid: "^14.0.0",
      "fast-xml-parser": "^5.7.2",
      gaxios: "^7.1.4",
      "google-auth-library": "^10.6.2"
    });
    expect(packageJson.peerDependenciesMeta?.openclaw?.optional).toBe(true);
  });

  it("runs a production dependency audit gate in CI", () => {
    expect(ciWorkflow).toContain("audit:");
    expect(ciWorkflow).toContain("npm audit --audit-level=moderate --omit=dev");
  });
});

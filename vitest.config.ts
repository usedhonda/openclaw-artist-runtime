import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.openclaw-browser-profiles/**"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "scripts/boundary-grep.mjs"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 70
      }
    }
  }
});

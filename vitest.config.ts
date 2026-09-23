import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup-workspace-isolation.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.openclaw-browser-profiles/**", "**/.local/**"],
    testTimeout: 30000,
    // openclaw-suno-login.test.ts races a backgrounded fake-Chrome subprocess
    // (writing chrome-args.txt) against a curl-retry loop whose fake sleep/curl
    // stand-ins return instantly (no real delay), so the outcome depends on raw
    // OS fork/exec scheduling order. Under full-suite parallel load that order
    // flips intermittently ("resolves the visible Chrome app..." expects a write
    // that hasn't landed yet). A dedicated single fork removes contention from
    // vitest's own worker pool for this file; it does not fix the underlying
    // race, only makes it far less likely to flip under CI-scale parallelism.
    poolMatchGlobs: [["tests/scripts/openclaw-suno-login.test.ts", "forks"]],
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
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

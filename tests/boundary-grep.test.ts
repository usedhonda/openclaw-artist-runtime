import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanBoundaryPatterns } from "../scripts/boundary-grep.mjs";

async function writeFixture(root: string, relativePath: string, contents: string): Promise<void> {
  const target = join(root, relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents, "utf8");
}

describe("boundary-grep", () => {
  it("detects forbidden credential assignment patterns", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-boundary-grep-hit-"));
    await writeFixture(root, "src/leak.ts", `const leaked = "${"SUNO_" + "PASSWORD="}real-value";\n`);

    const findings = await scanBoundaryPatterns({ cwd: root, roots: ["src"] });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "src/leak.ts",
      line: 1,
      rule: "suno-password-assignment"
    });
  });

  it("passes clean source and test files", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-boundary-grep-clean-"));
    await writeFixture(root, "src/index.ts", "export const status = 'ok';\n");
    await writeFixture(root, "tests/index.test.ts", "expect('ok').toBe('ok');\n");

    const findings = await scanBoundaryPatterns({ cwd: root, roots: ["src", "tests"] });

    expect(findings).toEqual([]);
  });

  it("does not flag safe environment-variable names without inline secret assignment", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-boundary-grep-safe-env-"));
    await writeFixture(
      root,
      "tests/env.test.ts",
      [
        `vi.stubEnv("${"OPENCLAW_" + "TIKTOK_ACCESS_TOKEN"}", "configured-token");`,
        "const token = process.env[name]?.trim();"
      ].join("\n")
    );

    const findings = await scanBoundaryPatterns({ cwd: root, roots: ["tests"] });

    expect(findings).toEqual([]);
  });

  it("detects expanded credential and header leak patterns", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-boundary-grep-expanded-"));
    await writeFixture(
      root,
      "src/expanded-leaks.ts",
      [
        `const sunoApiKey = "${"SUNO_" + "API_KEY="}abc";`,
        `const oauthToken = "${"OAUTH_" + "TOKEN="}abc";`,
        `const igToken = "${"OPENCLAW_" + "INSTAGRAM_ACCESS_TOKEN="}abc";`,
        `const ttToken = "${"OPENCLAW_" + "TIKTOK_" + "ACCESS_TOKEN="}abc";`,
        `const legacyTtToken = "${"TIKTOK_" + "ACCESS_TOKEN="}abc";`,
        `const headers = { ${"coo" + "kie"}: '${"sessionid=" + "abc123456789"}' };`
      ].join("\n")
    );

    const findings = await scanBoundaryPatterns({ cwd: root, roots: ["src"] });

    expect(findings.map((finding) => finding.rule)).toEqual([
      "suno-api-key-assignment",
      "oauth-token-assignment",
      "openclaw-instagram-token-assignment",
      "openclaw-tiktok-token-assignment",
      "tiktok-token-assignment",
      "cookie-header-literal"
    ]);
  });

  it("detects Telegram bot token assignments and literals", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-boundary-grep-telegram-"));
    await writeFixture(
      root,
      "src/telegram-leaks.ts",
      [
        `const env = "${"TELEGRAM_" + "BOT_TOKEN="}secret";`,
        `const token = "${"bot" + "1234567890:" + "abcdefghijklmnopqrstuvwxyzABCDEF"}";`
      ].join("\n")
    );

    const findings = await scanBoundaryPatterns({ cwd: root, roots: ["src"] });

    expect(findings.map((finding) => finding.rule)).toEqual(["telegram-token-assignment", "telegram-token-literal"]);
  });

  it("detects bash 4 syntax that would break macOS bash 3 operators", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-boundary-grep-bash4-"));
    await writeFixture(
      root,
      "scripts/bad.sh",
      [
        "#!/usr/bin/env bash",
        `${"map" + "file"} lines < input.txt`,
        `${"read" + "array"} more_lines < input.txt`,
        `echo "${"${name" + "^^}"}"`,
        `echo "${"${name" + ",,}"}"`,
        `${"declare" + " -A"} table`,
        `${"co" + "proc"} worker { cat; }`
      ].join("\n")
    );

    const findings = await scanBoundaryPatterns({ cwd: root, roots: ["scripts"] });

    expect(findings.map((finding) => finding.rule)).toEqual([
      "bash-mapfile",
      "bash-readarray",
      "bash-uppercase-expansion",
      "bash-lowercase-expansion",
      "bash-associative-array",
      "bash-coproc"
    ]);
  });

  it("allows bash 3 compatible shell loops and arrays", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-boundary-grep-bash3-clean-"));
    await writeFixture(
      root,
      "scripts/good.sh",
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "items=\"\"",
        "while IFS= read -r line; do",
        "  items=\"${items}${line}\"",
        "done < input.txt"
      ].join("\n")
    );

    const findings = await scanBoundaryPatterns({ cwd: root, roots: ["scripts"] });

    expect(findings).toEqual([]);
  });

  it("skips a forbidden pattern when a matching allow pragma is on the preceding line", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-boundary-grep-pragma-allow-"));
    await writeFixture(
      root,
      "tests/pragma.test.ts",
      [
        "// boundary-grep-allow: telegram-token-assignment",
        `const fixture = "${"TELEGRAM_" + "BOT_TOKEN="}abcd1234efgh5678";`
      ].join("\n")
    );

    const findings = await scanBoundaryPatterns({ cwd: root, roots: ["tests"] });

    expect(findings).toEqual([]);
  });

  it("still flags a forbidden pattern when the allow pragma names a different rule id", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-boundary-grep-pragma-mismatch-"));
    await writeFixture(
      root,
      "tests/pragma-mismatch.test.ts",
      [
        "// boundary-grep-allow: suno-password-assignment",
        `const fixture = "${"TELEGRAM_" + "BOT_TOKEN="}abcd1234efgh5678";`
      ].join("\n")
    );

    const findings = await scanBoundaryPatterns({ cwd: root, roots: ["tests"] });

    expect(findings.map((finding) => finding.rule)).toEqual(["telegram-token-assignment"]);
  });

  it("does not flag safe cookie lifecycle messages without dumped values", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-boundary-grep-cookie-message-"));
    await writeFixture(
      root,
      "scripts/login.mjs",
      "console.log(`login cookie saved to ${profilePath}`);\n"
    );

    const findings = await scanBoundaryPatterns({ cwd: root, roots: ["scripts"] });

    expect(findings).toEqual([]);
  });
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-legacy-wizard-"));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("legacy wizard flag", () => {
  it("keeps /persona command help available when OPENCLAW_LEGACY_WIZARD=on", async () => {
    const root = workspace();
    vi.stubEnv("OPENCLAW_LEGACY_WIZARD", "on");

    const result = await routeTelegramCommand({ text: "/persona hello", fromUserId: 1, chatId: 2, workspaceRoot: root });

    expect(result.responseText).toContain("Usage: /persona show");
  });

  it("keeps /setup routed safely under the flag without reviving wizard state", async () => {
    const root = workspace();
    vi.stubEnv("OPENCLAW_LEGACY_WIZARD", "on");

    const result = await routeTelegramCommand({ text: "/setup", fromUserId: 1, chatId: 2, workspaceRoot: root });

    expect(result.responseText).not.toContain("I heard this:");
    expect(result.responseText.length).toBeGreaterThan(0);
  });
});

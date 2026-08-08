import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("openclaw-local-write-smoke.sh", () => {
  it("forces every write request into a disposable workspace", () => {
    const script = readFileSync("scripts/openclaw-local-write-smoke.sh", "utf8");
    const lines = script.split("\n");

    expect(script).toContain('smoke_workspace_root="$(mktemp -d');
    expect(script).toContain('workspace_root="${smoke_workspace_root}"');
    expect(lines).not.toContain('workspace_root="${OPENCLAW_LOCAL_WORKSPACE}"');
    expect(script).toContain("trap cleanup EXIT");
  });
});

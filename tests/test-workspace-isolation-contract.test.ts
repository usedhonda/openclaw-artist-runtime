import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vitest workspace isolation", () => {
  it("always replaces an inherited live workspace with a temporary root", () => {
    const setup = readFileSync("tests/setup-workspace-isolation.ts", "utf8");

    expect(setup).toContain(
      'process.env.OPENCLAW_LOCAL_WORKSPACE = mkdtempSync(join(tmpdir(), "artist-runtime-test-ws-"));'
    );
    expect(setup).not.toContain("if (!process.env.OPENCLAW_LOCAL_WORKSPACE");
  });
});

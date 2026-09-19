import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NORMAL_SUNO_CONTROLS } from "../src/suno-production/generatePromptPack";

function decisionTable(section: string): Record<string, string> {
  const doc = readFileSync("docs/PRODUCER_DECISIONS.md", "utf8");
  const body = doc.split(`## ${section}`)[1]?.split("###")[0] ?? "";
  const rows: Record<string, string> = {};
  for (const match of body.matchAll(/^\| (\w+) \| ([^|]+?) \|$/gm)) {
    if (match[1] !== "Control") rows[match[1]] = match[2];
  }
  return rows;
}

const asDecision = (value: unknown) =>
  typeof value === "boolean" ? (value ? "On" : "Off") : String(value);

describe("producer decisions ledger", () => {
  it("keeps the normal Suno controls equal to the producer's recorded ruling", () => {
    const recorded = decisionTable("Suno normal generation controls");
    const inCode = Object.fromEntries(
      Object.entries(NORMAL_SUNO_CONTROLS).map(([key, value]) => [key, asDecision(value)])
    );
    expect(inCode).toEqual(recorded);
  });

  it("keeps the driver documentation on the recorded ruling", () => {
    const recorded = decisionTable("Suno normal generation controls");
    const driverDoc = readFileSync("docs/SUNO_BROWSER_DRIVER.md", "utf8").replace(/\s+/g, " ");
    expect(driverDoc).toContain(`Max Mode ${recorded.maxMode}`);
    expect(driverDoc).toContain(`Personalize ${recorded.personalize}`);
  });
});

import { describe, expect, it } from "vitest";
import { validatePrepareOnlySubmitMode } from "../src/services/sunoRuns";

describe("Suno prepare-only assertion", () => {
  it("rejects prepareOnly outside manual mode and accepts manual mode", () => {
    expect(() => validatePrepareOnlySubmitMode("live", true)).toThrow("submitMode=manual");
    expect(() => validatePrepareOnlySubmitMode("skip", true)).toThrow("submitMode=manual");
    expect(() => validatePrepareOnlySubmitMode("manual", true)).not.toThrow();
  });
});

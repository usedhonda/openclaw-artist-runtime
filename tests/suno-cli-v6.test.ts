import { describe, expect, it } from "vitest";
import { buildCreateBody, isRetiredModel } from "../vendor/suno-cli/dist/src/create/body.js";

describe("vendored suno-cli V6 contract", () => {
  it("defaults new creates to the observed V6 model identifier", () => {
    const body = buildCreateBody({ title: "V6 Trial", style: "dry rap vocal" });

    expect(body.mv).toBe("chirp-hawk");
    expect(isRetiredModel("v5.5")).toBe(true);
    expect(isRetiredModel("v6")).toBe(false);
  });

  it("maps optional V6 controls without enabling them by default", () => {
    const base = buildCreateBody({ title: "Base", style: "dry rap vocal" });
    const controlled = buildCreateBody({
      title: "Controlled",
      style: "dry rap vocal",
      variety: 0,
      maxMode: true
    });

    expect(base.metadata.is_max_mode).toBe(false);
    expect(base.metadata.control_sliders).toBeUndefined();
    expect(controlled.metadata.is_max_mode).toBe(true);
    expect(controlled.metadata.control_sliders).toMatchObject({ aug_creativity: 0 });
  });
});

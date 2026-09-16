import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { prepareSunoForm, readSunoControls } from "../src/services/sunoPreparation";
import { SUNO_CREATE_SELECTORS } from "../src/services/sunoCreateForm";

type State = { value?: string; visible?: boolean; attrs?: Record<string, string>; clicks?: number; onClick?: () => void };

function fixture() {
  const states: Record<string, State> = {
    [SUNO_CREATE_SELECTORS.lyricsEditor]: { value: "old lyrics", visible: true },
    'textarea[placeholder*="style" i]': { value: "old style", visible: true },
    'input[placeholder="Song Title (Optional)"]:visible': { value: "old title", visible: true },
    'input[placeholder="Exclude styles"]': { value: "old exclude", visible: true }
  };
  const controls: Record<string, State> = {
    Model: { value: "V6", visible: true }, Duration: { value: "Auto", visible: true },
    Weirdness: { value: "50", visible: true }, "Style Influence": { value: "100", visible: true },
    "Audio Influence": { value: "44", visible: true }, Variety: { value: "2", visible: true },
    "Max Mode": { value: "false", visible: true, attrs: { "aria-checked": "false" } },
    Personalize: { value: "false", visible: true, attrs: { "aria-checked": "false" } }
  };
  const clicks: string[] = [];
  const makeLocator = (selector: string, state: State, row = false): any => {
    const locator: any = {
      first: () => locator,
      isVisible: async () => state.visible ?? false,
      waitFor: async () => { if (!(state.visible ?? false)) throw new Error("hidden"); },
      getAttribute: async (name: string) => state.attrs?.[name] ?? null,
      inputValue: async () => state.value ?? "",
      textContent: async () => state.value ?? "",
      fill: async (value: string) => { state.value = value; },
      click: async () => {
        clicks.push(selector);
        state.clicks = (state.clicks ?? 0) + 1;
        if (state.attrs?.["aria-checked"]) state.attrs["aria-checked"] = state.attrs["aria-checked"] === "true" ? "false" : "true";
        state.onClick?.();
      },
      locator: (kind: string) => {
        if (!row) return makeLocator(`${selector} ${kind}`, state);
        const label = Object.keys(controls).find((name) => selector.includes(JSON.stringify(name))) ?? "";
        return makeLocator(`${selector} ${kind}`, controls[label] ?? { visible: false });
      }
    };
    return locator;
  };
  const page = { locator: (selector: string) => {
    const direct = states[selector];
    if (direct) return makeLocator(selector, direct);
    if (selector.startsWith("xpath=")) return makeLocator(selector, {}, true);
    return makeLocator(selector, { visible: false });
  }} as unknown as Page;
  return { page, states, controls, clicks };
}

describe("prepareSunoForm", () => {
  it("fills supplied fields, applies explicit V6 controls, and never clicks Create", async () => {
    const { page, states, controls, clicks } = fixture();
    const result = await prepareSunoForm(page, {
      lyrics: "new lyrics", styleAndFeel: "new style", songName: "new title", excludeStyles: "",
      weirdness: 0, audioInfluence: 0, maxMode: false, personalize: false
    }, 20);
    expect(result).toMatchObject({ title: "new title", lyrics: "new lyrics", style: "new style", excludeStyles: "" });
    expect(states[SUNO_CREATE_SELECTORS.lyricsEditor].value).toBe("new lyrics");
    expect(states['textarea[placeholder*="style" i]'].value).toBe("new style");
    expect(states['input[placeholder="Exclude styles"]'].value).toBe("");
    expect(controls.Weirdness.value).toBe("0");
    expect(controls["Audio Influence"].value).toBe("0");
    expect(clicks.some((selector) => /Create/i.test(selector))).toBe(false);
  });

  it("preserves unspecified controls and fails closed when explicit exclude is absent", async () => {
    const fixtureState = fixture();
    await prepareSunoForm(fixtureState.page, { lyrics: "same" }, 20);
    expect(fixtureState.controls.Weirdness.value).toBe("50");
    expect(fixtureState.controls["Audio Influence"].value).toBe("44");
    const broken = fixture();
    delete broken.states['input[placeholder="Exclude styles"]'];
    await expect(prepareSunoForm(broken.page, { excludeStyles: "avoid" }, 20)).rejects.toThrow("suno_create_dom_missing");
  });
});

describe("readSunoControls", () => {
  it("returns current controls and omits controls that are not mounted", async () => {
    const { page, controls } = fixture();
    delete controls.Personalize;
    await expect(readSunoControls(page)).resolves.toMatchObject({ model: "V6", variety: 2, maxMode: false });
    await expect(readSunoControls(page)).resolves.not.toHaveProperty("personalize");
  });
});

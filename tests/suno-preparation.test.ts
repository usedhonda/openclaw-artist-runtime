import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { chromium } from "playwright";
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
    Weirdness: { value: "50", visible: true, attrs: { "aria-valuemin": "0", "aria-valuemax": "100" } }, "Style Influence": { value: "100", visible: true, attrs: { "aria-valuemin": "0", "aria-valuemax": "100" } },
    "Audio Influence": { value: "44", visible: true, attrs: { "aria-valuemin": "0", "aria-valuemax": "100" } }, Variety: { value: "2", visible: true, attrs: { "aria-valuemin": "0", "aria-valuemax": "4" } },
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
      innerText: async () => state.value ?? "",
      textContent: async () => state.value ?? "",
      fill: async (value: string) => { state.value = value; },
      press: async (key: string) => {
        // Live Suno sliders ignore Home/End and only move with arrow keys.
        if (key === "ArrowRight") state.value = String(Number(state.value ?? "0") + 1);
        if (key === "ArrowLeft") state.value = String(Number(state.value ?? "0") - 1);
      },
      click: async () => {
        clicks.push(selector);
        state.clicks = (state.clicks ?? 0) + 1;
        if (state.attrs?.["aria-checked"]) state.attrs["aria-checked"] = state.attrs["aria-checked"] === "true" ? "false" : "true";
        state.onClick?.();
      },
      locator: (kind: string) => {
        if (!row) return makeLocator(`${selector} ${kind}`, state);
        const label = selector.match(/normalize-space\(\.\)="([^"]+)"/)?.[1] ?? "";
        return makeLocator(`${selector} ${kind}`, controls[label] ?? { visible: false });
      },
      count: async () => 0,
      nth: (_index: number) => makeLocator(`${selector}:nth`, { visible: false })
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

  it("does not infer boolean Off from an unselected button's text", async () => {
    const unknown = fixture();
    delete unknown.controls["Max Mode"].attrs;
    await expect(prepareSunoForm(unknown.page, { maxMode: false }, 20)).rejects.toThrow("suno_prepare_readback_unknown: maxMode");
  });

  it("selects Song and expands the current Controls panel before filling song fields", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <button role="tab" aria-selected="false" id="song-tab">Song</button>
        <button role="tab" aria-selected="true" id="sounds-tab">Sounds</button>
        <section id="song-panel" hidden>
          <button id="controls" aria-expanded="false">Controls</button>
          <div id="control-fields" hidden>
            <input placeholder="Song Title (Optional)">
            <input placeholder="Exclude styles">
          </div>
        </section>
        <button id="create">Create</button>
      `);
      await page.evaluate(() => {
        const songTab = document.getElementById("song-tab")!;
        const soundsTab = document.getElementById("sounds-tab")!;
        const songPanel = document.getElementById("song-panel")!;
        songTab.addEventListener("click", () => {
          songTab.setAttribute("aria-selected", "true");
          soundsTab.setAttribute("aria-selected", "false");
          songPanel.removeAttribute("hidden");
        });
        const controls = document.getElementById("controls")!;
        controls.addEventListener("click", () => {
          controls.setAttribute("aria-expanded", "true");
          document.getElementById("control-fields")!.removeAttribute("hidden");
        });
        document.getElementById("create")!.addEventListener("click", () => document.body.dataset.createClicked = "true");
      });

      const prepared = await prepareSunoForm(page, {
        songName: "Tabbed Song",
        excludeStyles: "generic drop"
      }, 500);

      expect(prepared).toMatchObject({ title: "Tabbed Song", excludeStyles: "generic drop" });
      expect(await page.locator('#song-tab').getAttribute("aria-selected")).toBe("true");
      expect(await page.locator('#controls').getAttribute("aria-expanded")).toBe("true");
      expect(await page.locator("body").getAttribute("data-create-clicked")).toBeNull();
    } finally {
      await browser.close();
    }
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

describe("readSunoControls DOM contract", () => {
  it("recognizes the current Model: v6 accessible name", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <button role="tab" aria-selected="true">Song</button>
        <button role="tab" aria-selected="false">Sounds</button>
        <button aria-label="Model: v6">v6</button>
      `);
      await expect(prepareSunoForm(page, { model: "v6" }, 500)).resolves.toMatchObject({
        controls: { model: "v6" }
      });
    } finally {
      await browser.close();
    }
  });

  it("does not borrow a neighbouring slider and maps selected segmented values", async () => {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      // A missing installed browser is an environment limitation, not a green test.
      throw new Error(`Suno DOM fixture browser unavailable: ${error instanceof Error ? error.message : "launch failed"}`);
    }
    try {
      const page = await browser.newPage();
      await page.setContent(`
      <section data-row="weirdness"><label>Weirdness</label><div role="slider" style="width:100px;height:10px" aria-valuenow="50" aria-valuemin="0" aria-valuemax="100"></div></section>
      <section data-row="variety"><label>Variety</label><p>No control mounted</p></section>
      <section data-row="max"><label>Max Mode</label><button aria-pressed="true">Off</button><button aria-pressed="false">On</button></section>
      <section data-row="duration"><label>Duration</label><button aria-pressed="false">Custom</button><button aria-pressed="true">Auto</button></section>
    `);
      await expect(readSunoControls(page)).resolves.toMatchObject({ weirdness: 50, maxMode: false, duration: "Auto" });
      await expect(readSunoControls(page)).resolves.not.toHaveProperty("variety");
    } finally {
      await browser.close();
    }
  });

  it("recognizes the current unannotated Suno segmented controls and custom duration", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <section><label>Duration</label><div role="slider" aria-label="Duration" aria-valuenow="195" aria-valuemin="10" aria-valuemax="360"></div><input type="text" aria-label="Duration" value="3:15"></section>
        <section><label>Max Mode</label><button class="hxc-btn-variant-tertiary-legacy">Off</button><button class="hxc-btn-variant-standard-legacy">On</button></section>
        <section><label>Personalize</label><button>My Taste</button><button class="hxc-btn-variant-tertiary-legacy">Off</button><button class="hxc-btn-variant-standard-legacy">On</button></section>
      `);
      await expect(readSunoControls(page)).resolves.toMatchObject({ duration: "3:15", maxMode: true, personalize: true });
    } finally {
      await browser.close();
    }
  });

  it("sets current segmented controls and a custom duration without clicking Create", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <section id="duration"><label>Duration</label><button class="hxc-btn-variant-tertiary-legacy">Custom</button><button class="hxc-btn-variant-standard-legacy">Auto</button></section>
        <section id="max"><label>Max Mode</label><button class="hxc-btn-variant-standard-legacy">Off</button><button class="hxc-btn-variant-tertiary-legacy">On</button></section>
        <div id="panel" style="position:relative">
          <div id="more" role="button" aria-expanded="false" tabindex="0" style="position:absolute;inset:0;z-index:1;background:#fff;opacity:0.5">More Options</div>
          <section id="personalize"><div><span>Personalize</span><button class="hxc-btn-variant-tertiary-legacy">My Taste</button></div><button class="hxc-btn-variant-standard-legacy">Off</button><button class="hxc-btn-variant-tertiary-legacy">On</button></section>
          <section id="variety"><label>Variety</label><div role="slider" aria-label="Variety" aria-valuenow="4" aria-valuemin="0" aria-valuemax="4" style="width:100px;height:10px" tabindex="0"></div></section>
        </div>
        <button id="create">Create</button>
      `);
      page.setDefaultTimeout(2000);
      await page.evaluate(() => {
        // Live Suno collapses these controls under a "More Options" header that
        // intercepts clicks until it is expanded.
        const more = document.getElementById("more")!;
        more.addEventListener("click", () => {
          more.setAttribute("aria-expanded", "true");
          more.style.display = "none";
        });
        // Live Suno sliders ignore Home/End; only arrow keys move them.
        const variety = document.querySelector('#variety [role="slider"]')!;
        variety.addEventListener("keydown", (event) => {
          const keyboard = event as KeyboardEvent;
          let value = Number(variety.getAttribute("aria-valuenow"));
          if (keyboard.key === "ArrowRight") value = Math.min(4, value + 1);
          if (keyboard.key === "ArrowLeft") value = Math.max(0, value - 1);
          variety.setAttribute("aria-valuenow", String(value));
        });
        const select = (row: Element, selected: Element) => row.querySelectorAll("button").forEach((button) => {
          button.className = button === selected ? "hxc-btn-variant-standard-legacy" : "hxc-btn-variant-tertiary-legacy";
        });
        for (const id of ["max", "personalize"]) {
          const row = document.getElementById(id)!;
          row.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => select(row, button)));
        }
        const duration = document.getElementById("duration")!;
        duration.querySelector("button")!.addEventListener("click", () => {
          duration.innerHTML = '<label>Duration</label><div role="slider" aria-label="Duration" aria-valuenow="210" aria-valuemin="10" aria-valuemax="360" style="width:100px;height:10px" tabindex="0"></div><input type="text" aria-label="Duration" value="3:30">';
          const slider = duration.querySelector('[role="slider"]')!;
          const input = duration.querySelector("input")!;
          slider.addEventListener("keydown", (event) => {
            const keyboard = event as KeyboardEvent;
            let value = Number(slider.getAttribute("aria-valuenow"));
            if (keyboard.key === "ArrowRight") value += 5;
            if (keyboard.key === "ArrowLeft") value -= 5;
            slider.setAttribute("aria-valuenow", String(value));
            input.value = `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
          });
        });
        document.getElementById("create")!.addEventListener("click", () => document.body.dataset.createClicked = "true");
      });
      const prepared = await prepareSunoForm(page, { duration: "3:15", maxMode: true, personalize: true, variety: 2 }, 20);
      expect(prepared.controls).toMatchObject({ duration: "3:15", maxMode: true, personalize: true, variety: 2 });
      expect(await page.locator('[role="slider"][aria-label="Duration"]').getAttribute("aria-valuenow")).toBe("195");
      expect(await page.locator('[role="slider"][aria-label="Variety"]').getAttribute("aria-valuenow")).toBe("2");
      expect(await page.locator("body").getAttribute("data-create-clicked")).toBeNull();
    } finally {
      await browser.close();
    }
  });
});

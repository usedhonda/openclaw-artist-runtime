import type { Locator, Page } from "playwright";
import type { SunoCreatePayload } from "../types.js";
import {
  ensureSunoLyricsMode,
  ensureSunoSongMode,
  ensureSunoStyleMode,
  resolveFirstVisibleLocator
} from "./sunoCreateForm.js";

export interface SunoPreparedControls {
  model?: string;
  weirdness?: number;
  styleInfluence?: number;
  audioInfluence?: number;
  variety?: number;
  maxMode?: boolean;
  personalize?: boolean;
  duration?: string;
}

export interface SunoPreparedForm {
  title?: string;
  lyrics?: string;
  style?: string;
  excludeStyles?: string;
  controls: SunoPreparedControls;
}

const ADVANCED_OPTIONS = [
  'button:has-text("Advanced Options")',
  'button[aria-label*="Advanced Options" i]'
] as const;

const LABELS = {
  model: ["Model"],
  weirdness: ["Weirdness"],
  styleInfluence: ["Style Influence"],
  audioInfluence: ["Audio Influence"],
  variety: ["Variety"],
  maxMode: ["Max Mode"],
  personalize: ["Personalize", "My Taste"],
  duration: ["Duration"]
} as const;

function suppliedText(payload: SunoCreatePayload, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function hasString(payload: SunoCreatePayload, key: string): boolean {
  return typeof payload[key] === "string";
}

function controlValue(payload: SunoCreatePayload, key: string): unknown {
  return payload[key];
}

type ControlKind = "text" | "slider" | "boolean";

function rowLocator(page: Page, labels: readonly string[], kind: ControlKind): Locator {
  const label = labels.map((value) => `normalize-space(.)=${JSON.stringify(value)}`).join(" or ");
  const otherLabels = Object.values(LABELS).flat().filter((value) => !labels.includes(value));
  const other = otherLabels.length > 0
    ? ` and not(.//*[self::label or self::span or self::div][${otherLabels.map((value) => `normalize-space(.)=${JSON.stringify(value)}`).join(" or ")}])`
    : "";
  const target = kind === "slider"
    ? './/*[@role="slider" or self::input[@type="range"]]'
    : kind === "boolean"
      // A boolean row must hold an actual toggle. Live Suno nests the Personalize
      // label next to a "My Taste" button, so any button is not enough.
      ? './/*[@role="switch" or @role="radio" or @aria-pressed or @aria-checked or @data-state or self::input[@type="checkbox"] or (self::button and (normalize-space(.)="On" or normalize-space(.)="Off" or normalize-space(.)="Enabled" or normalize-space(.)="Disabled" or normalize-space(.)="Yes" or normalize-space(.)="No"))]'
      : './/input or .//select or .//button';
  return page.locator(
    `xpath=(//*[self::label or self::span or self::div][${label}]/ancestor::*[${target}${other}][1])`
  ).first();
}

async function visible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function firstControl(page: Page, labels: readonly string[], kind: ControlKind): Promise<Locator | undefined> {
  const row = rowLocator(page, labels, kind);
  const selectors = kind === "slider"
    ? ['[role="slider"]', 'input[type="range"]']
    : kind === "boolean"
      ? ['[role="switch"]', '[role="radio"]', 'input[type="checkbox"]', 'button[aria-pressed]', '[data-state]', 'button']
      : ['input', 'select', 'button'];
  const candidates = selectors.map((selector) => row.locator(selector).first());
  for (const candidate of candidates) if (await visible(candidate)) return candidate;
  return undefined;
}

async function readLocator(locator: Locator): Promise<string> {
  const value = await locator.inputValue().catch(() => undefined);
  if (typeof value === "string") return value;
  const innerText = await locator.innerText().catch(() => undefined);
  if (typeof innerText === "string") return innerText;
  return (await locator.textContent().catch(() => "")) ?? "";
}

async function readBoolean(locator: Locator): Promise<boolean | undefined> {
  const text = ((await locator.innerText().catch(() => "")) ?? "").trim().toLowerCase();
  const role = await locator.getAttribute("role").catch(() => null);
  const pressed = await locator.getAttribute("aria-pressed").catch(() => null);
  const dataState = await locator.getAttribute("data-state").catch(() => null);
  const className = await locator.getAttribute("class").catch(() => null);
  const selectedByClass = className?.includes("hxc-btn-variant-standard-legacy")
    ? true
    : className?.includes("hxc-btn-variant-tertiary-legacy")
      ? false
      : undefined;
  if (/^off$|^disabled$|^no$|^false$/.test(text) && selectedByClass !== undefined) return selectedByClass ? false : undefined;
  if (/^on$|^enabled$|^yes$|^true$/.test(text) && selectedByClass !== undefined) return selectedByClass ? true : undefined;
  if (role === "radio") {
    const selected = await locator.getAttribute("aria-checked").catch(() => null)
      ?? await locator.getAttribute("aria-pressed").catch(() => null)
      ?? await locator.getAttribute("data-state").catch(() => null);
    if (!(["true", "checked", "selected", "on"].includes(selected ?? ""))) return undefined;
    if (/^off$|^disabled$|^no$|^false$/.test(text)) return false;
    if (/^on$|^enabled$|^yes$|^true$/.test(text)) return true;
    return undefined;
  }
  const selected = pressed ?? await locator.getAttribute("aria-checked").catch(() => null) ?? dataState;
  if (role !== "radio" && pressed === null && dataState === null) {
    if (selected === "true" || selected === "false") return selected === "true";
  }
  if (/^off$|^disabled$|^no$|^false$/.test(text)) return selected === "true" || selected === "checked" || selected === "selected" || selected === "on" ? false : undefined;
  if (/^on$|^enabled$|^yes$|^true$/.test(text)) return selected === "true" || selected === "checked" || selected === "selected" || selected === "on" ? true : undefined;
  const isChecked = (locator as Locator & { isChecked?: () => Promise<boolean> }).isChecked;
  const checked = typeof isChecked === "function" ? await isChecked.call(locator).catch(() => undefined) : undefined;
  if (checked !== undefined) return checked;
  return undefined;
}

async function readNumber(locator: Locator): Promise<number | undefined> {
  const aria = await locator.getAttribute("aria-valuenow").catch(() => null);
  const raw = aria ?? await locator.inputValue().catch(() => "");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function textControl(page: Page, key: "model" | "duration"): Promise<Locator | undefined> {
  const byLabel = await firstControl(page, LABELS[key], "text");
  if (byLabel && key === "model") return byLabel;
  if (byLabel && key === "duration") {
    const inputType = await byLabel.getAttribute("type").catch(() => null);
    if (inputType && inputType !== "button") return byLabel;
    const state = await byLabel.getAttribute("aria-pressed").catch(() => null)
      ?? await byLabel.getAttribute("aria-checked").catch(() => null)
      ?? await byLabel.getAttribute("data-state").catch(() => null);
    const className = await byLabel.getAttribute("class").catch(() => null);
    if (["true", "checked", "selected", "on"].includes(state ?? "") || className?.includes("hxc-btn-variant-standard-legacy")) return byLabel;
    const row = rowLocator(page, LABELS.duration, "text");
    const buttons = row.locator("button");
    const count = await buttons.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = buttons.nth(index);
      const selected = await candidate.getAttribute("aria-pressed").catch(() => null)
        ?? await candidate.getAttribute("aria-checked").catch(() => null)
        ?? await candidate.getAttribute("data-state").catch(() => null);
      const candidateClass = await candidate.getAttribute("class").catch(() => null);
      if ((["true", "checked", "selected", "on"].includes(selected ?? "") || candidateClass?.includes("hxc-btn-variant-standard-legacy")) && await visible(candidate)) return candidate;
    }
  }
  if (key === "duration") return undefined;
  const getByRole = (page as Page & { getByRole?: Page["getByRole"] }).getByRole;
  if (typeof getByRole !== "function") return undefined;
  const pattern = key === "model" ? /^(?:Model:\s*)?v[0-9]+(?:\.[0-9]+)?$/i : /^(?:Auto|Custom)$/i;
  const candidates = getByRole.call(page, "button", { name: pattern });
  const count = await candidates.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (await visible(candidate)) return candidate;
  }
  return undefined;
}

async function booleanControlValue(page: Page, labels: readonly string[]): Promise<boolean | undefined> {
  const row = rowLocator(page, labels, "boolean");
  const radios = row.locator('[role="radio"], button[aria-pressed], button[aria-checked], button[data-state], button');
  const count = await radios.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const value = await readBoolean(radios.nth(index));
    if (value !== undefined) return value;
  }
  const direct = await firstControl(page, labels, "boolean");
  return direct ? readBoolean(direct) : undefined;
}

async function fillAndVerify(locator: Locator, value: string, name: string): Promise<void> {
  try {
    await locator.fill(value);
  } catch {
    const selectOption = (locator as Locator & { selectOption?: (option: { label: string; value: string }) => Promise<unknown> }).selectOption;
    if (typeof selectOption === "function") await selectOption.call(locator, { label: value, value });
    else throw new Error(`suno_prepare_control_unwritable: ${name}`);
  }
  const actual = await readLocator(locator);
  if (actual !== value) throw new Error(`suno_prepare_readback_mismatch: ${name}`);
}

async function chooseTextControl(page: Page, locator: Locator, value: string, name: string): Promise<void> {
  if ((await readLocator(locator)) === value) return;
  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
  if (tagName !== "button") {
    await fillAndVerify(locator, value, name);
    return;
  }
  await locator.click();
  const getByRole = (page as Page & { getByRole?: Page["getByRole"] }).getByRole;
  if (typeof getByRole !== "function") throw new Error(`suno_prepare_control_unwritable: ${name}`);
  const option = getByRole.call(page, "option", { name: value, exact: true }).first();
  const menuItem = getByRole.call(page, "menuitem", { name: value, exact: true }).first();
  const candidate = (await visible(option)) ? option : (await visible(menuItem) ? menuItem : undefined);
  if (!candidate) throw new Error(`suno_prepare_control_unknown_option: ${name}`);
  await candidate.click();
  if ((await readLocator(locator)) !== value) throw new Error(`suno_prepare_readback_mismatch: ${name}`);
}

async function setSlider(page: Page, labels: readonly string[], value: number, name: string): Promise<void> {
  const locator = await firstControl(page, labels, "slider");
  if (!locator) throw new Error(`suno_prepare_control_missing: ${name}`);
  const minRaw = await locator.getAttribute("aria-valuemin").catch(() => null) ?? await locator.getAttribute("min").catch(() => null);
  const maxRaw = await locator.getAttribute("aria-valuemax").catch(() => null) ?? await locator.getAttribute("max").catch(() => null);
  const stepRaw = await locator.getAttribute("aria-valuestep").catch(() => null) ?? await locator.getAttribute("step").catch(() => null);
  if (!minRaw || !maxRaw) throw new Error(`suno_prepare_control_bounds_missing: ${name}`);
  const min = Number(minRaw);
  const max = Number(maxRaw);
  const step = Number(stepRaw ?? "1");
  if (![min, max, step].every(Number.isFinite) || step <= 0 || value < min || value > max || !Number.isInteger((value - min) / step)) {
    throw new Error(`suno_prepare_invalid_control: ${name}`);
  }
  await stepSliderTo(locator, value, name);
}

// Current Suno nests song controls under a top-level "Controls" accordion. Older
// revisions used "More Options" for the same click-interception boundary. Expand
// both semantic headers before resolving any row; never guess from a generic button.
async function expandControlPanels(page: Page): Promise<void> {
  for (const label of ["Controls", "More Options"]) {
    const header = page.locator(
      `xpath=(//*[(@role="button" or self::button) and @aria-expanded][normalize-space(.)=${JSON.stringify(label)} or .//*[normalize-space(.)=${JSON.stringify(label)}]])[1]`
    ).first();
    if (!await visible(header)) continue;
    if ((await header.getAttribute("aria-expanded").catch(() => null)) !== "false") continue;
    await header.click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await header.getAttribute("aria-expanded").catch(() => null)) === "true") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if ((await header.getAttribute("aria-expanded").catch(() => null)) !== "true") {
      throw new Error(`suno_prepare_control_unwritable: ${label.toLowerCase()}`);
    }
  }
}

async function readSliderValue(locator: Locator): Promise<number> {
  return Number(await locator.getAttribute("aria-valuenow").catch(() => null) ?? await locator.inputValue().catch(() => ""));
}

// Suno sliders ignore Home/End, so walk from the current value with arrow keys and
// require every press to move toward the target without overshooting it.
async function stepSliderTo(locator: Locator, target: number, name: string): Promise<void> {
  let current = await readSliderValue(locator);
  if (!Number.isFinite(current)) throw new Error(`suno_prepare_readback_unknown: ${name}`);
  for (let presses = 0; current !== target; presses += 1) {
    if (presses >= 1000) throw new Error(`suno_prepare_readback_mismatch: ${name}`);
    const forward = current < target;
    await locator.press(forward ? "ArrowRight" : "ArrowLeft");
    const next = await readSliderValue(locator);
    const moved = forward ? next > current : next < current;
    const overshot = forward ? next > target : next < target;
    if (!Number.isFinite(next) || !moved || overshot) throw new Error(`suno_prepare_readback_mismatch: ${name}`);
    current = next;
  }
}

async function setBoolean(page: Page, labels: readonly string[], value: boolean, name: string): Promise<void> {
  const row = rowLocator(page, labels, "boolean");
  const radios = row.locator('[role="radio"], button[aria-pressed], button[aria-checked], button[data-state], button');
  const radioCount = await radios.count().catch(() => 0);
  let locator: Locator | undefined;
  if (radioCount > 0) {
    for (let index = 0; index < radioCount; index += 1) {
      const candidate = radios.nth(index);
      const text = ((await candidate.innerText().catch(() => "")) ?? "").trim().toLowerCase();
      if ((value && /^(on|enabled|yes|true)$/.test(text)) || (!value && /^(off|disabled|no|false)$/.test(text))) {
        locator = candidate;
        break;
      }
    }
  } else {
    locator = await firstControl(page, labels, "boolean");
  }
  if (!locator) throw new Error(`suno_prepare_control_missing: ${name}`);
  const current = await readBoolean(locator);
  if (radioCount === 0 && current === undefined) throw new Error(`suno_prepare_readback_unknown: ${name}`);
  if (current !== value) await locator.click();
  const actual = await readBoolean(locator);
  if (actual !== value) throw new Error(`suno_prepare_readback_mismatch: ${name}`);
}

function parseDurationSeconds(value: string): number | undefined {
  const match = /^(\d+):([0-5]\d)$/.exec(value.trim());
  if (!match) return undefined;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

async function chooseSegment(row: Locator, label: string, name: string): Promise<void> {
  const button = row.getByRole("button", { name: label, exact: true }).first();
  if (!await visible(button)) throw new Error(`suno_prepare_control_missing: ${name}`);
  const className = await button.getAttribute("class").catch(() => null);
  const state = await button.getAttribute("aria-pressed").catch(() => null)
    ?? await button.getAttribute("aria-checked").catch(() => null)
    ?? await button.getAttribute("data-state").catch(() => null);
  if (!["true", "checked", "selected", "on"].includes(state ?? "") && !className?.includes("hxc-btn-variant-standard-legacy")) await button.click();
}

async function setDuration(page: Page, value: string): Promise<void> {
  const row = rowLocator(page, LABELS.duration, "text");
  if (/^auto$/i.test(value.trim())) {
    await chooseSegment(row, "Auto", "duration");
    return;
  }
  const target = parseDurationSeconds(value);
  if (target === undefined) throw new Error("suno_prepare_invalid_control: duration");
  await chooseSegment(row, "Custom", "duration");
  const slider = await firstControl(page, LABELS.duration, "slider");
  if (!slider) throw new Error("suno_prepare_control_missing: duration");
  const min = Number(await slider.getAttribute("aria-valuemin").catch(() => null));
  const max = Number(await slider.getAttribute("aria-valuemax").catch(() => null));
  if (!Number.isFinite(min) || !Number.isFinite(max) || target < min || target > max) throw new Error("suno_prepare_invalid_control: duration");
  await stepSliderTo(slider, target, "duration");
}

async function readControls(page: Page): Promise<SunoPreparedControls> {
  const controls: SunoPreparedControls = {};
  const fields = [
    ["model", LABELS.model, "text"], ["duration", LABELS.duration, "text"],
    ["weirdness", LABELS.weirdness, "slider"], ["styleInfluence", LABELS.styleInfluence, "slider"],
    ["audioInfluence", LABELS.audioInfluence, "slider"], ["variety", LABELS.variety, "slider"],
    ["maxMode", LABELS.maxMode, "boolean"], ["personalize", LABELS.personalize, "boolean"]
  ] as const;
  for (const [key, labels, type] of fields) {
    const locator = type === "boolean"
      ? await firstControl(page, labels, "boolean")
      : type === "slider"
        ? await firstControl(page, labels, "slider")
        : await textControl(page, key as "model" | "duration");
    if (!locator) continue;
    if (type === "boolean") {
      const value = await booleanControlValue(page, labels);
      if (value !== undefined) controls[key] = value;
    } else if (type === "slider") {
      const value = await readNumber(locator);
      if (value !== undefined) controls[key] = value;
    } else {
      const value = await readLocator(locator);
      if (value) controls[key] = value;
    }
  }
  return controls;
}

export async function readSunoControls(page: Page): Promise<SunoPreparedControls> {
  return readControls(page);
}

export async function prepareSunoForm(page: Page, payload: SunoCreatePayload, timeoutMs: number): Promise<SunoPreparedForm> {
  await ensureSunoSongMode(page, timeoutMs);
  const hasSongControlInput = hasString(payload, "songName")
    || hasString(payload, "excludeStyles")
    || ["model", "duration", "weirdness", "styleInfluence", "audioInfluence", "variety", "maxMode", "personalize"]
      .some((key) => payload[key] !== undefined);
  if (hasSongControlInput) await expandControlPanels(page);
  const visibleControls = await readControls(page);
  const requestedControlKeys = ["model", "duration", "weirdness", "styleInfluence", "audioInfluence", "variety", "maxMode", "personalize"];
  const needsAdvanced = requestedControlKeys.some((key) => payload[key] !== undefined && visibleControls[key as keyof SunoPreparedControls] === undefined);
  if (needsAdvanced) {
    const advanced = await resolveFirstVisibleLocator(page, ADVANCED_OPTIONS, timeoutMs, "Advanced Options").catch(() => undefined);
    if (advanced && (await advanced.getAttribute("aria-expanded").catch(() => null)) === "false") await advanced.click();
  }
  const lyrics = payload.instrumental ? undefined : suppliedText(payload, "lyrics", "lyricsText", "payloadYaml");
  const style = suppliedText(payload, "styleAndFeel");
  const title = suppliedText(payload, "songName");
  const hasExclude = hasString(payload, "excludeStyles");
  const excludeStyles = hasExclude ? (payload.excludeStyles as string) : undefined;

  if (lyrics !== undefined) await fillAndVerify(await ensureSunoLyricsMode(page, timeoutMs), lyrics, "lyrics");
  if (style !== undefined) await fillAndVerify(await ensureSunoStyleMode(page, timeoutMs), style, "style");
  if (title !== undefined) {
    const field = await resolveFirstVisibleLocator(page, ['input[placeholder="Song Title (Optional)"]:visible', 'input[placeholder*="Song Title"]:visible'], timeoutMs, "title");
    await fillAndVerify(field, title, "title");
  }
  if (hasExclude) {
    const field = await resolveFirstVisibleLocator(page, ['input[placeholder="Exclude styles"]', 'input[placeholder*="Exclude"]', 'textarea[placeholder*="Exclude" i]'], timeoutMs, "exclude styles");
    await fillAndVerify(field, excludeStyles ?? "", "exclude styles");
  }

  const explicit = (key: string) => controlValue(payload, key);
  if (requestedControlKeys.some((key) => key !== "model" && explicit(key) !== undefined)) await expandControlPanels(page);
  const numeric = [["weirdness", LABELS.weirdness, 0, 100], ["styleInfluence", LABELS.styleInfluence, 0, 100], ["audioInfluence", LABELS.audioInfluence, 0, 100]] as const;
  for (const [key, labels, min, max] of numeric) {
    const value = explicit(key);
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`suno_prepare_invalid_control: ${key}`);
    await setSlider(page, labels, value, key);
  }
  const variety = explicit("variety");
  if (variety !== undefined) {
    if (typeof variety !== "number" || !Number.isInteger(variety) || variety < 0 || variety > 4) throw new Error("suno_prepare_invalid_control: variety");
    await setSlider(page, LABELS.variety, variety, "variety");
  }
  for (const [key, labels] of [["maxMode", LABELS.maxMode], ["personalize", LABELS.personalize]] as const) {
    const value = explicit(key);
    if (value !== undefined) {
      if (typeof value !== "boolean") throw new Error(`suno_prepare_invalid_control: ${key}`);
      await setBoolean(page, labels, value, key);
    }
  }
  for (const key of ["model", "duration"] as const) {
    const value = explicit(key);
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.trim()) throw new Error(`suno_prepare_invalid_control: ${key}`);
    if (key === "duration") await setDuration(page, value);
    else {
      const locator = await textControl(page, key);
      if (!locator) throw new Error(`suno_prepare_control_missing: ${key}`);
      await chooseTextControl(page, locator, value, key);
    }
  }
  // Re-read all supplied fields after controls: Suno can remount the composer when
  // model/advanced settings change and silently reset an earlier field.
  await ensureSunoSongMode(page, timeoutMs);
  const finalLyrics = lyrics === undefined ? undefined : await readLocator(await ensureSunoLyricsMode(page, timeoutMs));
  const finalStyle = style === undefined ? undefined : await readLocator(await ensureSunoStyleMode(page, timeoutMs));
  const finalTitle = title === undefined ? undefined : await readLocator(await resolveFirstVisibleLocator(page, ['input[placeholder="Song Title (Optional)"]:visible', 'input[placeholder*="Song Title"]:visible'], timeoutMs, "title"));
  const finalExclude = !hasExclude ? undefined : await readLocator(await resolveFirstVisibleLocator(page, ['input[placeholder="Exclude styles"]', 'input[placeholder*="Exclude"]', 'textarea[placeholder*="Exclude" i]'], timeoutMs, "exclude styles"));
  if (lyrics !== undefined && finalLyrics !== lyrics) throw new Error("suno_prepare_readback_mismatch: lyrics");
  if (style !== undefined && finalStyle !== style) throw new Error("suno_prepare_readback_mismatch: style");
  if (title !== undefined && finalTitle !== title) throw new Error("suno_prepare_readback_mismatch: title");
  if (hasExclude && finalExclude !== excludeStyles) throw new Error("suno_prepare_readback_mismatch: exclude styles");
  const after = await readControls(page);
  return { title: finalTitle, lyrics: finalLyrics, style: finalStyle, excludeStyles: finalExclude, controls: after };
}

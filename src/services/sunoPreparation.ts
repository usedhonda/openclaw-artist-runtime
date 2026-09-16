import type { Locator, Page } from "playwright";
import type { SunoCreatePayload } from "../types.js";
import { ensureSunoLyricsMode, ensureSunoStyleMode, resolveFirstVisibleLocator } from "./sunoCreateForm.js";

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
  const target = kind === "slider"
    ? './/*[@role="slider" or self::input[@type="range"]]'
    : kind === "boolean"
      ? './/*[@role="switch" or @role="radio" or @aria-pressed or @aria-checked or @data-state or self::input[@type="checkbox"]]'
      : './/input or .//select or .//button';
  return page.locator(
    `xpath=(//*[self::label or self::span or self::div][${label}]/ancestor::*[${target}][1])`
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
      ? ['[role="switch"]', '[role="radio"]', 'input[type="checkbox"]', 'button[aria-pressed]', '[data-state]']
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
  const isChecked = (locator as Locator & { isChecked?: () => Promise<boolean> }).isChecked;
  const checked = typeof isChecked === "function" ? await isChecked.call(locator).catch(() => undefined) : undefined;
  if (checked !== undefined) return checked;
  const ariaChecked = await locator.getAttribute("aria-checked").catch(() => null);
  if (ariaChecked === "true" || ariaChecked === "false") return ariaChecked === "true";
  const pressed = await locator.getAttribute("aria-pressed").catch(() => null);
  if (pressed === "true" || pressed === "false") return pressed === "true";
  const dataState = await locator.getAttribute("data-state").catch(() => null);
  if (dataState === "on" || dataState === "true" || dataState === "checked" || dataState === "selected") return true;
  if (dataState === "off" || dataState === "false" || dataState === "unchecked" || dataState === "unselected") return false;
  return undefined;
}

async function readNumber(locator: Locator): Promise<number | undefined> {
  const value = Number(await readLocator(locator));
  return Number.isFinite(value) ? value : undefined;
}

async function textControl(page: Page, key: "model" | "duration"): Promise<Locator | undefined> {
  const byLabel = await firstControl(page, LABELS[key], "text");
  if (byLabel) return byLabel;
  const getByRole = (page as Page & { getByRole?: Page["getByRole"] }).getByRole;
  if (typeof getByRole !== "function") return undefined;
  const pattern = key === "model" ? /^v[0-9]+(?:\.[0-9]+)?$/i : /^(?:Auto|Custom)$/i;
  const candidate = getByRole.call(page, "button", { name: pattern }).first();
  return (await visible(candidate)) ? candidate : undefined;
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
  const min = Number((await locator.getAttribute("min").catch(() => null)) ?? "0");
  const max = Number((await locator.getAttribute("max").catch(() => null)) ?? (name === "variety" ? "4" : "100"));
  const step = Number((await locator.getAttribute("step").catch(() => null)) ?? "1");
  if (![min, max, step].every(Number.isFinite) || step <= 0 || value < min || value > max || !Number.isInteger((value - min) / step)) {
    throw new Error(`suno_prepare_invalid_control: ${name}`);
  }
  await locator.press("Home");
  for (let index = 0; index < (value - min) / step; index += 1) await locator.press("ArrowRight");
  const actual = Number(await locator.getAttribute("aria-valuenow").catch(() => null) ?? await locator.inputValue().catch(() => ""));
  if (actual !== value) throw new Error(`suno_prepare_readback_mismatch: ${name}`);
}

async function setBoolean(page: Page, labels: readonly string[], value: boolean, name: string): Promise<void> {
  const locator = await firstControl(page, labels, "boolean");
  if (!locator) throw new Error(`suno_prepare_control_missing: ${name}`);
  const current = await readBoolean(locator);
  if (current === undefined) throw new Error(`suno_prepare_readback_unknown: ${name}`);
  if (current !== value) await locator.click();
  const actual = await readBoolean(locator);
  if (actual !== value) throw new Error(`suno_prepare_readback_mismatch: ${name}`);
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
      const value = await readBoolean(locator);
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
  const advanced = await resolveFirstVisibleLocator(page, ADVANCED_OPTIONS, timeoutMs, "Advanced Options").catch(() => undefined);
  if (advanced && (await advanced.getAttribute("aria-expanded").catch(() => null)) !== "true") await advanced.click();

  await readControls(page);
  const lyrics = suppliedText(payload, "lyrics", "lyricsText", "payloadYaml");
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
    const field = await resolveFirstVisibleLocator(page, ['input[placeholder="Exclude styles"]', 'input[placeholder*="Exclude"]'], timeoutMs, "exclude styles");
    await fillAndVerify(field, excludeStyles ?? "", "exclude styles");
  }

  const explicit = (key: string) => controlValue(payload, key);
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
    const locator = await textControl(page, key);
    if (!locator) throw new Error(`suno_prepare_control_missing: ${key}`);
    await chooseTextControl(page, locator, value, key);
  }
  // Re-read all supplied fields after controls: Suno can remount the composer when
  // model/advanced settings change and silently reset an earlier field.
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

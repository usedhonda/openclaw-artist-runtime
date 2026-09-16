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
  'button[aria-label*="Advanced Options" i]',
  'button:has-text("Advanced")'
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

function rowLocator(page: Page, labels: readonly string[]): Locator {
  const label = labels.map((value) => `normalize-space(.)=${JSON.stringify(value)}`).join(" or ");
  // The nearest ancestor containing an actual form control prevents a similarly named
  // recommendation/card elsewhere on the page from becoming the target.
  return page.locator(
    `xpath=(//*[self::label or self::span or self::div][${label}]/ancestor::*[.//input or .//select or .//button][1])`
  ).first();
}

async function visible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function firstControl(page: Page, labels: readonly string[], kind: "input" | "button" | "select"): Promise<Locator | undefined> {
  const row = rowLocator(page, labels);
  const candidates = [row.locator(kind).first(), row.locator(`[role="${kind === "input" ? "textbox" : kind}"]`).first()];
  for (const candidate of candidates) if (await visible(candidate)) return candidate;
  return undefined;
}

async function readLocator(locator: Locator): Promise<string> {
  const value = await locator.inputValue().catch(() => undefined);
  if (typeof value === "string") return value;
  return (await locator.textContent().catch(() => ""))?.trim() ?? "";
}

async function readBoolean(locator: Locator): Promise<boolean | undefined> {
  const isChecked = (locator as Locator & { isChecked?: () => Promise<boolean> }).isChecked;
  const checked = typeof isChecked === "function" ? await isChecked.call(locator).catch(() => undefined) : undefined;
  if (checked !== undefined) return checked;
  const ariaChecked = await locator.getAttribute("aria-checked").catch(() => null);
  if (ariaChecked === "true" || ariaChecked === "false") return ariaChecked === "true";
  const pressed = await locator.getAttribute("aria-pressed").catch(() => null);
  if (pressed === "true" || pressed === "false") return pressed === "true";
  const value = await locator.getAttribute("value").catch(() => null);
  if (value === "true" || value === "false") return value === "true";
  const text = ((await locator.textContent().catch(() => "")) ?? "").trim().toLowerCase();
  if (/^(on|enabled|yes|true)$/.test(text)) return true;
  if (/^(off|disabled|no|false)$/.test(text)) return false;
  return undefined;
}

async function readNumber(locator: Locator): Promise<number | undefined> {
  const value = Number(await readLocator(locator));
  return Number.isFinite(value) ? value : undefined;
}

async function requiredControl(page: Page, labels: readonly string[], name: string): Promise<Locator> {
  const locator = await firstControl(page, labels, "input") ?? await firstControl(page, labels, "select") ?? await firstControl(page, labels, "button");
  if (!locator) throw new Error(`suno_prepare_control_missing: ${name}`);
  return locator;
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

async function setSlider(page: Page, labels: readonly string[], value: number, name: string): Promise<void> {
  const locator = await requiredControl(page, labels, name);
  await fillAndVerify(locator, String(value), name);
}

async function setBoolean(page: Page, labels: readonly string[], value: boolean, name: string): Promise<void> {
  const locator = await requiredControl(page, labels, name);
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
    ["weirdness", LABELS.weirdness, "number"], ["styleInfluence", LABELS.styleInfluence, "number"],
    ["audioInfluence", LABELS.audioInfluence, "number"], ["variety", LABELS.variety, "number"],
    ["maxMode", LABELS.maxMode, "boolean"], ["personalize", LABELS.personalize, "boolean"]
  ] as const;
  for (const [key, labels, type] of fields) {
    const locator = await firstControl(page, labels, type === "boolean" ? "button" : "input")
      ?? (type === "boolean" ? await firstControl(page, labels, "input") : undefined)
      ?? await firstControl(page, labels, "select");
    if (!locator) continue;
    if (type === "boolean") {
      const value = await readBoolean(locator);
      if (value !== undefined) controls[key] = value;
    } else if (type === "number") {
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
    await fillAndVerify(await requiredControl(page, LABELS[key], key), value, key);
  }
  const after = await readControls(page);
  return { title, lyrics, style, excludeStyles, controls: after };
}

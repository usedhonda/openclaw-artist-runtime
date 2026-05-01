import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURE_PATH = join(process.cwd(), "tests", "fixtures", "suno-create-page.html");
const DRIVER_PATH = join(process.cwd(), "src", "services", "sunoPlaywrightDriver.ts");

const TITLE_SELECTOR = 'input[placeholder="Song Title (Optional)"]:visible';
const LYRICS_SELECTOR = 'textarea[data-testid="lyrics-textarea"]';
const LYRICS_TOGGLE_SELECTOR = 'button[aria-label="Add your own lyrics"]';
const STYLE_SELECTOR =
  '[data-testid="create-form-styles-wrapper"] textarea, textarea[placeholder="Describe the sound you want"], textarea[placeholder*="クラシック音楽"], textarea[placeholder*="バイキングメタル"], textarea[placeholder*="sound you want"]';
const EXCLUDE_SELECTOR = 'input[placeholder="Exclude styles"]';
const INSTRUMENTAL_SELECTOR = 'button[aria-label="Check this to generate an instrumental only song"]';
const CREATE_BUTTON_SELECTOR = 'button[aria-label="Create song"]';
const COMPLETE_TITLE_CLIP_SELECTOR =
  '[data-testid="clip-row"][data-clip-status="complete"][aria-label="Watapp Groups"] a[href*="/song/"]';

interface FixtureNode {
  tag: string;
  attrs: Record<string, string>;
  children: FixtureNode[];
  parent?: FixtureNode;
}

function parseFixtureHtml(html: string): FixtureNode {
  const root: FixtureNode = { tag: "document", attrs: {}, children: [] };
  const stack = [root];
  const tagPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    const token = match[0];
    const tag = match[1]?.toLowerCase();
    if (!tag || token.startsWith("<!") || token.startsWith("<!--")) {
      continue;
    }
    if (token.startsWith("</")) {
      while (stack.length > 1 && stack[stack.length - 1].tag !== tag) {
        stack.pop();
      }
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }

    const parent = stack[stack.length - 1];
    const node: FixtureNode = { tag, attrs: parseAttrs(match[2] ?? ""), children: [], parent };
    parent.children.push(node);

    if (!token.endsWith("/>") && !["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(tag)) {
      stack.push(node);
    }
  }

  return root;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(raw)) !== null) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function queryAll(root: FixtureNode, selector: string): FixtureNode[] {
  const selectors = splitSelectorList(selector).map((part) => part.replaceAll(":visible", "").trim());
  const matches = new Set<FixtureNode>();
  for (const part of selectors) {
    const compounds = splitDescendantSelector(part);
    for (const node of flatten(root)) {
      if (matchesSelectorChain(node, compounds)) {
        matches.add(node);
      }
    }
  }
  return [...matches];
}

function splitSelectorList(selector: string): string[] {
  return splitOutsideQuotes(selector, ",");
}

function splitDescendantSelector(selector: string): string[] {
  return splitOutsideQuotes(selector, " ").filter(Boolean);
}

function splitOutsideQuotes(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  for (const char of value) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
    } else if (char === quote) {
      quote = undefined;
    }

    if (char === delimiter && !quote) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function flatten(root: FixtureNode): FixtureNode[] {
  return root.children.flatMap((child) => [child, ...flatten(child)]);
}

function matchesSelectorChain(node: FixtureNode, compounds: string[]): boolean {
  if (compounds.length === 0 || !matchesCompound(node, compounds[compounds.length - 1])) {
    return false;
  }

  let ancestor = node.parent;
  for (let index = compounds.length - 2; index >= 0; index -= 1) {
    while (ancestor && !matchesCompound(ancestor, compounds[index])) {
      ancestor = ancestor.parent;
    }
    if (!ancestor) {
      return false;
    }
    ancestor = ancestor.parent;
  }

  return true;
}

function matchesCompound(node: FixtureNode, compound: string): boolean {
  const tag = compound.startsWith("[") ? undefined : compound.split("[")[0].toLowerCase();
  if (tag && node.tag !== tag) {
    return false;
  }

  const attrPattern = /\[([:\w-]+)(\*?=)(?:"([^"]*)"|'([^']*)')\]/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(compound)) !== null) {
    const actual = node.attrs[match[1]];
    const expected = match[3] ?? match[4] ?? "";
    if (actual === undefined) {
      return false;
    }
    if (match[2] === "=" && actual !== expected) {
      return false;
    }
    if (match[2] === "*=" && !actual.includes(expected)) {
      return false;
    }
  }

  return true;
}

function hrefs(nodes: FixtureNode[]): string[] {
  return nodes.map((node) => node.attrs.href).filter((href): href is string => Boolean(href));
}

describe("Suno create selector regression fixture", () => {
  const html = readFileSync(FIXTURE_PATH, "utf8");
  const fixture = parseFixtureHtml(html);

  it("keeps current create-form selectors reachable without a browser", () => {
    expect(queryAll(fixture, TITLE_SELECTOR)).toHaveLength(1);
    expect(queryAll(fixture, LYRICS_SELECTOR)).toHaveLength(1);
    expect(queryAll(fixture, LYRICS_TOGGLE_SELECTOR)).toHaveLength(1);
    expect(queryAll(fixture, STYLE_SELECTOR).length).toBeGreaterThan(0);
    expect(queryAll(fixture, EXCLUDE_SELECTOR)).toHaveLength(1);
    expect(queryAll(fixture, INSTRUMENTAL_SELECTOR)).toHaveLength(1);
    expect(queryAll(fixture, CREATE_BUTTON_SELECTOR)).toHaveLength(1);
  });

  it("documents textarea and input variants for style and exclude fields", () => {
    expect(queryAll(fixture, '[data-testid="create-form-styles-wrapper"] textarea')).toHaveLength(1);
    expect(queryAll(fixture, '[data-testid="create-form-styles-wrapper"] input')).toHaveLength(1);
    expect(queryAll(fixture, 'input[placeholder="Exclude styles"]')).toHaveLength(1);
    expect(queryAll(fixture, 'textarea[placeholder="Exclude styles"]')).toHaveLength(1);
  });

  it("matches only completed title-specific clip rows for post-submit pickup", () => {
    expect(hrefs(queryAll(fixture, COMPLETE_TITLE_CLIP_SELECTOR))).toEqual([
      "https://suno.com/song/watapp-groups-a"
    ]);
    expect(hrefs(queryAll(fixture, '[data-testid="clip-row"][data-clip-status="generating"] a[href*="/song/"]'))).toEqual([
      "https://suno.com/song/still-generating"
    ]);
  });

  it("pins the fixture selectors to the current Playwright driver source", () => {
    const driverSource = readFileSync(DRIVER_PATH, "utf8");

    for (const selector of [
      TITLE_SELECTOR,
      LYRICS_SELECTOR,
      LYRICS_TOGGLE_SELECTOR,
      STYLE_SELECTOR,
      EXCLUDE_SELECTOR,
      INSTRUMENTAL_SELECTOR,
      CREATE_BUTTON_SELECTOR
    ]) {
      expect(driverSource).toContain(selector);
    }

    expect(driverSource).toContain('[data-testid="clip-row"][data-clip-status="complete"]');
    expect(driverSource).toContain("a[href*='/song/']");
  });
});

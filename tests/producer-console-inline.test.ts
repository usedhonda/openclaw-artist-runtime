import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { producerConsoleHtml } from "../src/routes/index.js";

function makeFakeProjectRoot(jsContent: string, cssContent = "/* css */"): string {
  const root = mkdtempSync(join(tmpdir(), "producer-console-inline-"));
  const distDir = join(root, "ui", "dist", "assets");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, "main.js"), jsContent, "utf8");
  writeFileSync(join(distDir, "main.css"), cssContent, "utf8");
  const distHtml = `<!doctype html><html><head><link rel="stylesheet" href="/assets/main.css"></head><body><div id="root"></div><script type="module" src="/assets/main.js"></script></body></html>`;
  writeFileSync(join(root, "ui", "dist", "index.html"), distHtml, "utf8");
  // Source files older than dist so uiBuildIsFresh returns true.
  const srcDir = join(root, "ui", "src");
  mkdirSync(srcDir, { recursive: true });
  const past = new Date(Date.now() - 60_000);
  for (const name of ["App.tsx", "main.tsx", "styles.css"]) {
    const path = join(srcDir, name);
    writeFileSync(path, "", "utf8");
    utimesSync(path, past, past);
  }
  for (const name of ["index.html", "package.json", "vite.config.ts"]) {
    const path = join(root, "ui", name);
    writeFileSync(path, "", "utf8");
    utimesSync(path, past, past);
  }
  return root;
}

describe("producerConsoleHtml inlining", () => {
  it("preserves $& and other replace specials in the JS bundle", async () => {
    const jsWithSpecials = "const a = 1; const result = b $& c; const d = 2;";
    const root = makeFakeProjectRoot(jsWithSpecials);
    const html = await producerConsoleHtml(root);
    expect(html).toContain(jsWithSpecials);
    expect(html).not.toContain("</body>$&");
  });

  it("does not corrupt $&& patterns into </body>& during inlining", async () => {
    const jsWithDoubleAmp = "const x = $ && setNext();";
    const root = makeFakeProjectRoot(jsWithDoubleAmp);
    const html = await producerConsoleHtml(root);
    expect(html).toContain(jsWithDoubleAmp);
    expect(html).not.toContain("</body>&&");
  });

  it("inlines CSS without corrupting $1 backreferences in stylesheet content", async () => {
    const jsContent = "console.log('test');";
    const cssWithSpecials = ".a { content: '$1$2'; }";
    const root = makeFakeProjectRoot(jsContent, cssWithSpecials);
    const html = await producerConsoleHtml(root);
    expect(html).toContain(cssWithSpecials);
  });
});

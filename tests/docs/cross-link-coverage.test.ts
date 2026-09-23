import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function topLevelMarkdownDocs(): string[] {
  return [
    "README.md",
    ...readdirSync(join(repoRoot, "docs"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => join("docs", name))
  ].sort();
}

function markdownLinks(contents: string): Array<{ raw: string; target: string }> {
  const links: Array<{ raw: string; target: string }> = [];
  const pattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of contents.matchAll(pattern)) {
    links.push({ raw: match[0], target: match[1] ?? "" });
  }
  return links;
}

function splitTarget(target: string): { pathPart: string; anchor?: string } {
  const [pathPart, anchor] = target.split("#");
  return { pathPart: decodeURIComponent(pathPart ?? ""), anchor: anchor ? decodeURIComponent(anchor) : undefined };
}

function shouldCheck(target: string): boolean {
  if (!target || target.startsWith("#")) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return false;
  }
  return splitTarget(target).pathPart.endsWith(".md");
}

function resolveMarkdownTarget(sourceRelativePath: string, targetPath: string): string | undefined {
  const sourceDir = dirname(join(repoRoot, sourceRelativePath));
  const candidates = [
    resolve(sourceDir, targetPath),
    resolve(repoRoot, targetPath)
  ];

  if (targetPath.startsWith("docs/")) {
    candidates.unshift(resolve(repoRoot, targetPath));
  }

  return candidates.find((candidate) => existsSync(candidate));
}

function slugifyHeading(heading: string): string {
  return heading
    .trim()
    .replace(/#+\s*$/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z0-9#]+;/g, "")
    .replace(/[^a-z0-9_\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function anchorsFor(contents: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of contents.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading?.[2]) {
      anchors.add(slugifyHeading(heading[2]));
    }
    const htmlAnchor = line.match(/<a\s+[^>]*id=["']([^"']+)["']/i);
    if (htmlAnchor?.[1]) {
      anchors.add(htmlAnchor[1]);
    }
  }
  return anchors;
}

describe("docs cross-link coverage", () => {
  it("keeps top-level local markdown links and anchors valid", () => {
    const failures: string[] = [];

    for (const sourceRelativePath of topLevelMarkdownDocs()) {
      const contents = readFileSync(join(repoRoot, sourceRelativePath), "utf8");
      for (const link of markdownLinks(contents)) {
        if (!shouldCheck(link.target)) {
          continue;
        }
        const { pathPart, anchor } = splitTarget(link.target);
        const target = resolveMarkdownTarget(sourceRelativePath, pathPart);
        if (!target) {
          failures.push(`${sourceRelativePath}: missing target for ${link.raw}`);
          continue;
        }
        if (!anchor) {
          continue;
        }
        const targetContents = readFileSync(target, "utf8");
        const anchors = anchorsFor(targetContents);
        if (!anchors.has(anchor)) {
          failures.push(`${sourceRelativePath}: missing anchor #${anchor} in ${normalize(target).replace(`${repoRoot}/`, "")}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps Round 83 operator docs discoverable from each other", () => {
    const quickstart = readFileSync(join(repoRoot, "docs/OPERATOR_QUICKSTART.md"), "utf8");
    const troubleshooting = readFileSync(join(repoRoot, "docs/TROUBLESHOOTING.md"), "utf8");

    for (const required of ["TROUBLESHOOTING.md", "ERRORS.md", "API_ROUTES.md", "CONNECTOR_AUTH.md", "SUNO_BROWSER_DRIVER.md", "OPERATOR_RUNBOOK.md"]) {
      expect(quickstart).toContain(required);
    }
    for (const required of ["OPERATOR_QUICKSTART.md", "ERRORS.md", "API_ROUTES.md", "CONNECTOR_AUTH.md", "SUNO_BROWSER_DRIVER.md", "OPERATOR_RUNBOOK.md"]) {
      expect(troubleshooting).toContain(required);
    }
  });
});

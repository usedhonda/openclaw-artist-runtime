import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { errorRunbookMap, runbookHref } from "../ui/src/errorRunbookMap";

function anchorFromHref(href: string): string {
  return href.split("#")[1] ?? "";
}

describe("error runbook map", () => {
  it("links mapped reason codes to headings that exist in ERRORS.md", () => {
    const docs = readFileSync("docs/ERRORS.md", "utf8");

    for (const href of Object.values(errorRunbookMap)) {
      const anchor = anchorFromHref(href);
      expect(anchor).toBeTruthy();
      expect(docs).toMatch(new RegExp(`^### ${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    }
  });

  it("returns undefined for unmapped reason codes", () => {
    expect(runbookHref("unknown_reason_code")).toBeUndefined();
  });
});

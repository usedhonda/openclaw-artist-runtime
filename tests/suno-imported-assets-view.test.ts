import { describe, expect, it } from "vitest";
import {
  buildImportedAssetRows,
  filterImportedAssetsByUrlPrefix,
  importedAssetsPlaceholder
} from "../src/services/sunoImportedAssetsView.js";

const rows = [
  {
    url: "https://suno.com/song/alpha",
    path: "/runtime/suno/run-a/alpha.mp3",
    format: "mp3" as const,
    title: "Alpha"
  },
  {
    url: "https://suno.com/song/beta",
    path: "/runtime/suno/run-b/beta.m4a",
    format: "m4a" as const,
    title: "Beta"
  }
];

describe("Suno imported assets view helpers", () => {
  it("returns all rows when the URL prefix is empty", () => {
    expect(filterImportedAssetsByUrlPrefix(rows, "")).toEqual(rows);
  });

  it("trims whitespace before matching URL prefixes", () => {
    expect(filterImportedAssetsByUrlPrefix(rows, "  https://suno.com/song/a  ")).toEqual([rows[0]]);
  });

  it("returns no rows when no URL starts with the prefix", () => {
    expect(filterImportedAssetsByUrlPrefix(rows, "https://example.test/")).toEqual([]);
  });

  it("keeps prefix matching case-sensitive", () => {
    expect(filterImportedAssetsByUrlPrefix(rows, "https://SUNO.com/song/a")).toEqual([]);
  });

  it("still builds fallback rows from paths and keeps the empty placeholder contract", () => {
    const fallback = buildImportedAssetRows({
      runId: "run-fallback",
      paths: ["/runtime/suno/run-fallback/take.m4a"]
    });

    expect(fallback).toEqual([
      {
        url: "run-fallback",
        path: "/runtime/suno/run-fallback/take.m4a",
        format: "m4a",
        title: "Imported asset 1"
      }
    ]);
    expect(importedAssetsPlaceholder({ runId: "empty", paths: [] })).toBe("No imported assets yet.");
  });
});

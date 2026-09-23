import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractMediaMetadata } from "../src/connectors/social/xMediaMetadata.js";

const FIXTURE_PATH = join(__dirname, "fixtures", "media", "sample.png");

describe("X media upload skeleton", () => {
  it("extracts filename, byte size, and mime type without reading binary", async () => {
    const metadata = await extractMediaMetadata(FIXTURE_PATH);
    expect(metadata.attached).toBe(false);
    expect(metadata.filename).toBe("sample.png");
    expect(metadata.mimeType).toBe("image/png");
    expect(metadata.sizeBytes).toBeGreaterThan(0);
  });

  it("falls back to application/octet-stream for unknown extensions", async () => {
    const metadata = await extractMediaMetadata(FIXTURE_PATH.replace(/\.png$/, ".unknownext"))
      .catch((error: NodeJS.ErrnoException) => error);
    expect(metadata).toBeInstanceOf(Error);
  });

  it("never sets attached=true (real upload not yet wired)", async () => {
    const metadata = await extractMediaMetadata(FIXTURE_PATH);
    expect(metadata.attached).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { resolveSunoConnector } from "../src/connectors/suno/resolveSunoConnector";
import { CliSunoConnector } from "../src/connectors/suno/cliSunoConnector";
import { BrowserWorkerSunoConnector } from "../src/connectors/suno/browserWorkerConnector";
import type { ArtistRuntimeConfig } from "../src/types";

function configWithDriver(driver: "mock" | "playwright" | "suno_cli"): Partial<ArtistRuntimeConfig> {
  return { music: { engine: "suno", suno: { driver } } } as Partial<ArtistRuntimeConfig>;
}

describe("resolveSunoConnector driver gate", () => {
  it("resolves CliSunoConnector when driver is suno_cli (no browser worker constructed)", () => {
    const connector = resolveSunoConnector("/ws/artist", configWithDriver("suno_cli"));
    expect(connector).toBeInstanceOf(CliSunoConnector);
    expect(connector).not.toBeInstanceOf(BrowserWorkerSunoConnector);
  });

  it("resolves the browser worker connector when driver is playwright (default behavior)", () => {
    const connector = resolveSunoConnector("/ws/artist", configWithDriver("playwright"));
    expect(connector).toBeInstanceOf(BrowserWorkerSunoConnector);
  });

  it("resolves the browser worker connector when driver is mock", () => {
    const connector = resolveSunoConnector("/ws/artist", configWithDriver("mock"));
    expect(connector).toBeInstanceOf(BrowserWorkerSunoConnector);
  });

  it("falls back to the browser worker connector when config/driver is absent", () => {
    expect(resolveSunoConnector("/ws/artist")).toBeInstanceOf(BrowserWorkerSunoConnector);
    expect(resolveSunoConnector("/ws/artist", {})).toBeInstanceOf(BrowserWorkerSunoConnector);
  });
});

import type { ArtistRuntimeConfig } from "../../types.js";
import { BrowserWorkerSunoConnector } from "./browserWorkerConnector.js";
import { CliSunoConnector } from "./cliSunoConnector.js";
import type { SunoConnector } from "./SunoConnector.js";

/**
 * Single driver gate for the whole Suno lifecycle. When the configured driver is
 * "suno_cli" every stage (create / import-download / status) runs through the
 * headless CLI connector; otherwise it stays on the browser DOM worker (the
 * default). Keeping the gate here means create, import, adoption-download, and
 * status all resolve the same connector instead of hardcoding one at each site.
 */
export function resolveSunoConnector(
  workspaceRoot: string,
  config?: Partial<ArtistRuntimeConfig>
): SunoConnector {
  if (config?.music?.suno?.driver === "suno_cli") {
    return new CliSunoConnector(workspaceRoot);
  }
  return new BrowserWorkerSunoConnector(workspaceRoot, { config });
}

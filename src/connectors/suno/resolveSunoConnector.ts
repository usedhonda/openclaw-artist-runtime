import type { ArtistRuntimeConfig } from "../../types.js";
import { BrowserWorkerSunoConnector } from "./browserWorkerConnector.js";
import { CliSunoConnector } from "./cliSunoConnector.js";
import { createHumanAssistSunoConnector } from "./humanAssistSunoConnector.js";
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
    const cli = new CliSunoConnector(workspaceRoot, { config });
    // Human assist supports both captcha fallback and explicit manual submit.
    // Manual mode bypasses CLI submission, fills the visible form, and waits for
    // the producer to adjust parameters and press Create.
    if (config?.music?.suno?.captchaFallback === "human_click" || config?.music?.suno?.submitMode === "manual") {
      return createHumanAssistSunoConnector(cli, config, workspaceRoot);
    }
    return cli;
  }
  return new BrowserWorkerSunoConnector(workspaceRoot, { config });
}

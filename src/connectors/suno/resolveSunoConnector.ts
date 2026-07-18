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
    const cli = new CliSunoConnector(workspaceRoot);
    // Opt-in captcha human-assist: on a captcha-blocked live create, hand off to the
    // producer for a manual Create click instead of hard-stopping. The captcha is never
    // auto-solved -- the fallback only closes the challenge and waits for a human click.
    if (config?.music?.suno?.captchaFallback === "human_click") {
      return createHumanAssistSunoConnector(cli, config);
    }
    return cli;
  }
  return new BrowserWorkerSunoConnector(workspaceRoot, { config });
}

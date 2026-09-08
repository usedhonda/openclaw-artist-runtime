import { registerSongTools } from "./songTools.js";
import { registerSunoTools } from "./sunoTools.js";
import { registerSocialTools } from "./socialTools.js";
import { registerRevisionTools } from "./revisionTools.js";
import { registerProductionTools } from "./productionTools.js";

export function registerTools(api: unknown): void {
  registerSongTools(api);
  registerSunoTools(api);
  registerSocialTools(api);
  registerRevisionTools(api);
  registerProductionTools(api);
}

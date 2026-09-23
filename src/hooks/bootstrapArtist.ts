import { bootstrapArtistContext as loadArtistContext } from "../services/artistWorkspace.js";

export async function bootstrapArtistContext(workspaceRoot = "."): Promise<string> {
  return loadArtistContext(workspaceRoot);
}

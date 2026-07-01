import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { writeDerivedIdentityProjection } from "./personaIdentityProjection.js";
import { readResolvedConfig } from "./runtimeConfig.js";

const defaultTemplateRoot = fileURLToPath(new URL("../../workspace-template/", import.meta.url));

export interface WorkspaceBootstrapResult {
  created: string[];
  skipped: string[];
}

async function copyDirectory(sourceRoot: string, targetRoot: string, destinationRoot: string, result: WorkspaceBootstrapResult): Promise<void> {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);

    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyDirectory(sourcePath, targetPath, destinationRoot, result);
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    try {
      await access(targetPath, constants.F_OK);
      result.skipped.push(relative(destinationRoot, targetPath));
    } catch {
      await copyFile(sourcePath, targetPath);
      result.created.push(relative(destinationRoot, targetPath));
    }
  }
}

export async function ensureArtistWorkspace(root: string, templateRoot = defaultTemplateRoot): Promise<WorkspaceBootstrapResult> {
  await mkdir(root, { recursive: true });
  const result: WorkspaceBootstrapResult = { created: [], skipped: [] };
  await copyDirectory(templateRoot, root, root, result);
  const config = await readResolvedConfig(root);
  const identity = await writeDerivedIdentityProjection(root, config, "workspace_bootstrap_identity_projection");
  if (identity.overwritten && !result.created.includes("IDENTITY.md")) {
    result.skipped = result.skipped.filter((path) => path !== "IDENTITY.md");
    result.created.push("IDENTITY.md");
  }
  return result;
}

export async function bootstrapArtistContext(root: string): Promise<string> {
  const paths = [
    "ARTIST.md",
    "artist/CURRENT_STATE.md",
    "artist/SONGBOOK.md",
    "artist/SOCIAL_VOICE.md"
  ];

  const sections = await Promise.all(
    paths.map(async (path) => {
      const fullPath = join(root, path);
      try {
        const file = await readFile(fullPath, "utf8");
        return `## ${path}\n\n${file.trim()}`;
      } catch {
        return `## ${path}\n\nMissing.`;
      }
    })
  );

  return sections.join("\n\n");
}

export async function workspaceExists(root: string): Promise<boolean> {
  try {
    const stats = await stat(root);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export async function readArtistSnapshots(root: string): Promise<{ artistSnapshot: string; currentStateSnapshot: string }> {
  const [artistSnapshot, currentStateSnapshot] = await Promise.all([
    readFile(join(root, "ARTIST.md"), "utf8").catch(() => ""),
    readFile(join(root, "artist", "CURRENT_STATE.md"), "utf8").catch(() => "")
  ]);

  return { artistSnapshot, currentStateSnapshot };
}

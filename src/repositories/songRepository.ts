import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SongSkeletonResult {
  basePath: string;
  createdPaths: string[];
}

async function writeIfMissing(path: string, contents: string): Promise<boolean> {
  try {
    await writeFile(path, contents, { flag: "wx" });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("EEXIST")) {
      return false;
    }
    throw error;
  }
}

export async function createSongSkeleton(root: string, songId: string): Promise<SongSkeletonResult> {
  const basePath = join(root, "songs", songId);
  const createdPaths: string[] = [];
  const directories = ["lyrics", "suno", "prompts", "assets", "social", "audit"];

  for (const directory of directories) {
    const fullPath = join(basePath, directory);
    await mkdir(fullPath, { recursive: true });
    createdPaths.push(fullPath);
  }

  if (await writeIfMissing(join(basePath, "song.md"), `# ${songId}\n\nStatus: drafting\n`)) {
    createdPaths.push(join(basePath, "song.md"));
  }
  if (await writeIfMissing(join(basePath, "brief.md"), `# Brief for ${songId}\n\nPending artist brief.\n`)) {
    createdPaths.push(join(basePath, "brief.md"));
  }

  return { basePath, createdPaths };
}

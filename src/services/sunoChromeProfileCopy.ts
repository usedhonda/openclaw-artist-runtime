import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const SUNO_PROFILE_COPY_ITEMS = [
  "Cookies",
  "Network",
  "Local Storage",
  "Session Storage",
  "IndexedDB",
  "Preferences",
  "Secure Preferences",
  "Login Data",
  "Web Data"
] as const;

export interface SunoChromeProfileCopyResult {
  status: "copied" | "skipped" | "source_missing";
  copied: string[];
  failed: string[];
}

async function hasExistingProfile(path: string): Promise<boolean> {
  const entries = await readdir(join(path, "Default")).catch(() => []);
  return entries.length > 0;
}

export async function ensureSunoChromeProfileCopy(sourceProfile: string, destProfile: string): Promise<SunoChromeProfileCopyResult> {
  if (await hasExistingProfile(destProfile)) {
    return { status: "skipped", copied: [], failed: [] };
  }
  const source = await stat(sourceProfile).catch(() => undefined);
  if (!source?.isDirectory()) {
    return { status: "source_missing", copied: [], failed: [] };
  }
  const destDefault = join(destProfile, "Default");
  await mkdir(destDefault, { recursive: true });
  const copied: string[] = [];
  const failed: string[] = [];
  for (const item of SUNO_PROFILE_COPY_ITEMS) {
    const from = join(sourceProfile, item);
    const to = join(destDefault, item);
    const entry = await stat(from).catch(() => undefined);
    if (!entry) {
      continue;
    }
    try {
      await cp(from, to, { recursive: true, force: false, errorOnExist: false });
      copied.push(item);
    } catch {
      failed.push(item);
    }
  }
  return { status: "copied", copied, failed };
}

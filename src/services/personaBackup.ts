import { constants } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PersonaBackupFile = "ARTIST" | "SOUL";

export interface BackupChangeSetEntry {
  sourcePath: string;
  backupPath?: string;
  skipped: boolean;
}

export interface BackupChangeSet {
  sessionId: string;
  entries: BackupChangeSetEntry[];
}

const sessionBackups = new Map<string, string | null>();

function personaFilePath(root: string, file: PersonaBackupFile): string {
  return join(root, `${file}.md`);
}

function utcStamp(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function uniqueBackupPath(path: string): Promise<string> {
  const base = `${path}.backup-${utcStamp()}`;
  if (!(await exists(base))) {
    return base;
  }
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}.${index}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  throw new Error("persona_backup_path_exhausted");
}

function backupKey(root: string, sessionId: string, file: PersonaBackupFile): string {
  return `${root}\0${sessionId}\0${file}`;
}

export async function backupPathIfPresentOnce(source: string, backup: string, sessionId: string): Promise<string | null> {
  const key = `${source}\0${sessionId}`;
  if (sessionBackups.has(key)) {
    return sessionBackups.get(key) ?? null;
  }
  if (!(await exists(source))) {
    sessionBackups.set(key, null);
    return null;
  }
  await mkdir(dirname(backup), { recursive: true });
  await copyFile(source, backup, constants.COPYFILE_EXCL);
  sessionBackups.set(key, backup);
  return backup;
}

export async function ensureBackupOnce(root: string, sessionId: string, file: PersonaBackupFile): Promise<string | null> {
  const key = backupKey(root, sessionId, file);
  if (sessionBackups.has(key)) {
    return null;
  }
  const source = personaFilePath(root, file);
  if (!(await exists(source))) {
    sessionBackups.set(key, null);
    return null;
  }
  const backup = await uniqueBackupPath(source);
  await mkdir(dirname(backup), { recursive: true });
  await copyFile(source, backup, constants.COPYFILE_EXCL);
  sessionBackups.set(key, backup);
  return backup;
}

export async function ensureBackupPathOnce(source: string, sessionId: string): Promise<string | null> {
  const key = `${source}\0${sessionId}`;
  if (sessionBackups.has(key)) {
    return null;
  }
  if (!(await exists(source))) {
    sessionBackups.set(key, null);
    return null;
  }
  const backup = await uniqueBackupPath(source);
  await mkdir(dirname(backup), { recursive: true });
  await copyFile(source, backup, constants.COPYFILE_EXCL);
  sessionBackups.set(key, backup);
  return backup;
}

export async function ensureBackupChangeSet(paths: string[], sessionId: string): Promise<BackupChangeSet> {
  const uniquePaths = [...new Set(paths)];
  const entries: BackupChangeSetEntry[] = [];
  for (const sourcePath of uniquePaths) {
    const backupPath = await ensureBackupPathOnce(sourcePath, sessionId);
    entries.push({ sourcePath, backupPath: backupPath ?? undefined, skipped: backupPath === null });
  }
  return { sessionId, entries };
}

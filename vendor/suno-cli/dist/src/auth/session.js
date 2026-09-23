import fs from "node:fs/promises";
import path from "node:path";
export async function saveSession(sessionFile, session) {
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(sessionFile, 0o600).catch(() => undefined);
}
export async function loadSession(sessionFile) {
    let raw;
    try {
        raw = await fs.readFile(sessionFile, "utf8");
    }
    catch {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
export async function clearSession(sessionFile) {
    try {
        await fs.unlink(sessionFile);
        return true;
    }
    catch {
        return false;
    }
}

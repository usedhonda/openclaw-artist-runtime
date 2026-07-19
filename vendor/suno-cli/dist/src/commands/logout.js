import fs from "node:fs/promises";
import { clearSession } from "../auth/session.js";
import { ExitCode, writeJson } from "./output.js";
export async function logoutCommand(options) {
    const clearedSession = await clearSession(options.sessionFile);
    let clearedProfile = false;
    if (options.profileDir) {
        clearedProfile = await removeDir(options.profileDir);
    }
    writeJson({
        ok: true,
        status: "logged_out",
        cleared: {
            saved: clearedSession,
            profile: clearedProfile
        }
    });
    return ExitCode.ok;
}
async function removeDir(dir) {
    try {
        await fs.access(dir);
    }
    catch {
        return false;
    }
    await fs.rm(dir, { recursive: true, force: true });
    return true;
}

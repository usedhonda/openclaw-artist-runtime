import { clerkTokenFromJwt } from "../auth/clerk.js";
import { launchPersistentBrowser } from "./captcha.js";
export class LoginTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = "LoginTimeoutError";
    }
}
const SUNO_DOMAIN_RE = /(^|\.)suno\.(com|ai)$/i;
const POLL_INTERVAL_MS = 1000;
// Minimal login state capture: headed browser -> user logs in manually -> we read the
// authenticated Clerk cookies. Advanced flows (MFA, social login, Cloudflare interstitial,
// payment modal) are intentionally left for a later phase.
// TODO(phase-2c): detect and surface MFA / social-login / Cloudflare / payment states.
export async function captureBrowserSession(input) {
    const context = (await launchPersistentBrowser({
        profileDir: input.profileDir,
        headless: false
    }));
    try {
        const page = (await context.newPage());
        await page.goto(input.loginUrl, { waitUntil: "domcontentloaded", timeout: input.timeoutMs });
        const deadline = Date.now() + input.timeoutMs;
        while (Date.now() < deadline) {
            const captured = await readSunoSession(context, page);
            if (captured)
                return captured;
            await delay(POLL_INTERVAL_MS);
        }
        throw new LoginTimeoutError("Timed out waiting for Suno login in the browser.");
    }
    finally {
        await context.close().catch(() => undefined);
    }
}
async function readSunoSession(context, page) {
    const cookies = (await context.cookies().catch(() => []));
    const sunoCookies = cookies.filter((cookie) => SUNO_DOMAIN_RE.test(cookie.domain.replace(/^\./, "")));
    const hasSession = sunoCookies.some((cookie) => cookie.name === "__session");
    if (!hasSession)
        return undefined;
    const cookieHeader = sunoCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    const jwt = await readClerkJwt(page);
    if (jwt) {
        const token = clerkTokenFromJwt(jwt);
        return {
            jwt,
            cookie: cookieHeader,
            ...(token.sessionId ? { sessionId: token.sessionId } : {}),
            ...(token.expiresAt ? { expiresAt: token.expiresAt } : {})
        };
    }
    return { cookie: cookieHeader };
}
async function readClerkJwt(page) {
    const jwt = await page
        .evaluate(async () => {
        const clerk = globalThis.Clerk;
        const getToken = clerk?.session?.getToken;
        if (typeof getToken !== "function")
            return "";
        try {
            return (await getToken.call(clerk?.session)) ?? "";
        }
        catch {
            return "";
        }
    })
        .catch(() => "");
    return typeof jwt === "string" && jwt.length > 0 ? jwt : undefined;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

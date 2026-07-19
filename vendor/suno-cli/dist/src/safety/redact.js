const SECRET_KEY_RE = /(authorization|cookie|token|jwt|session|__clerk|__session|__client_uat|create_session_token)/i;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const AUTH_HEADER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const COOKIE_PAIR_RE = /\b(__clerk_[A-Za-z0-9_-]*|__session|__client_uat(?:_[A-Za-z0-9_-]+)?|__stripe_[A-Za-z0-9_-]*)=([^;\s]+)/g;
export const REDACTED = "[REDACTED]";
export function redactString(input) {
    let output = input.replace(JWT_RE, REDACTED);
    output = output.replace(AUTH_HEADER_RE, `Bearer ${REDACTED}`);
    output = output.replace(COOKIE_PAIR_RE, `$1=${REDACTED}`);
    output = redactUrlSecrets(output);
    output = output.replace(/("?(?:token|jwt|cookie|authorization|create_session_token)"?\s*[:=]\s*)("[^"]+"|[^,\s}]+)/gi, `$1${REDACTED}`);
    return output;
}
function redactUrlSecrets(input) {
    return input.replace(/https?:\/\/[^\s"'<>]+/g, (candidate) => {
        try {
            const url = new URL(candidate);
            let changed = false;
            for (const [key, value] of url.searchParams.entries()) {
                if (SECRET_KEY_RE.test(key) || JWT_RE.test(value)) {
                    url.searchParams.set(key, REDACTED);
                    changed = true;
                }
            }
            return changed ? url.toString() : candidate;
        }
        catch {
            return candidate;
        }
    });
}
export function redact(value) {
    if (typeof value === "string") {
        return redactString(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => redact(item));
    }
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            result[key] = SECRET_KEY_RE.test(key) ? REDACTED : redact(item);
        }
        return result;
    }
    return value;
}
export function safeJson(value) {
    return `${JSON.stringify(redact(value), null, 2)}\n`;
}

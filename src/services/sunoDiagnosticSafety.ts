const SENSITIVE_QUERY_NAMES = new Set([
  "__clerk_handshake",
  "__session",
  "session",
  "session_token",
  "token"
]);

/**
 * Browser redirects can place a short-lived Clerk handshake in the current URL.
 * Diagnostics need the route, never its query or fragment, so strip both for every
 * browser URL before it reaches logs, status detail, or failure artifacts.
 */
export function sanitizeSunoDiagnosticUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }
    return trimmed.split(/[?#]/, 1)[0] ?? "";
  } catch {
    return trimmed.split(/[?#]/, 1)[0] ?? "";
  }
}

/** Redact sensitive URL/query material that a browser/library may embed in an error. */
export function sanitizeSunoDiagnosticText(rawText: string): string {
  const withoutUrls = rawText.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    const trailing = candidate.match(/[),.]+$/)?.[0] ?? "";
    const url = trailing ? candidate.slice(0, -trailing.length) : candidate;
    return `${sanitizeSunoDiagnosticUrl(url)}${trailing}`;
  });
  return withoutUrls.replace(
    /((?:^|[?&;\s])(?:__clerk_handshake|__session|session_token|token)=)[^&;\s"'<>]+/gi,
    "$1<redacted>"
  );
}

export function hasSensitiveSunoDiagnosticQuery(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return Array.from(parsed.searchParams.keys()).some((name) => SENSITIVE_QUERY_NAMES.has(name.toLowerCase()));
  } catch {
    return /(?:^|[?&])(?:__clerk_handshake|__session|session|session_token|token)=/i.test(rawUrl);
  }
}

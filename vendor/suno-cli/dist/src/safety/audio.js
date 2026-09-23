export function isSilencePlaceholder(url) {
    if (!url)
        return false;
    try {
        const parsed = new URL(url);
        return parsed.pathname.toLowerCase().includes("sil-100.mp3");
    }
    catch {
        return url.toLowerCase().includes("sil-100.mp3");
    }
}
export function isForbiddenPlaceholder(url) {
    if (!url)
        return false;
    try {
        return new URL(url).pathname.toLowerCase() === "/api/forbidden";
    }
    catch {
        return /(?:^|\/)api\/forbidden(?:[?#]|$)/i.test(url);
    }
}
export function isAudioReady(url) {
    return Boolean(url) && !isSilencePlaceholder(url) && !isForbiddenPlaceholder(url);
}

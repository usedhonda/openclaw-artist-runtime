import { useCallback, useEffect, useMemo, useState } from "react";

export interface UseHashRouteResult {
  selectedSongId: string | null;
  clearSong: () => void;
  selectSong: (songId: string) => void;
}

function readHash(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash;
}

export function useHashRoute(): UseHashRouteResult {
  const [hash, setHash] = useState<string>(readHash);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handler = () => setHash(window.location.hash);
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const selectedSongId = useMemo(() => {
    const match = hash.match(/#song=([^&]+)/);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }, [hash]);

  const clearSong = useCallback(() => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setHash("");
  }, []);

  const selectSong = useCallback((songId: string) => {
    if (typeof window === "undefined") return;
    const nextHash = `#song=${encodeURIComponent(songId)}`;
    window.history.replaceState(null, "", window.location.pathname + window.location.search + nextHash);
    setHash(nextHash);
  }, []);

  return { selectedSongId, clearSong, selectSong };
}

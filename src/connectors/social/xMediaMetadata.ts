import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

export interface XMediaMetadata {
  attached: false;
  filename: string;
  sizeBytes: number;
  mimeType: string;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime"
};

function resolveMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export async function extractMediaMetadata(filePath: string): Promise<XMediaMetadata> {
  const filename = basename(filePath);
  const stats = await stat(filePath);
  return {
    attached: false,
    filename,
    sizeBytes: stats.size,
    mimeType: resolveMimeType(filename)
  };
}

export function extractMentionedHandles(text: string): string[] {
  const matches = text.matchAll(/(?<![A-Za-z0-9_])@([A-Za-z0-9_]{1,15})/g);
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const handle = match[1];
    if (handle && !seen.has(handle)) {
      seen.add(handle);
      handles.push(handle);
    }
  }
  return handles;
}

export function extractTweetIdFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  return url.match(/\/status\/(\d+)/i)?.[1];
}

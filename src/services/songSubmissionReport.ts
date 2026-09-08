/**
 * The small, musician-facing part of a song notification.
 *
 * This formatter deliberately accepts the binding as input.  It must not look up
 * the latest prompt pack or infer which revision a URL belongs to: a late event
 * is allowed to be unattributed rather than attached to the wrong song version.
 */
export type SongSubmissionReportKind = "progress" | "submission" | "download";
export type SongSubmissionOrigin = "self_origin" | "producer_revision";

export interface SongSubmissionBinding {
  runId: string;
  packVersion?: number | string;
  payloadHash?: string;
  revisionId?: string;
  baselineTake?: {
    runId?: string;
    takeId?: string;
    url?: string;
  };
  instruction?: string;
  contextKey?: string;
}

export interface SongSubmissionReportContext {
  kind: SongSubmissionReportKind;
  title: string;
  requestOrVersion?: string;
  origin?: SongSubmissionOrigin;
  binding?: SongSubmissionBinding;
  intended?: readonly string[];
  changed?: readonly string[];
  kept?: readonly string[];
  audioUrls: readonly string[];
  previous?: {
    label?: string;
    audioUrls: readonly string[];
  };
  listenFor?: readonly string[];
  nextFeedback?: string;
  audioVerified?: boolean;
}

function list(items: readonly string[] | undefined): string | undefined {
  const values = (items ?? []).map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values.map((item) => `・${item}`).join("\n") : undefined;
}

function links(urls: readonly string[]): string {
  const values = urls.map((url) => url.trim()).filter(Boolean);
  return values.length > 0 ? values.map((url, index) => `${index + 1}. ${url}`).join("\n") : "(URL なし)";
}

/**
 * Format a bounded report for the producer's music conversation.
 * Internal IDs, paths, counters, and operational footers intentionally never
 * appear here.  `audioVerified` is opt-in; URLs alone never imply listening.
 */
export function formatSongSubmissionReport(context: SongSubmissionReportContext): string {
  const title = context.title.trim() || "無題の曲";
  const request = context.requestOrVersion?.trim();

  if (context.kind === "progress") {
    return [
      `${title}、まだ生成中。`,
      request,
      "🔗 生成中のURL:",
      links(context.audioUrls),
      context.previous && context.previous.audioUrls.length > 0 ? `前の参照:\n${links(context.previous.audioUrls)}` : undefined,
      "再生できる状態かはまだ確認していない。"
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  if (context.kind === "download") {
    return [
      `${title}、音源を受け取った。`,
      request,
      links(context.audioUrls),
      context.nextFeedback?.trim()
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  const intended = list(context.intended);
  const changed = list(context.changed);
  const kept = list(context.kept);
  const listenFor = list(context.listenFor);
  return [
    `${title}を提出する。`,
    request,
    intended,
    changed ? `変えたところ:\n${changed}` : undefined,
    kept ? `残したところ:\n${kept}` : undefined,
    "🔗 今回の音源:",
    links(context.audioUrls),
    context.previous && context.previous.audioUrls.length > 0 ? `前の参照${context.previous.label ? `（${context.previous.label}）` : ""}:\n${links(context.previous.audioUrls)}` : undefined,
    listenFor ? `聴いてほしい点:\n${listenFor}` : undefined,
    !context.audioVerified && context.audioUrls.length > 0 ? "音の確認はまだ。" : undefined,
    context.nextFeedback?.trim()
  ].filter((line): line is string => Boolean(line)).join("\n");
}

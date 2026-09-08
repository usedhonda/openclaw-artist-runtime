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

function list(items: readonly string[] | undefined, empty = "記録なし"): string {
  const values = (items ?? []).map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values.map((item) => `・${item}`).join("\n") : empty;
}

function links(urls: readonly string[]): string {
  const values = urls.map((url) => url.trim()).filter(Boolean);
  return values.length > 0 ? values.map((url, index) => `${index + 1}. ${url}`).join("\n") : "(URL なし)";
}

function bindingLine(binding: SongSubmissionBinding | undefined): string | undefined {
  if (!binding?.runId) return undefined;
  return binding.packVersion !== undefined
    ? `今回の制作束: v${binding.packVersion} の生成 run に紐づくもの`
    : "今回の制作束: この生成 run に紐づくもの";
}

function feedbackLine(context: SongSubmissionReportContext): string {
  if (context.nextFeedback?.trim()) return context.nextFeedback.trim();
  return "聴いて、残したいところと直したいところを自然に返して。採用か破棄かを今すぐ決めなくていい。";
}

/**
 * Format a bounded report for the producer's music conversation.
 * Internal IDs, paths, counters, and operational footers intentionally never
 * appear here.  `audioVerified` is opt-in; URLs alone never imply listening.
 */
export function formatSongSubmissionReport(context: SongSubmissionReportContext): string {
  const title = context.title.trim() || "無題の曲";
  const request = context.requestOrVersion?.trim();
  const binding = bindingLine(context.binding);

  if (context.kind === "progress") {
    return [
      `制作途中の音源が届いた。${title}。`,
      request ? `今回の依頼 / version: ${request}` : undefined,
      "これは完成報告じゃなく、先に聴けるURLを渡す通知。",
      "🔗 先に聴く:",
      links(context.audioUrls),
      context.previous && context.previous.audioUrls.length > 0 ? `前の参照:\n${links(context.previous.audioUrls)}` : undefined,
      "聴こえ方の確認はまだしていない。まず耳で比べて、気づいたことを返して。"
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  if (context.kind === "download") {
    return [
      `音源を受け取れる状態にした。${title}。`,
      request ? `今回の依頼 / version: ${request}` : undefined,
      "🔗 試聴:",
      links(context.audioUrls),
      "保存先の細部や内部記録は別に残してある。ここでは音楽の比較に必要なURLだけ出す。",
      feedbackLine(context)
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  return [
    `曲を一曲、提出する。${title}。`,
    request ? `今回の依頼 / version: ${request}` : undefined,
    context.origin === "producer_revision" ? "前の曲への修正として返す。" : "自分の観察から始めた曲として返す。",
    binding,
    "意図:",
    list(context.intended),
    "変えたところ:",
    list(context.changed),
    "残したところ:",
    list(context.kept),
    "🔗 今回の音源:",
    links(context.audioUrls),
    context.previous && context.previous.audioUrls.length > 0 ? `前の参照${context.previous.label ? `（${context.previous.label}）` : ""}:\n${links(context.previous.audioUrls)}` : undefined,
    context.listenFor && context.listenFor.length > 0 ? `聴いてほしい点:\n${list(context.listenFor)}` : undefined,
    context.audioVerified ? "音源の再生確認も済んでいる。" : "こちらで音を聴いたとは言わない。URL先で確かめてほしい。",
    feedbackLine(context)
  ].filter((line): line is string => Boolean(line)).join("\n");
}

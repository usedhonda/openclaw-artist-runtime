import type { DistributionEvent, SocialPlatform } from "../types";

export type DistributionEventDecisionFilter = "all" | "published" | "dryRun" | "blocked";

export interface DistributionEventsFilterState {
  platform: "all" | SocialPlatform;
  decision: DistributionEventDecisionFilter;
  from?: string;
  to?: string;
  search: string;
}

export const defaultDistributionEventsFilter: DistributionEventsFilterState = {
  platform: "all",
  decision: "all",
  search: ""
};

export function classifyDistributionDecision(event: Pick<DistributionEvent, "accepted" | "dryRun">): Exclude<DistributionEventDecisionFilter, "all"> {
  if (event.accepted) {
    return "published";
  }
  return event.dryRun ? "dryRun" : "blocked";
}

function eventDate(event: DistributionEvent): string {
  return event.timestamp.slice(0, 10);
}

function searchableText(event: DistributionEvent): string {
  return [
    event.timestamp,
    event.platform,
    event.action,
    event.postType,
    event.reason,
    event.url,
    event.songId,
    event.replyTarget?.targetId,
    event.replyTarget?.resolvedFrom,
    event.replyTarget?.resolutionReason
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterDistributionEvents(
  events: DistributionEvent[],
  filter: DistributionEventsFilterState = defaultDistributionEventsFilter
): DistributionEvent[] {
  const query = filter.search.trim().toLowerCase();
  return events.filter((event) => {
    if (filter.platform !== "all" && event.platform !== filter.platform) {
      return false;
    }
    if (filter.decision !== "all" && classifyDistributionDecision(event) !== filter.decision) {
      return false;
    }
    const date = eventDate(event);
    if (filter.from && date < filter.from) {
      return false;
    }
    if (filter.to && date > filter.to) {
      return false;
    }
    if (query && !searchableText(event).includes(query)) {
      return false;
    }
    return true;
  });
}

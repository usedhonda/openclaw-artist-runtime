import React, { useEffect, useState } from "react";
import { t, type ProducerRoomLocale } from "../i18n";

export interface SunoHumanAssistEvent {
  type: "suno_human_assist_requested";
  songId: string;
  title: string;
  timeoutMinutes: number;
  timestamp: number;
}

const defaultEventStreamUrl = "/plugins/artist-runtime/api/events/stream";

export function isSunoHumanAssistEvent(value: unknown): value is SunoHumanAssistEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const event = value as Record<string, unknown>;
  return (
    event.type === "suno_human_assist_requested" &&
    typeof event.songId === "string" &&
    typeof event.title === "string" &&
    typeof event.timeoutMinutes === "number" &&
    typeof event.timestamp === "number"
  );
}

export function parseSunoHumanAssistEvent(data: string): SunoHumanAssistEvent | undefined {
  try {
    const parsed = JSON.parse(data) as unknown;
    return isSunoHumanAssistEvent(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function humanAssistExpiryMs(event: SunoHumanAssistEvent): number {
  return event.timestamp + event.timeoutMinutes * 60_000;
}

export function isHumanAssistActive(event: SunoHumanAssistEvent, now: number): boolean {
  return now < humanAssistExpiryMs(event);
}

export function humanAssistRemainingMinutes(event: SunoHumanAssistEvent, now: number): number {
  return Math.max(0, Math.ceil((humanAssistExpiryMs(event) - now) / 60_000));
}

// Keep only the latest still-active request per song, newest first. An expired request
// (past its humanAssistTimeoutMinutes window) drops out so the card hides itself.
export function activeHumanAssistEvents(events: SunoHumanAssistEvent[], now: number): SunoHumanAssistEvent[] {
  const latestBySong = new Map<string, SunoHumanAssistEvent>();
  for (const event of events) {
    if (!isHumanAssistActive(event, now)) {
      continue;
    }
    const existing = latestBySong.get(event.songId);
    if (!existing || event.timestamp > existing.timestamp) {
      latestBySong.set(event.songId, event);
    }
  }
  return Array.from(latestBySong.values()).sort((a, b) => b.timestamp - a.timestamp);
}

export interface SunoHumanAssistCardProps {
  locale?: ProducerRoomLocale;
  events?: SunoHumanAssistEvent[];
  eventStreamUrl?: string;
  now?: number;
}

export function SunoHumanAssistCard(props: SunoHumanAssistCardProps) {
  const locale = props.locale ?? "en";
  const [streamEvents, setStreamEvents] = useState<SunoHumanAssistEvent[]>([]);
  const [clock, setClock] = useState<number>(() => props.now ?? Date.now());

  useEffect(() => {
    if (props.now !== undefined) {
      setClock(props.now);
      return undefined;
    }
    const interval = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [props.now]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.EventSource !== "function") {
      return undefined;
    }
    const source = new window.EventSource(props.eventStreamUrl ?? defaultEventStreamUrl);
    source.onmessage = (message) => {
      const event = parseSunoHumanAssistEvent(message.data);
      if (!event) {
        return;
      }
      setStreamEvents((current) => [event, ...current].slice(0, 20));
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [props.eventStreamUrl]);

  const active = activeHumanAssistEvents([...streamEvents, ...(props.events ?? [])], clock);
  if (active.length === 0) {
    return null;
  }

  return (
    <article className="panel suno-human-assist-card">
      <div className="section-title">{t(locale, "sunoHumanAssistTitle")}</div>
      <div className="list">
        {active.map((event) => (
          <div className="item" key={`${event.songId}:${event.timestamp}`}>
            <strong>{event.title}</strong>
            <div className="muted">{t(locale, "sunoHumanAssistBody", { title: event.title })}</div>
            <div className="eyebrow">
              {t(locale, "sunoHumanAssistRemaining", { minutes: humanAssistRemainingMinutes(event, clock) })}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

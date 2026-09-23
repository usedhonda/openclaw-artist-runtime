import { readAlertAcks } from "./alertAcks.js";
import { inspectAuditLog } from "./auditLog.js";
import { listSongStates } from "./artistState.js";
import type { AlertRecord, ArtistRuntimeConfig, PlatformStatus, SunoWorkerStatus } from "../types.js";
import { inspectJsonlFile } from "./promptLedger.js";
import { readAutopilotRunState } from "./autopilotService.js";

function alertId(source: AlertRecord["source"], scope: AlertRecord["scope"], songId?: string): string {
  return `${source}:${scope}:${songId ?? "global"}`;
}

function now(): string {
  return new Date().toISOString();
}

export async function collectAlerts(
  workspaceRoot: string,
  sunoWorker: SunoWorkerStatus,
  platforms: Record<"x" | "instagram" | "tiktok", PlatformStatus>,
  config: ArtistRuntimeConfig
): Promise<AlertRecord[]> {
  const alerts: AlertRecord[] = [];
  const ackMap = await readAlertAcks(workspaceRoot);
  const songs = await listSongStates(workspaceRoot);
  for (const song of songs) {
    const promptLedger = await inspectJsonlFile(`${workspaceRoot}/songs/${song.songId}/prompts/prompt-ledger.jsonl`);
    if (!promptLedger.healthy) {
      alerts.push({
        id: alertId("prompt_ledger", "song", song.songId),
        severity: "critical",
        source: "prompt_ledger",
        scope: "song",
        songId: song.songId,
        message: `Prompt ledger unhealthy for ${song.songId}`,
        detail: promptLedger.errors.join("; "),
        createdAt: now()
      });
    }

    const socialLedger = await inspectAuditLog(`${workspaceRoot}/songs/${song.songId}/social/social-publish.jsonl`);
    if (!socialLedger.healthy) {
      alerts.push({
        id: alertId("social_ledger", "song", song.songId),
        severity: "warning",
        source: "social_ledger",
        scope: "song",
        songId: song.songId,
        message: `Social ledger unhealthy for ${song.songId}`,
        detail: socialLedger.errors.join("; "),
        createdAt: now()
      });
    }

    const auditLog = await inspectAuditLog(`${workspaceRoot}/songs/${song.songId}/audit/actions.jsonl`);
    if (!auditLog.healthy) {
      alerts.push({
        id: alertId("audit_log", "song", song.songId),
        severity: "warning",
        source: "audit_log",
        scope: "song",
        songId: song.songId,
        message: `Audit log unhealthy for ${song.songId}`,
        detail: auditLog.errors.join("; "),
        createdAt: now()
      });
    }
  }

  if (sunoWorker.hardStopReason) {
    alerts.push({
      id: alertId("suno_worker", "global"),
      severity: "critical",
      source: "suno_worker",
      scope: "global",
      message: sunoWorker.hardStopReason,
      createdAt: now()
    });
  }

  const autopilot = await readAutopilotRunState(workspaceRoot);
  if (autopilot.hardStopReason) {
    alerts.push({
      id: alertId("autopilot", "global"),
      severity: "critical",
      source: "autopilot",
      scope: "global",
      message: autopilot.hardStopReason,
      detail: autopilot.runId,
      createdAt: now()
    });
  } else if (autopilot.paused) {
    alerts.push({
      id: alertId("autopilot", "global"),
      severity: "info",
      source: "autopilot",
      scope: "global",
      message: autopilot.pausedReason ?? "autopilot paused",
      detail: autopilot.runId,
      createdAt: now()
    });
  }

  for (const [platform, status] of Object.entries(platforms) as Array<[keyof ArtistRuntimeConfig["distribution"]["platforms"], PlatformStatus]>) {
    if (!config.distribution.platforms[platform].enabled) {
      continue;
    }
    const supported = [
      status.capabilitySummary.textPost,
      status.capabilitySummary.imagePost,
      status.capabilitySummary.videoPost,
      status.capabilitySummary.carouselPost,
      status.capabilitySummary.reelPost
    ].some((capability) => capability === true);
    if (!supported) {
      alerts.push({
        id: alertId("platform", "global", platform),
        severity: "warning",
        source: "platform",
        scope: "global",
        message: `${platform} is enabled but has no confirmed publish capability`,
        createdAt: now()
      });
    }
  }

  return alerts.map((alert) => ({
    ...alert,
    ackedAt: ackMap[alert.id]
  }));
}

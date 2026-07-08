import { safeRegisterRoute } from "../pluginApi.js";
import { acknowledgeAlert } from "../services/alertAcks.js";
import { listSongStates } from "../services/artistState.js";
import { pauseAutopilot, resumeAutopilot } from "../services/autopilotService.js";
import { AutopilotControlService } from "../services/autopilotControlService.js";
import { getAutopilotTicker, getLastTickAt } from "../services/autopilotTicker.js";
import { handleProposalResponse, listPendingProposalDetails } from "../services/conversationalSession.js";
import { mergeResolvedConfig, patchResolvedConfig, resolveRuntimeConfig, writeRuntimeSafetyOverrides } from "../services/runtimeConfig.js";
import { publishSocialAction } from "../services/socialPublishing.js";
import { prepareSocialAssets } from "../services/socialAssets.js";
import { handleSongPublishActionRequest } from "../services/songPublishActionRegistry.js";
import { buildSunoArtifactsPage } from "../services/sunoArtifacts.js";
import { SunoBudgetTracker } from "../services/sunoBudget.js";
import { generateSunoRun, readAllSunoRuns } from "../services/sunoRuns.js";
import { SunoBrowserWorker } from "../services/sunoBrowserWorker.js";
import { createSongIdea } from "../services/songIdeation.js";
import { buildSongbookLookup, syncSongbookFromITunes } from "../services/songbookSyncer.js";
import { selectTake } from "../services/takeSelection.js";
import { exportWindowFromPayload, payloadPathSegments, payloadRecord, payloadRequestMethod, payloadRequestPath, platformFromSegment, sunoDiagnosticsDaysFromPayload } from "./payloadHelpers.js";
import { INSTAGRAM_DEFAULT_TOKEN_EXPIRY_MS, appendConfigOverridesAudit, buildAlertsResponse, buildArtistMindResponse, buildAuditLogResponse, buildCallbackActionsResponse, buildConfigOverridesResponse, buildConfigResponse, buildFailedNotifyListResponse, buildFailedNotifyReplayResponse, buildInternalCallbackDispatchResponse, buildNotifyReviewResponse, buildPersonaCompleteResponse, buildPersonaProposeResponse, buildPersonaResponse, buildPersonaWriteResponse, buildPlatformDetailResponse, buildPlatformsResponse, buildProducerCallbackDispatchResponse, buildPromptLedgerResponse, buildRecoveryResponse, buildSafeTickTriggerResponse, buildSongDetailResponse, buildSongEventsResponse, buildSongLedgerResponse, buildSongsResponse, buildSpawnProposalsResponse, buildStatusExportResponse, buildStatusResponse, buildSunoDiagnosticsExportResponse, buildSunoStatusResponse, isInstagramTokenExpiringSoon, isPersonaSnapshotLayer, payloadContainsSecretLikeText, proposalFieldsFromPayload, proposalRouteError, runtimeSafetyPatchFromPayload } from "./responseBuilders.js";
import { registerRuntimeEventStreamRoute } from "./runtimeEventStream.js";
import { producerConsoleHtml } from "./uiFallback.js";
import type { ArtistRuntimeConfig } from "../types.js";

export { producerConsoleHtml, uiBuildIsFresh } from "./uiFallback.js";
export {
  buildAlertsResponse,
  buildArtistMindResponse,
  buildAuditLogResponse,
  buildCallbackActionsResponse,
  buildConfigOverridesResponse,
  buildConfigResponse,
  buildFailedNotifyListResponse,
  buildFailedNotifyReplayResponse,
  buildInternalCallbackDispatchResponse,
  buildNotifyReviewResponse,
  buildPersonaResponse,
  buildPlatformDetailResponse,
  buildPlatformsResponse,
  buildProducerCallbackDispatchResponse,
  buildPromptLedgerResponse,
  buildRecoveryResponse,
  buildSafeTickTriggerResponse,
  buildSongDetailResponse,
  buildSongEventsResponse,
  buildSongLedgerResponse,
  buildSongsResponse,
  buildSpawnProposalsResponse,
  buildStatusExportResponse,
  buildStatusResponse,
  buildSunoDiagnosticsExportResponse,
  buildSunoStatusResponse
} from "./responseBuilders.js";
export type {
  CallbackActionsResponse,
  FailedNotifyListResponse,
  FailedNotifyReplayResponse,
  InternalCallbackDispatchResponse,
  NotifyReviewResponse,
  ProducerCallbackDispatchResponse,
  SafeTickTriggerResponse,
  SpawnProposalsResponse
} from "./responseBuilders.js";

export function registerRoutes(api: unknown): void {
  registerRuntimeEventStreamRoute(api);

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime",
    contentType: "text/html; charset=utf-8",
    handler: async () => producerConsoleHtml()
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/status",
    handler: async (input) => buildStatusResponse(payloadRecord(input).config as Partial<ArtistRuntimeConfig> | undefined)
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/persona",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/persona");
      const config = payload.config as Partial<ArtistRuntimeConfig> | undefined;
      if (method === "GET" && segments.length === 0) {
        return buildPersonaResponse(config);
      }
      if (method === "POST" && segments.length === 1) {
        const layer = segments[0];
        if (layer === "artist" || layer === "soul" || isPersonaSnapshotLayer(layer)) {
          return buildPersonaWriteResponse(config, layer, payload);
        }
        if (layer === "propose") {
          return buildPersonaProposeResponse(config, payload);
        }
        if (layer === "complete") {
          return buildPersonaCompleteResponse(config);
        }
      }
      return {
        error: "unknown_persona_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/persona"),
        statusCode: 404
      };
    }
  });

  safeRegisterRoute(api, {
    method: "GET",
    match: "prefix",
    path: "/plugins/artist-runtime/api/callback-actions",
    handler: buildCallbackActionsResponse
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/spawn-proposals",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      if (method !== "POST") {
        return buildSpawnProposalsResponse(input);
      }
      // Plan v10.65 Layer 2: receive-independent spawn GO from the Console.
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/spawn-proposals");
      const proposalId = segments[0] ?? (typeof payload.proposalId === "string" ? payload.proposalId : "");
      const decision = segments[1];
      const action = decision === "inject"
        ? "song_spawn_inject"
        : decision === "skip"
          ? "song_spawn_skip"
          : undefined;
      if (!proposalId || !action) {
        return { error: "unknown_spawn_proposal_decision", statusCode: 400 };
      }
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      return buildProducerCallbackDispatchResponse(config.artist.workspaceRoot, { action, proposalId });
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/autopilot/safe-tick-trigger",
    handler: buildSafeTickTriggerResponse
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/status/export",
    handler: async (input) => {
      const payload = payloadRecord(input);
      return buildStatusExportResponse(
        payload.config as Partial<ArtistRuntimeConfig> | undefined,
        exportWindowFromPayload(payload)
      );
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/telegram/callback-dispatch",
    handler: buildInternalCallbackDispatchResponse
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/notify",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/notify");
      if (method === "GET" && segments.length === 1 && segments[0] === "failed") {
        return buildFailedNotifyListResponse(input);
      }
      if (method === "POST" && segments.length === 2 && segments[0] === "replay") {
        return buildFailedNotifyReplayResponse(input, segments[1] ?? "");
      }
      return {
        error: "unknown_notify_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/notify"),
        statusCode: 404
      };
    }
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/config",
    handler: async (input) => buildConfigResponse(payloadRecord(input).config as Partial<ArtistRuntimeConfig> | undefined)
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    path: "/plugins/artist-runtime/api/config/overrides",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const context = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      const responseConfig = { artist: { workspaceRoot: context.artist.workspaceRoot } } as Partial<ArtistRuntimeConfig>;
      if (method === "GET") {
        return buildConfigOverridesResponse(responseConfig);
      }
      const { patch, errors } = runtimeSafetyPatchFromPayload(payload);
      if (errors.length > 0 || !patch) {
        return {
          error: "invalid_config_overrides",
          statusCode: 400,
          errors
        };
      }
      const before = await buildConfigOverridesResponse(responseConfig);
      await writeRuntimeSafetyOverrides(context.artist.workspaceRoot, patch);
      const after = await buildConfigOverridesResponse(responseConfig);
      await appendConfigOverridesAudit(context.artist.workspaceRoot, before, after);
      return after;
    }
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/artist-mind",
    handler: async (input) => buildArtistMindResponse(payloadRecord(input).config as Partial<ArtistRuntimeConfig> | undefined)
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    path: "/plugins/artist-runtime/api/songbook/lookup",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      const options = { fetchImpl: fetch };
      return payloadRequestMethod(payload) === "POST"
        ? syncSongbookFromITunes(config.artist.workspaceRoot, options)
        : buildSongbookLookup(config.artist.workspaceRoot, options);
    }
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/audit",
    handler: async (input) => buildAuditLogResponse(payloadRecord(input).config as Partial<ArtistRuntimeConfig> | undefined)
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/recovery",
    handler: async (input) => buildRecoveryResponse(payloadRecord(input).config as Partial<ArtistRuntimeConfig> | undefined)
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/proposals",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/proposals");
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      const workspaceRoot = config.artist.workspaceRoot;

      try {
        if (method === "GET" && segments.length === 0) {
          return {
            proposals: await listPendingProposalDetails(workspaceRoot)
          };
        }

        if (method === "POST" && segments.length === 2) {
          const proposalId = segments[0] ?? "";
          const action = segments[1];
          if (action === "yes") {
            return await handleProposalResponse(workspaceRoot, {
              proposalId,
              action: "yes",
              actor: { kind: "ui_api" }
            });
          }
          if (action === "no") {
            return await handleProposalResponse(workspaceRoot, {
              proposalId,
              action: "no",
              actor: { kind: "ui_api" }
            });
          }
          if (action === "edit") {
            const fields = proposalFieldsFromPayload(payload);
            return await handleProposalResponse(workspaceRoot, {
              proposalId,
              action: "edit",
              actor: { kind: "ui_api" },
              fieldUpdates: fields
            });
          }
        }
      } catch (error) {
        return proposalRouteError(error);
      }

      return {
        error: "unknown_proposals_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/proposals")
      };
    }
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/songs",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/songs");
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);

      if (method === "GET") {
        if (segments.length === 0) {
          return buildSongsResponse(config);
        }
        if (segments.length === 1) {
          return buildSongDetailResponse(segments[0] ?? "song-001", config);
        }
        if (segments.length === 2 && segments[1] === "ledger") {
          return buildSongLedgerResponse(segments[0] ?? "song-001", config);
        }
        if (segments.length === 2 && segments[1] === "events") {
          const limit = typeof payload.limit === "number" ? payload.limit : Number.parseInt(String(payload.limit ?? "200"), 10);
          return buildSongEventsResponse(segments[0] ?? "song-001", config, limit);
        }
      }

      if (method === "POST") {
        if (segments.length === 1 && segments[0] === "ideate") {
          return createSongIdea({
            workspaceRoot: config.artist.workspaceRoot,
            title: typeof payload.title === "string" ? payload.title : undefined,
            artistReason: typeof payload.artistReason === "string" ? payload.artistReason : undefined,
            config
          });
        }
        if (segments.length === 2 && segments[1] === "select-take") {
          return selectTake({
            workspaceRoot: config.artist.workspaceRoot,
            songId: segments[0] ?? (typeof payload.songId === "string" ? payload.songId : "song-001"),
            runId: typeof payload.runId === "string" ? payload.runId : undefined,
            selectedTakeId: typeof payload.selectedTakeId === "string" ? payload.selectedTakeId : undefined,
            reason: typeof payload.reason === "string" ? payload.reason : undefined
          });
        }
        if (segments.length === 2 && segments[1] === "notify-review") {
          return buildNotifyReviewResponse(input, segments[0] ?? "song-001");
        }
        if (segments.length === 2 && (segments[1] === "songbook-write" || segments[1] === "songbook-skip" || segments[1] === "archive" || segments[1] === "discard")) {
          if (payloadContainsSecretLikeText(payload, ["reason", "note"])) {
            return {
              error: "secret_like_payload_rejected",
              statusCode: 400
            };
          }
          const action = segments[1] === "songbook-write"
            ? "song_songbook_write"
            : segments[1] === "songbook-skip"
              ? "song_skip"
              : segments[1] === "archive"
                ? "song_archive"
                : "song_discard";
          return handleSongPublishActionRequest({
            root: config.artist.workspaceRoot,
            songId: segments[0] ?? (typeof payload.songId === "string" ? payload.songId : "song-001"),
            action,
            actor: { kind: "ui_api" }
          });
        }
        if (segments.length === 2 && segments[1] === "social-assets") {
          return prepareSocialAssets({
            workspaceRoot: config.artist.workspaceRoot,
            songId: segments[0] ?? (typeof payload.songId === "string" ? payload.songId : "song-001"),
            config
          });
        }
        if (segments.length === 2 && segments[1] === "prompt-pack-go") {
          // Plan v10.65 Layer 2: receive-independent Suno pre-GO from the Console.
          return buildProducerCallbackDispatchResponse(config.artist.workspaceRoot, {
            action: "prompt_pack_go",
            songId: segments[0] ?? (typeof payload.songId === "string" ? payload.songId : "song-001")
          });
        }
      }

      return {
        error: "unknown_songs_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/songs")
      };
    }
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/prompt-ledger",
    handler: async (input) => {
      const payload = payloadRecord(input);
      return buildPromptLedgerResponse(
        typeof payload.songId === "string" ? payload.songId : undefined,
        payload.config as Partial<ArtistRuntimeConfig> | undefined
      );
    }
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/alerts",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/alerts");
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);

      if (method === "GET" && segments.length === 0) {
        return buildAlertsResponse(config);
      }
      if (method === "POST" && segments.length === 2 && segments[1] === "ack") {
        return acknowledgeAlert(config.artist.workspaceRoot, segments[0] ?? "unknown");
      }

      return {
        error: "unknown_alerts_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/alerts")
      };
    }
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/platforms",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/platforms");
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);

      if (method === "GET") {
        if (segments.length === 0) {
          return buildPlatformsResponse(config);
        }
        const platform = platformFromSegment(segments[0]);
        if (segments.length === 1 && platform) {
          return buildPlatformDetailResponse(platform, config);
        }
      }

      if (method === "POST") {
        if (segments.length === 2 && segments[0] === "x" && segments[1] === "simulate-reply") {
          const dryRunConfig = mergeResolvedConfig(config, {
            autopilot: {
              dryRun: true
            } as ArtistRuntimeConfig["autopilot"]
          } as Partial<ArtistRuntimeConfig>);
          const songId = typeof payload.songId === "string"
            ? payload.songId
            : (await listSongStates(dryRunConfig.artist.workspaceRoot))[0]?.songId;
          if (!songId) {
            return {
              result: {
                accepted: false,
                platform: "x" as const,
                dryRun: true,
                reason: "no_song_selected_for_reply_simulation"
              },
              entry: undefined
            };
          }
          return publishSocialAction({
            workspaceRoot: dryRunConfig.artist.workspaceRoot,
            songId,
            platform: "x",
            action: "reply",
            postType: "reply",
            text: typeof payload.text === "string" ? payload.text : undefined,
            targetId: typeof payload.targetId === "string" ? payload.targetId : undefined,
            targetUrl: typeof payload.targetUrl === "string" ? payload.targetUrl : undefined,
            config: dryRunConfig
          });
        }

        const platform = platformFromSegment(segments[0]);
        if (segments.length === 2 && platform && segments[1] === "test") {
          const status = await buildPlatformDetailResponse(platform, config);
          const testedAtMs = Date.now();
          if (platform === "tiktok") {
            await patchResolvedConfig(config.artist.workspaceRoot, {
              distribution: {
                platforms: {
                  tiktok: {
                    authStatus: "unconfigured",
                    liveGoArmed: false
                  }
                }
              } as unknown as ArtistRuntimeConfig["distribution"]
            } as Partial<ArtistRuntimeConfig>);
            status.authStatus = "unconfigured";
            status.lastTestedAt = undefined;
          } else {
            const authStatus = status.connected ? "tested" : "failed";
            const instagramTokenExpiresAt = status.connected
              ? config.distribution.platforms.instagram.accessTokenExpiresAt ?? testedAtMs + INSTAGRAM_DEFAULT_TOKEN_EXPIRY_MS
              : undefined;
            const platformPatch = platform === "instagram"
              ? {
                  instagram: {
                    authStatus,
                    lastTestedAt: testedAtMs,
                    ...(instagramTokenExpiresAt !== undefined ? { accessTokenExpiresAt: instagramTokenExpiresAt } : {})
                  }
                }
              : {
                  x: {
                    authStatus,
                    lastTestedAt: testedAtMs
                  }
                };
            await patchResolvedConfig(config.artist.workspaceRoot, {
              distribution: {
                platforms: platformPatch
              } as unknown as ArtistRuntimeConfig["distribution"]
            } as Partial<ArtistRuntimeConfig>);
            status.authStatus = authStatus;
            status.lastTestedAt = testedAtMs;
            if (platform === "instagram" && status.connected) {
              status.instagramTokenExpiringSoon = isInstagramTokenExpiringSoon(
                config.distribution.platforms.instagram.accessTokenExpiresAt ?? testedAtMs + INSTAGRAM_DEFAULT_TOKEN_EXPIRY_MS,
                testedAtMs
              );
            }
          }
          return {
            platform,
            status,
            testedAt: new Date(testedAtMs).toISOString()
          };
        }
        if (segments.length === 2 && platform && (segments[1] === "connect" || segments[1] === "disconnect")) {
          const nextConfig = await patchResolvedConfig(config.artist.workspaceRoot, {
            distribution: {
              platforms: {
                [platform]: { enabled: segments[1] === "connect" }
              }
            } as unknown as ArtistRuntimeConfig["distribution"]
          } as Partial<ArtistRuntimeConfig>);
          return buildPlatformDetailResponse(platform, nextConfig);
        }
      }

      return {
        error: "unknown_platforms_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/platforms")
      };
    }
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/suno",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/suno");
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);

      if (method === "GET") {
        if (segments.length === 1 && segments[0] === "status") {
          return buildSunoStatusResponse(config);
        }
        if (segments.length === 1 && segments[0] === "runs") {
          const songId = typeof payload.songId === "string"
            ? payload.songId
            : (await listSongStates(config.artist.workspaceRoot))[0]?.songId;
          return songId ? readAllSunoRuns(config.artist.workspaceRoot, songId) : [];
        }
        if (segments.length === 1 && segments[0] === "artifacts") {
          return buildSunoArtifactsPage(config.artist.workspaceRoot, payload.offset, payload.limit);
        }
        if (segments.length === 2 && segments[0] === "diagnostics" && segments[1] === "export") {
          return buildSunoDiagnosticsExportResponse(config, sunoDiagnosticsDaysFromPayload(payload));
        }
      }

      if (method === "POST") {
        if (segments.length === 2 && segments[0] === "budget" && segments[1] === "reset") {
          return new SunoBudgetTracker(config.artist.workspaceRoot).reset(
            config.music.suno.dailyCreditLimit,
            config.music.suno.monthlyCreditLimit
          );
        }
        const isBrowserWorkerAction =
          (segments.length === 1 && (segments[0] === "connect" || segments[0] === "reconnect")) ||
          (segments.length === 2 && segments[0] === "handoff" && segments[1] === "complete");
        if (isBrowserWorkerAction && config.music.suno.driver === "suno_cli") {
          // suno_cli has no browser worker to connect/reconnect/hand off to; constructing
          // one here would touch meaningless browser state. Return a diagnostic no-op
          // instead of instantiating SunoBrowserWorker.
          return {
            error: "suno_cli_driver_no_browser_handoff",
            driver: config.music.suno.driver,
            method,
            requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/suno")
          };
        }
        if (segments.length === 1 && segments[0] === "connect") {
          return new SunoBrowserWorker(config.artist.workspaceRoot, { config }).connect();
        }
        if (segments.length === 1 && segments[0] === "reconnect") {
          return new SunoBrowserWorker(config.artist.workspaceRoot, { config }).reconnect();
        }
        if (segments.length === 2 && segments[0] === "handoff" && segments[1] === "complete") {
          // Plan v10.33 Phase 4.5: 御大が `scripts/openclaw-suno-login.mjs` で artist 専用
          // user data dir に sign in した後、 worker state を "connected" に確定するための
          // 手動 signal endpoint。 driver.probe() は発火しない (御大の手動操作で sign in
          // 完了が保証される)。
          return new SunoBrowserWorker(config.artist.workspaceRoot, { config }).completeManualLoginHandoff();
        }
        if (segments.length === 2 && segments[0] === "generate") {
          return generateSunoRun({
            workspaceRoot: config.artist.workspaceRoot,
            songId: segments[1] ?? (typeof payload.songId === "string" ? payload.songId : "song-001"),
            config
          });
        }
      }

      return {
        error: "unknown_suno_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/suno")
      };
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/config/update",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const context = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      const patchRaw = (payload.patch ?? payload.config) as Partial<ArtistRuntimeConfig> | undefined;
      return patchResolvedConfig(context.artist.workspaceRoot, (patchRaw ?? {}) as Partial<ArtistRuntimeConfig>);
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/pause",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      return pauseAutopilot(config.artist.workspaceRoot, typeof payload.reason === "string" ? payload.reason : undefined);
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/resume",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      if (payload.resetState === true) {
        return new AutopilotControlService().resume(config.artist.workspaceRoot, {
          resetState: true,
          reason: typeof payload.reason === "string" ? payload.reason : undefined,
          source: "operator"
        });
      }
      return resumeAutopilot(config.artist.workspaceRoot);
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/run-cycle",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      const manualSeedPayload = payload.manualSeed as { hint?: unknown; weirdness?: unknown } | undefined;
      const manualSeed = typeof manualSeedPayload?.hint === "string"
        ? {
            hint: manualSeedPayload.hint.trim(),
            ...(typeof manualSeedPayload.weirdness === "number" && Number.isFinite(manualSeedPayload.weirdness)
              ? { weirdness: manualSeedPayload.weirdness }
              : {})
          }
        : undefined;
      const result = await getAutopilotTicker().runNow(config, manualSeed);
      return {
        ...result.state,
        tickerOutcome: result.outcome,
        tickerLastTickAt: getLastTickAt()
      };
    }
  });

}

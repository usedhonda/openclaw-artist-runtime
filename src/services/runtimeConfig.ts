import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultArtistRuntimeConfig } from "../config/defaultConfig.js";
import { migrateConfig } from "../config/migrations.js";
import { applyConfigDefaults, validateConfig } from "../config/schema.js";
import type { ArtistRuntimeConfig } from "../types.js";

function configOverridePath(root: string): string {
  return join(root, "runtime", "config-overrides.json");
}

function configOverrideBackupPath(root: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return join(root, "runtime", `config-overrides.${stamp}.bak.json`);
}

function enforceFrozenPlatformBoundaries(config: ArtistRuntimeConfig): ArtistRuntimeConfig {
  const { lastTestedAt: _lastTestedAt, ...tiktokConfig } = config.distribution.platforms.tiktok;
  return {
    ...config,
    distribution: {
      ...config.distribution,
      platforms: {
        ...config.distribution.platforms,
        tiktok: {
          ...tiktokConfig,
          authStatus: "unconfigured",
          liveGoArmed: false
        }
      }
    }
  };
}

export async function readConfigOverrides(root: string): Promise<Partial<ArtistRuntimeConfig>> {
  const contents = await readFile(configOverridePath(root), "utf8").catch(() => "");
  if (!contents) {
    return {};
  }
  return migrateConfig(JSON.parse(contents));
}

type ConfigOverridesRecord = Omit<Partial<ArtistRuntimeConfig>, "autopilot"> & {
  suno?: { dailyBudget?: unknown };
  bird?: { rateLimits?: { dailyMax?: unknown; minIntervalMinutes?: unknown } };
  autopilot?: Partial<ArtistRuntimeConfig["autopilot"]> & { intervalMinutes?: unknown };
};

export interface RuntimeSafetyOverridesPatch {
  suno?: { dailyBudget?: number };
  bird?: { rateLimits?: { dailyMax?: number; minIntervalMinutes?: number } };
  autopilot?: { intervalMinutes?: number };
}

function normalizeResolvedOverrideConfig(overrides: ConfigOverridesRecord): Partial<ArtistRuntimeConfig> {
  const { suno: _suno, bird: _bird, ...rest } = overrides;
  const autopilot = rest.autopilot
    ? { ...rest.autopilot } as Partial<ArtistRuntimeConfig["autopilot"]> & { intervalMinutes?: unknown }
    : undefined;
  if (autopilot && typeof autopilot.intervalMinutes === "number" && !("cycleIntervalMinutes" in autopilot)) {
    autopilot.cycleIntervalMinutes = autopilot.intervalMinutes;
  }
  if (autopilot && "intervalMinutes" in autopilot) {
    delete autopilot.intervalMinutes;
  }
  return {
    ...rest,
    ...(autopilot ? { autopilot } : {})
  } as Partial<ArtistRuntimeConfig>;
}

export async function readResolvedConfig(root: string): Promise<ArtistRuntimeConfig> {
  return applyRuntimeEnvOverrides(enforceFrozenPlatformBoundaries(applyConfigDefaults(normalizeResolvedOverrideConfig(await readConfigOverrides(root) as ConfigOverridesRecord))));
}

export function resolveDefaultWorkspaceRoot(): string {
  const envWorkspace = process.env.OPENCLAW_LOCAL_WORKSPACE?.trim();
  return envWorkspace || defaultArtistRuntimeConfig.artist.workspaceRoot;
}

export function isPersonaProposerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_PERSONA_PROPOSER?.trim().toLowerCase() !== "off";
}

export function isSongProposerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_SONG_PROPOSER?.trim().toLowerCase() !== "off";
}

export function isLegacyWizardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_LEGACY_WIZARD?.trim().toLowerCase() === "on";
}

export function isInlineButtonsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_INLINE_BUTTONS?.trim().toLowerCase() !== "off";
}

export function isXInlineButtonEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_X_INLINE_BUTTON?.trim().toLowerCase() !== "off";
}

export function isTelegramNotifierEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_TELEGRAM_NOTIFIER?.trim().toLowerCase() !== "off";
}

export function isDebugCallbackDispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_DEBUG_CALLBACK_DISPATCH?.trim().toLowerCase() === "on";
}

export function getPollingWatchdogMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.OPENCLAW_POLLING_WATCHDOG_MINUTES ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return 10;
  }
  return Math.max(0, parsed);
}

export function isPollingWatchdogRepromptOnceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_POLLING_WATCHDOG_REPROMPT_ONCE?.trim().toLowerCase() !== "off";
}

export function isSunoLiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const live = env.OPENCLAW_SUNO_LIVE?.trim().toLowerCase();
  const driver = env.OPENCLAW_SUNO_DRIVER?.trim().toLowerCase();
  return live === "on" || live === "1" || live === "true" || driver === "live" || driver === "playwright";
}

export function isSunoLiveDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_SUNO_LIVE?.trim().toLowerCase() === "off" || env.OPENCLAW_SUNO_DRIVER?.trim().toLowerCase() === "mock";
}

export function isSunoCdpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OPENCLAW_SUNO_USE_CDP?.trim().toLowerCase();
  return value === "on" || value === "1" || value === "true";
}

export function sunoCdpEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENCLAW_SUNO_CDP_ENDPOINT?.trim() || "http://127.0.0.1:9222";
}

export function sunoChromeProfileDest(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENCLAW_SUNO_CHROME_PROFILE_DEST?.trim() || ".openclaw-browser-profiles/suno";
}

export function sunoChromeExecutablePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.OPENCLAW_SUNO_CHROME_EXECUTABLE?.trim() || undefined;
}

export function sunoBrowserArgs(): string[] {
  return [
    "--disable-blink-features=AutomationControlled",
    "--password-store=basic"
  ];
}

export function applyRuntimeEnvOverrides(config: ArtistRuntimeConfig, env: NodeJS.ProcessEnv = process.env): ArtistRuntimeConfig {
  const next: ArtistRuntimeConfig = {
    ...config,
    autopilot: { ...config.autopilot },
    music: {
      ...config.music,
      suno: { ...config.music.suno }
    },
    distribution: {
      ...config.distribution,
      platforms: {
        x: { ...config.distribution.platforms.x },
        instagram: { ...config.distribution.platforms.instagram },
        tiktok: { ...config.distribution.platforms.tiktok }
      }
    }
  };
  if (isSunoLiveDisabled(env)) {
    next.music.suno.driver = "mock";
    next.music.suno.submitMode = "skip";
  } else if (isSunoLiveEnabled(env)) {
    next.music.suno.connectionMode = "background_browser_worker";
    next.music.suno.driver = "playwright";
    next.music.suno.submitMode = "live";
  }
  const submitMode = env.OPENCLAW_SUNO_SUBMIT_MODE?.trim().toLowerCase();
  if (!isSunoLiveDisabled(env) && (submitMode === "live" || submitMode === "skip")) {
    next.music.suno.submitMode = submitMode;
  }
  if (env.OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE?.trim().toLowerCase() === "off") {
    next.autopilot.dryRun = false;
  }
  const providerOverride = env.OPENCLAW_AI_REVIEW_PROVIDER?.trim().toLowerCase();
  if (providerOverride === "mock" || providerOverride === "openclaw" || providerOverride === "openai-codex") {
    next.aiReview = { ...config.aiReview, provider: providerOverride };
  }
  return next;
}

export function isArtistPulseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OPENCLAW_ARTIST_PULSE_ENABLED?.trim().toLowerCase();
  return value === "on" || value === "1" || value === "true";
}

export function isArtistPulseConfigured(config: Pick<ArtistRuntimeConfig, "artistPulse">, env: NodeJS.ProcessEnv = process.env): boolean {
  return isArtistPulseEnabled(env) || config.artistPulse.enabled;
}

export function isCommissionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OPENCLAW_COMMISSION_ENABLED?.trim().toLowerCase();
  return value === "on" || value === "1" || value === "true";
}

export function isCommissionConfigured(config: Pick<ArtistRuntimeConfig, "commission">, env: NodeJS.ProcessEnv = process.env): boolean {
  return isCommissionEnabled(env) || config.commission.enabled;
}

export function isSongSpawnEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OPENCLAW_SONG_SPAWN_ENABLED?.trim().toLowerCase();
  return value === "on" || value === "1" || value === "true";
}

export function isSongSpawnConfigured(config: Pick<ArtistRuntimeConfig, "songSpawn">, env: NodeJS.ProcessEnv = process.env): boolean {
  return isSongSpawnEnabled(env) || config.songSpawn.enabled;
}

export function isSongbookAutoSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OPENCLAW_SONGBOOK_AUTO_SYNC?.trim().toLowerCase();
  return value === "on" || value === "1" || value === "true";
}

export function getArtistPulseIntervalHours(
  env: NodeJS.ProcessEnv = process.env,
  config?: Pick<ArtistRuntimeConfig, "artistPulse">
): number {
  const parsed = Number.parseInt(env.OPENCLAW_ARTIST_PULSE_HOURS ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return Math.max(6, config?.artistPulse.minIntervalHours ?? 12);
  }
  return Math.max(6, parsed);
}

export function getSongSpawnIntervalHours(
  env: NodeJS.ProcessEnv = process.env,
  config?: Pick<ArtistRuntimeConfig, "songSpawn">
): number {
  const parsed = Number.parseInt(env.OPENCLAW_SONG_SPAWN_HOURS ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return Math.max(12, config?.songSpawn.minIntervalHours ?? 24);
  }
  return Math.max(12, parsed);
}

function positiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

export async function resolveSunoDailyBudget(
  root: string = resolveDefaultWorkspaceRoot(),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const envBudget = positiveNumber(env.OPENCLAW_SUNO_DAILY_BUDGET);
  if (envBudget !== undefined) {
    return envBudget;
  }
  const overrides = await readConfigOverrides(root);
  const rawSuno = (overrides as { suno?: { dailyBudget?: unknown } }).suno;
  const overrideBudget = positiveNumber(rawSuno?.dailyBudget);
  return overrideBudget ?? 50;
}

function deepMergeRuntimeOverrides(current: ConfigOverridesRecord, patch: RuntimeSafetyOverridesPatch): ConfigOverridesRecord {
  return {
    ...current,
    suno: {
      ...current.suno,
      ...patch.suno
    },
    bird: {
      ...current.bird,
      ...(patch.bird ? {
        rateLimits: {
          ...current.bird?.rateLimits,
          ...patch.bird.rateLimits
        }
      } : {})
    },
    autopilot: {
      ...current.autopilot,
      ...patch.autopilot
    }
  };
}

async function writeOverridesFile(root: string, value: unknown): Promise<void> {
  const path = configOverridePath(root);
  const runtimeDir = dirname(path);
  await mkdir(runtimeDir, { recursive: true });
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing) {
    await copyFile(path, configOverrideBackupPath(root)).catch(() => undefined);
  }
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

export async function writeRuntimeSafetyOverrides(root: string, patch: RuntimeSafetyOverridesPatch): Promise<ConfigOverridesRecord> {
  const current = await readConfigOverrides(root) as ConfigOverridesRecord;
  const next = deepMergeRuntimeOverrides(current, patch);
  await writeOverridesFile(root, next);
  return next;
}

function isRelativeWorkspaceRoot(value: string): boolean {
  return value === "." || value === "./" || value === "" || value.startsWith("./") || value.startsWith("../");
}

export async function resolveRuntimeConfig(
  payloadConfig?: Partial<ArtistRuntimeConfig>,
  fallbackWorkspaceRoot: string = resolveDefaultWorkspaceRoot()
): Promise<ArtistRuntimeConfig> {
  const workspaceRoot = payloadConfig?.artist?.workspaceRoot ?? fallbackWorkspaceRoot;
  const persisted = await readResolvedConfig(workspaceRoot);
  const normalizedPersisted = isRelativeWorkspaceRoot(persisted.artist.workspaceRoot)
    ? { ...persisted, artist: { ...persisted.artist, workspaceRoot } }
    : persisted;
  return applyRuntimeEnvOverrides(payloadConfig ? mergeResolvedConfig(normalizedPersisted, payloadConfig) : normalizedPersisted);
}

export function mergeResolvedConfig(current: ArtistRuntimeConfig, patch: Partial<ArtistRuntimeConfig>): ArtistRuntimeConfig {
  return enforceFrozenPlatformBoundaries(applyConfigDefaults({
    ...current,
    ...patch,
    schemaVersion: patch.schemaVersion ?? current.schemaVersion,
    artist: { ...current.artist, ...patch.artist },
    autopilot: { ...current.autopilot, ...patch.autopilot },
    music: {
      ...current.music,
      ...patch.music,
      suno: { ...current.music.suno, ...patch.music?.suno }
    },
    distribution: {
      ...current.distribution,
      ...patch.distribution,
      platforms: {
        x: { ...current.distribution.platforms.x, ...patch.distribution?.platforms?.x },
        instagram: { ...current.distribution.platforms.instagram, ...patch.distribution?.platforms?.instagram },
        tiktok: { ...current.distribution.platforms.tiktok, ...patch.distribution?.platforms?.tiktok }
      }
    },
    artistPulse: { ...current.artistPulse, ...patch.artistPulse },
    safety: { ...current.safety, ...patch.safety }
  }));
}

export async function writeConfigOverrides(root: string, config: ArtistRuntimeConfig): Promise<ArtistRuntimeConfig> {
  const validation = validateConfig(enforceFrozenPlatformBoundaries(config));
  if (!validation.ok || !validation.value) {
    throw new Error(`invalid config: ${validation.errors.join("; ")}`);
  }
  await writeOverridesFile(root, validation.value);
  return validation.value;
}

export async function patchResolvedConfig(root: string, patch: Partial<ArtistRuntimeConfig>): Promise<ArtistRuntimeConfig> {
  const current = await readResolvedConfig(root);
  const merged = mergeResolvedConfig(current, patch);
  return writeConfigOverrides(root, merged);
}

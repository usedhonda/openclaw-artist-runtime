export const producerDigestModes = ["off", "daily", "important_events", "high_touch"] as const;
export const sunoConnectionModes = ["manual_copy", "background_browser_worker", "api_provider"] as const;
export const sunoDriverModes = ["mock", "playwright"] as const;
export const sunoSubmitModes = ["skip", "live"] as const;
export const sunoAuthorityModes = ["prepare_only", "autofill_only", "auto_create_with_budget", "auto_create_and_select_take"] as const;
export const dailySharingModes = ["off", "draft_only", "auto"] as const;
export const officialReleaseModes = ["manual_approval", "auto_with_release_policy"] as const;
export const xAuthorityModes = ["draft_only", "auto_publish", "auto_publish_and_low_risk_replies"] as const;
export const instagramAuthorityModes = ["draft_only", "auto_publish_visuals"] as const;
export const tiktokAuthorityModes = ["draft_only", "auto_publish_clips"] as const;
export const socialAuthorityModes = [
  "disabled",
  "draft_only",
  "auto_publish",
  "auto_publish_and_low_risk_replies",
  "auto_publish_visuals",
  "auto_publish_clips",
  "auto_posts_and_low_risk_replies",
  "full_social_autonomy"
] as const;
export const socialRiskLevels = ["low", "medium", "high"] as const;
export const capabilityStates = [true, false, "unknown"] as const;
export const platformAuthStatuses = ["unconfigured", "configured", "tested", "failed"] as const;
export const aiReviewProviders = ["mock", "openclaw", "openai-codex"] as const;
export const sunoWorkerStates = ["disconnected", "connecting", "connected", "generating", "importing", "login_required", "login_challenge", "captcha", "payment_prompt", "ui_mismatch", "quota_exhausted", "paused", "stopped"] as const;
export const autopilotStages = ["idle", "planning", "prompt_pack", "suno_generation", "take_selection", "asset_generation", "publishing", "completed", "paused", "failed_closed"] as const;
export const songStatuses = ["idea", "brief", "lyrics", "suno_prompt_pack", "suno_running", "takes_imported", "take_selected", "social_assets", "scheduled", "published", "archived", "failed"] as const;
export const sunoRunStatuses = ["blocked_dry_run", "blocked_authority", "accepted", "imported", "failed"] as const;
export const songUpdateFields = [
  "title",
  "brief",
  "style",
  "lyrics",
  "status",
  "publicLinksSpotify",
  "publicLinksAppleMusic",
  "publicLinksYoutubeMusic",
  "publicLinksOther",
  "selectedTake",
  "notes",
  "nextAction"
] as const;
export const alertSeverities = ["info", "warning", "critical"] as const;
export const setupChecklistStates = ["complete", "pending", "attention"] as const;
export const sunoLoginHandoffStates = ["waiting_for_operator", "completed"] as const;

export type ProducerDigestMode = (typeof producerDigestModes)[number];
export type SunoConnectionMode = (typeof sunoConnectionModes)[number];
export type SunoDriverMode = (typeof sunoDriverModes)[number];
export type SunoSubmitMode = (typeof sunoSubmitModes)[number];
export type SunoAuthority = (typeof sunoAuthorityModes)[number];
export type DailySharingMode = (typeof dailySharingModes)[number];
export type OfficialReleaseMode = (typeof officialReleaseModes)[number];
export type XAuthority = (typeof xAuthorityModes)[number];
export type InstagramAuthority = (typeof instagramAuthorityModes)[number];
export type TikTokAuthority = (typeof tiktokAuthorityModes)[number];
export type SocialAuthorityMode = (typeof socialAuthorityModes)[number];
export type SocialRiskLevel = (typeof socialRiskLevels)[number];
export type SocialPlatform = "x" | "instagram" | "tiktok";
export type CapabilityState = (typeof capabilityStates)[number];
export type PlatformAuthStatus = (typeof platformAuthStatuses)[number];
export type AiReviewProvider = (typeof aiReviewProviders)[number];
export type SunoWorkerState = (typeof sunoWorkerStates)[number];
export type AutopilotStage = (typeof autopilotStages)[number];
export type SongStatus = (typeof songStatuses)[number];
export type SunoRunStatus = (typeof sunoRunStatuses)[number];
export type SongUpdateField = (typeof songUpdateFields)[number];
export type AlertSeverity = (typeof alertSeverities)[number];
export type SetupChecklistState = (typeof setupChecklistStates)[number];
export type SunoLoginHandoffState = (typeof sunoLoginHandoffStates)[number];

export interface ArtistConfig {
  mode: "public_artist";
  artistId: string;
  profilePath: string;
  workspaceRoot: string;
}

export interface AutopilotConfig {
  enabled: boolean;
  dryRun: boolean;
  songsPerWeek: number;
  cycleIntervalMinutes: number;
  planningTimeoutDays: number;
  producerDigest: ProducerDigestMode;
}

export interface SunoMusicConfig {
  enabled: boolean;
  connectionMode: SunoConnectionMode;
  driver: SunoDriverMode;
  submitMode: SunoSubmitMode;
  authority: SunoAuthority;
  dailyCreditLimit: number;
  monthlyCreditLimit: number;
  monthlyGenerationBudget: number;
  maxGenerationsPerDay: number;
  minMinutesBetweenCreates: number;
  stopOnLoginChallenge: boolean;
  stopOnCaptcha: boolean;
  stopOnPaymentPrompt: boolean;
  promptLogging: "full";
}

export interface MusicConfig {
  engine: "suno";
  suno: SunoMusicConfig;
}

export interface XPlatformConfig {
  enabled: boolean;
  liveGoArmed: boolean;
  authStatus: PlatformAuthStatus;
  lastTestedAt?: number;
  connector: "bird";
  authority: XAuthority;
  maxPostsPerDay: number;
  maxRepliesPerDay: number;
  autoPostTypes: string[];
}

export interface InstagramPlatformConfig {
  enabled: boolean;
  liveGoArmed: boolean;
  authStatus: PlatformAuthStatus;
  lastTestedAt?: number;
  liveRehearsalArmed: boolean;
  accessTokenExpiresAt?: number;
  connector: "instagram_content_publishing";
  authority: InstagramAuthority;
  maxPostsPerDay: number;
  autoPostTypes: string[];
}

export interface TikTokPlatformConfig {
  enabled: boolean;
  liveGoArmed: boolean;
  authStatus: PlatformAuthStatus;
  lastTestedAt?: number;
  connector: "tiktok_content_posting";
  authority: TikTokAuthority;
  maxPostsPerDay: number;
  autoPostTypes: string[];
}

export interface DistributionConfig {
  enabled: boolean;
  liveGoArmed: boolean;
  dailySharing: DailySharingMode;
  officialRelease: OfficialReleaseMode;
  platforms: {
    x: XPlatformConfig;
    instagram: InstagramPlatformConfig;
    tiktok: TikTokPlatformConfig;
  };
}

export interface SafetyConfig {
  auditLog: boolean;
  failClosed: boolean;
  forbiddenTopics: string[];
  forbidCaptchaBypass: boolean;
  forbidCredentialLogging: boolean;
  requireApprovalForHighRisk: boolean;
}

export interface TelegramConfig {
  enabled: boolean;
  pollIntervalMs: number;
  notifyStages: boolean;
  acceptFreeText: boolean;
}

export interface ArtistPulseConfig {
  enabled: boolean;
  minIntervalHours: number;
}

export interface CommissionConfig {
  enabled: boolean;
}

export interface SongSpawnConfig {
  enabled: boolean;
  minIntervalHours: number;
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramChat {
  id: number;
  type?: string;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type TelegramInlineKeyboard = TelegramInlineKeyboardButton[][];

export interface TelegramReplyMarkup {
  inline_keyboard?: TelegramInlineKeyboard;
}

export type PersonaField =
  | "artistName"
  | "identityLine"
  | "soundDna"
  | "obsessions"
  | "lyricsRules"
  | "socialVoice"
  | "soul-tone"
  | "soul-refusal";

export type TelegramPersonaSessionMode = "reset_confirm" | "migrate_confirm";

export interface PersonaAnswers {
  artistName: string;
  identityLine: string;
  soundDna: string;
  obsessions: string;
  lyricsRules: string;
  socialVoice: string;
  conversationTone: string;
  refusalStyle: string;
}

export interface TelegramPersonaSessionHistoryEntry {
  stepIndex: number;
  field: PersonaField;
  previous?: string;
}

export interface TelegramPersonaSessionDraft {
  field: PersonaField;
  draft: string;
  reasoning?: string;
  status: "proposed" | "skipped" | "low_confidence";
}

export interface TelegramPersonaSessionPending extends Partial<PersonaAnswers> {
  aiDrafts?: TelegramPersonaSessionDraft[];
}

export interface TelegramPersonaSession {
  active: boolean;
  mode: TelegramPersonaSessionMode;
  stepIndex: number;
  aiReviewProvider?: AiReviewProvider;
  migrateIntent?: string;
  migrateAiReviewProvider?: AiReviewProvider;
  pending: TelegramPersonaSessionPending;
  history: TelegramPersonaSessionHistoryEntry[];
  startedAt: number;
  updatedAt: number;
  chatId: number;
  userId: number;
  expiresAt: number;
}

export interface DailyVoiceDraft {
  voiceKind: "quote" | "musing" | "studio_whisper";
  draftText: string;
  draftHash: string;
  charCount: number;
  sourceFragments: string[];
  selectedSource?: { url?: string; author?: string };
  rationale?: string;
  createdAt: string;
}

export interface CommissionBrief {
  songId: string;
  title: string;
  brief: string;
  lyricsTheme: string;
  mood: string;
  tempo: string;
  styleNotes: string;
  duration: string;
  sourceText: string;
  createdAt: string;
}

export interface CommissionResult {
  proposalId: string;
  commissionBrief: CommissionBrief;
  warnings: string[];
}

export interface SpawnProposal {
  spawn: boolean;
  brief: CommissionBrief;
  reason: string;
  candidateSongId: string;
}

export interface ArtistPulseState {
  lastPulseAt?: string;
  updatedAt: string;
}

export interface SongSpawnState {
  lastSpawnAt?: string;
  updatedAt: string;
}

export interface PlanningSkeletonDraft {
  songId: string;
  complete: boolean;
  missing: string[];
  completedBrief?: string;
  proposalId?: string;
}

export interface AiReviewConfig {
  provider: AiReviewProvider;
}

export interface ArtistRuntimeConfig {
  schemaVersion: number;
  artist: ArtistConfig;
  autopilot: AutopilotConfig;
  music: MusicConfig;
  distribution: DistributionConfig;
  telegram: TelegramConfig;
  artistPulse: ArtistPulseConfig;
  commission: CommissionConfig;
  songSpawn: SongSpawnConfig;
  aiReview: AiReviewConfig;
  safety: SafetyConfig;
}

export interface DebugAiReviewInput {
  songId: string;
  title: string;
  brief?: string;
  lyrics?: string;
  takes: unknown[];
  selectedTake?: unknown;
  promptPackSummary?: unknown;
}

export interface DebugAiReviewResult {
  songId: string;
  score: number;
  summary: string;
  reasons: string[];
  cautions: string[];
  provider: AiReviewProvider | "not_configured";
  createdAt: string;
  outputPath?: string;
}

export interface ValidationResult<T = void> {
  ok: boolean;
  errors: string[];
  warnings?: string[];
  value?: T;
}

export interface AuthorityDecision {
  allowed: boolean;
  reason: string;
  requiresApproval?: boolean;
  hardStop?: boolean;
  policyDecision?: string;
}

export interface VerificationResult {
  status: "verified" | "pending" | "failed";
  detail?: string;
}

export interface SerializedError {
  name: string;
  message: string;
}

export interface PromptLedgerEntry {
  id: string;
  timestamp: string;
  stage: string;
  songId?: string;
  runId?: string;
  actor?: "artist" | "producer" | "system" | "connector";
  artistReason?: string;
  inputRefs?: string[];
  outputRefs?: string[];
  promptText?: string;
  promptHash?: string;
  outputSummary?: string;
  outputHash?: string;
  payloadHash?: string;
  configSnapshot?: unknown;
  artistSnapshotHash?: string;
  currentStateHash?: string;
  knowledgePackHash?: string;
  policyDecision?: AuthorityDecision;
  verification?: VerificationResult;
  error?: SerializedError;
}

export interface SongStateImportOutcome {
  runId: string;
  urlCount: number;
  pathCount?: number;
  paths?: string[];
  failedUrls?: SunoImportFailedUrl[];
  reason?: string;
  at: string;
  dryRun?: boolean;
}

export interface ObservationSummary {
  author?: string;
  url?: string;
  quote?: string;
  motivation?: string;
}

export interface SongState {
  songId: string;
  title: string;
  status: SongStatus;
  createdAt: string;
  updatedAt: string;
  briefPath?: string;
  lyricsVersion?: number;
  selectedTakeId?: string;
  publicLinks: string[];
  runCount: number;
  lastReason?: string;
  lastImportOutcome?: SongStateImportOutcome;
  degradedLyrics?: boolean;
  observationSummary?: ObservationSummary;
}

export interface SongIdeaResult {
  songId: string;
  title: string;
  briefPath: string;
  status: SongStatus;
  artistReason: string;
  ledgerEntryIds: string[];
}

export interface AuditEvent {
  timestamp: string;
  eventType: string;
  actor: "artist" | "producer" | "system" | "connector";
  sourceRefs?: string[];
  policyDecision?: AuthorityDecision;
  verification?: VerificationResult;
  error?: SerializedError;
  details?: Record<string, unknown>;
}

export interface JsonlHealth {
  healthy: boolean;
  lineCount: number;
  errors: string[];
}

export interface ConnectionStatus {
  connected: boolean;
  accountLabel?: string;
  reason?: string;
}

export interface SocialCapability {
  textPost: CapabilityState;
  imagePost: CapabilityState;
  videoPost: CapabilityState;
  carouselPost: CapabilityState;
  reelPost: CapabilityState;
  reply: CapabilityState;
  quote: CapabilityState;
  dm: CapabilityState;
  scheduledPost: CapabilityState;
  metrics: CapabilityState;
}

export interface SocialPublishRequest {
  dryRun: boolean;
  authority: SocialAuthorityMode;
  postType: string;
  text?: string;
  mediaPaths?: string[];
  targetId?: string;
  targetUrl?: string;
  globalLiveGoArmed?: boolean;
  platformLiveGoArmed?: boolean;
  liveRehearsalArmed?: boolean;
  liveRehearsalExplicitGo?: boolean;
}

export interface SocialPublishResult {
  accepted: boolean;
  platform: SocialPlatform;
  dryRun: boolean;
  reason: string;
  id?: string;
  url?: string;
  raw?: unknown;
}

export interface SocialPublishLedgerEntry {
  timestamp: string;
  platform: SocialPlatform;
  connector: string;
  songId: string;
  postType: string;
  action: "publish" | "reply";
  accepted: boolean;
  dryRun: boolean;
  textHash?: string;
  mediaRefs: string[];
  policyDecision?: AuthorityDecision;
  url?: string;
  verification?: VerificationResult;
  error?: SerializedError;
  reason: string;
  replyTarget?: ReplyTargetAudit;
}

export interface ReplyTargetAudit {
  type: "reply";
  targetId?: string;
  resolvedFrom?: string;
  resolutionReason?: string;
  dryRun: boolean;
  timestamp: string;
  mentionedHandles?: string[];
  tweetId?: string;
}

export interface DistributionEvent extends SocialPublishLedgerEntry {
  songId: string;
}

export interface PlatformStat {
  platform: SocialPlatform;
  count7d: number;
  accepted7d: number;
  successRate: number;
  failedReasons: Record<string, number>;
  dailyCounts: number[];
}

export interface SocialAssetRecord {
  songId: string;
  platform: SocialPlatform;
  postType: string;
  textPath: string;
  mediaRefs: string[];
  sourceTakeId?: string;
}

export interface PlatformStatus {
  connected: boolean;
  authority: string;
  authStatus?: PlatformAuthStatus;
  lastTestedAt?: number;
  liveGoArmed?: boolean;
  effectiveDryRun?: boolean;
  capabilitySummary: SocialCapability;
  accountLabel?: string;
  postsToday?: number;
  repliesToday?: number;
  lastAction?: SocialPublishLedgerEntry;
  reason?: string;
  instagramTokenExpiringSoon?: boolean;
}

export interface MusicSummary {
  monthlyGenerationBudget: number;
  monthlyRuns: number;
  dailyRuns: number;
  latestPromptPackVersion?: number;
  latestPromptPackMetadata?: Record<string, unknown>;
}

export interface SunoBudgetStatus {
  date: string;
  used?: number;
  consumed: number;
  limit: number;
  remaining: number;
  lastResetAt?: string;
  resetHistory?: SunoBudgetResetEntry[];
  monthly: {
    month: string;
    consumed: number;
    limit: number;
    remaining: number;
    unlimited: boolean;
  };
}

export interface SunoBudgetResetEntry {
  timestamp: string;
  consumedBefore: number;
  reason: string;
}

export interface SunoArtifactIndexEntry {
  runId: string;
  songId?: string;
  path: string;
  size: number;
  format: "mp3" | "m4a";
  createdAt: string;
}

export interface SunoArtifactsPageResponse {
  artifacts: SunoArtifactIndexEntry[];
  totalCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface SunoDiagnosticsImportOutcome {
  songId: string;
  runId: string;
  urlCount: number;
  pathCount?: number;
  paths?: string[];
  failedUrls?: SunoImportFailedUrl[];
  reason?: string;
  at: string;
  dryRun?: boolean;
}

export interface SunoDiagnosticsExportResponse {
  generatedAt: string;
  days: number;
  profile: {
    state: SunoWorkerState;
    connected: boolean;
    stale?: boolean;
    detail?: string;
    checkedAt?: string;
  };
  budgetResetHistory: SunoBudgetResetEntry[];
  importOutcomes: SunoDiagnosticsImportOutcome[];
}

export type SunoImportFailureReason = "404" | "network" | "extraction_failed";

export interface SunoImportFailedUrl {
  url: string;
  reason: SunoImportFailureReason;
}

export interface DistributionSummary {
  postsToday: number;
  repliesToday: number;
  lastPlatform?: SocialPlatform;
  lastPostUrl?: string;
}

export interface RuntimeStatusSummary {
  allPlatformsEffectivelyDryRun: boolean;
  effectiveDryRunMap: Record<SocialPlatform, boolean>;
}

export interface SetupChecklistItem {
  id: string;
  label: string;
  state: SetupChecklistState;
  detail: string;
}

export interface SetupReadiness {
  completeCount: number;
  totalCount: number;
  readyForAutopilot: boolean;
  nextRecommendedAction: string;
  checklist: SetupChecklistItem[];
}

export interface SocialDistributionWorkerStatus {
  enabled: boolean;
  dryRun: boolean;
  liveGoArmed: boolean;
  platformLiveGoArmed: Record<SocialPlatform, boolean>;
  effectiveDryRun: Record<SocialPlatform, boolean>;
  lastSongId?: string;
  lastAction?: SocialPublishLedgerEntry;
  enabledPlatforms: SocialPlatform[];
  blockedReason?: string;
  postsToday: number;
  repliesToday: number;
}

export interface SunoLoginHandoff {
  state: SunoLoginHandoffState;
  reason: "operator_login_required" | "reconnect_requested" | "login_challenge" | "captcha" | "payment_prompt";
  message: string;
  requestedAt: string;
  completedAt?: string;
}

export interface SunoWorkerStatus {
  state: SunoWorkerState;
  connected: boolean;
  hardStopReason?: string;
  lastTransitionAt?: string;
  sunoProfileStale?: boolean;
  sunoProfileDetail?: string;
  sunoProfileCheckedAt?: string;
  failureCount?: number;
  pendingAction?: string;
  loginHandoff?: SunoLoginHandoff;
  currentRunId?: string;
  lastImportedRunId?: string;
  lastCreateOutcome?: {
    runId: string;
    accepted: boolean;
    reason: string;
    at: string;
    dryRun?: boolean;
  };
  lastImportOutcome?: {
    runId: string;
    urlCount: number;
    pathCount?: number;
    paths?: string[];
    metadata?: SunoImportedAssetMetadata[];
    failedUrls?: SunoImportFailedUrl[];
    reason?: string;
    at: string;
    dryRun?: boolean;
  };
}

export interface SunoCreatePayload {
  /**
   * Primary Suno lyrics payload. This is the UI textarea body only, with YAML
   * META and lyrics boundary markers removed.
   */
  lyrics?: string;
  /**
   * Full Suno payload YAML retained for ledger and persistence. This is not
   * intended to be pasted into the Suno lyrics textarea.
   */
  payloadYaml?: string;
  /**
   * Driver fallback only. Phase 4 writes this from lyrics-suno.md: plain lyrics
   * plus section metatags, without YAML META. Used only when payload.lyrics is
   * absent or blank.
   */
  lyricsText?: string;
  [key: string]: unknown;
}

export interface SunoCreateRequest {
  dryRun: boolean;
  authority: SunoAuthority;
  payload: SunoCreatePayload;
  songId?: string;
  runId?: string;
  payloadHash?: string;
}

export interface SunoCreateResult {
  accepted: boolean;
  runId: string;
  reason: string;
  urls: string[];
  dryRun?: boolean;
}

export interface SunoImportRequest {
  runId: string;
  urls: string[];
}

export interface SunoImportResult {
  accepted?: boolean;
  urls: string[];
  paths?: string[];
  metadata?: SunoImportedAssetMetadata[];
  failedUrls?: SunoImportFailedUrl[];
  runId?: string;
  selectedTakeId?: string;
  importedAt?: string;
  reason?: string;
  dryRun?: boolean;
}

export interface SunoImportedAssetMetadata {
  url: string;
  path: string;
  format: "mp3" | "m4a";
  title?: string;
  durationSec?: number;
}

export interface SunoRunRecord {
  runId: string;
  songId: string;
  createdAt: string;
  mode: SunoConnectionMode;
  authorityDecision: AuthorityDecision;
  payloadHash?: string;
  status: SunoRunStatus;
  dryRun: boolean;
  urls: string[];
  error?: SerializedError;
}

export interface TakeSelectionRecord {
  songId: string;
  runId: string;
  selectedTakeId: string;
  reason: string;
  sourceUrls: string[];
  verification: VerificationResult;
  createdAt?: string;
}

export interface SunoSliders {
  weirdness: number;
  styleInfluence: number;
  audioInfluence: number;
}

export interface SunoPromptPackValidation {
  valid: boolean;
  errors: string[];
}

export interface SunoPromptPack {
  songId: string;
  songTitle: string;
  artistReason: string;
  lyricsBundle?: {
    lyricsText: string;
    yamlLyrics: string;
    moodHint?: string;
  };
  style: string;
  exclude: string;
  yamlLyrics: string;
  sliders: SunoSliders;
  payload: Record<string, unknown>;
  validation: SunoPromptPackValidation;
  promptHash: string;
  payloadHash: string;
  artistSnapshotHash: string;
  currentStateHash: string;
  knowledgePackHash: string;
}

export interface CreateSunoPromptPackInput {
  songId: string;
  songTitle: string;
  artistReason: string;
  lyricsText: string;
  artistSnapshot: string;
  currentStateSnapshot: string;
  knowledgePackVersion?: string;
  moodHint?: string;
}

export interface PersistSunoPromptPackInput extends Omit<CreateSunoPromptPackInput, "artistSnapshot" | "currentStateSnapshot"> {
  workspaceRoot: string;
  artistSnapshot?: string;
  currentStateSnapshot?: string;
  configSnapshot?: unknown;
  observationPath?: string;
  observationSummary?: ObservationSummary;
  aiReviewProvider?: AiReviewProvider;
}

export interface PersistedPromptPackResult {
  songId: string;
  packVersion: number;
  pack: SunoPromptPack;
  artifactPaths: {
    lyricsVersioned: string;
    yamlLatest: string;
    lyricsSunoLatest: string;
    styleLatest: string;
    excludeLatest: string;
    slidersLatest: string;
    payloadLatest: string;
    validationLatest: string;
    snapshotDir: string;
    promptLedger: string;
  };
  ledgerEntryIds: string[];
}

export interface MusicAuthorityInput {
  dryRun: boolean;
  authority: SunoAuthority;
  budgetRemaining: number;
  connectionMode?: SunoConnectionMode;
  workerState?: SunoWorkerState;
  requestedAction: "prepare" | "create" | "select_take";
}

export interface SocialAuthorityInput {
  dryRun: boolean;
  authority: SocialAuthorityMode;
  platform: SocialPlatform;
  risk: SocialRiskLevel;
  postType: string;
  requestedAction?: "publish" | "reply";
  capabilityAvailable?: CapabilityState;
}

export interface AutopilotStatus {
  enabled: boolean;
  dryRun: boolean;
  stage: AutopilotStage;
  nextAction: string;
  currentRunId?: string;
  currentSongId?: string;
  lastSuccessfulStage?: AutopilotStage;
  pausedReason?: string | null;
  hardStopReason?: string | null;
  blockedReason?: string | null;
  lastError?: string | null;
  retryCount?: number;
}

export interface AutopilotRunState {
  runId?: string;
  currentSongId?: string;
  stage: AutopilotStage;
  paused: boolean;
  pausedReason?: string | null;
  hardStopReason?: string | null;
  blockedReason?: string | null;
  lastError?: string | null;
  lastSuccessfulStage?: AutopilotStage;
  retryCount: number;
  cycleCount: number;
  updatedAt: string;
  lastRunAt?: string;
}

export interface AutopilotTickerStatus {
  lastOutcome?: string;
  lastTickAt?: string;
  intervalMs: number;
}

export interface AlertRecord {
  id: string;
  severity: AlertSeverity;
  source: "autopilot" | "suno_worker" | "platform" | "prompt_ledger" | "social_ledger" | "audit_log";
  scope: "global" | "song";
  message: string;
  songId?: string;
  detail?: string;
  createdAt: string;
  ackedAt?: string;
}

export interface StatusResponse {
  config: ArtistRuntimeConfig;
  dryRun: boolean;
  summary: RuntimeStatusSummary;
  autopilot: AutopilotStatus;
  ticker: AutopilotTickerStatus;
  suno: {
    budget: SunoBudgetStatus;
    budgetDetail?: {
      todayCalls: Array<{
        timestamp: string;
        amount: number;
        kind: "consume";
      }>;
      lastResetAt: string;
      remaining: number;
      used: number;
      limit: number;
    };
    artifacts: SunoArtifactIndexEntry[];
    profile?: {
      stale?: boolean;
      detail?: string;
      checkedAt?: string;
    };
  };
  sunoWorker: SunoWorkerStatus;
  distributionWorker: SocialDistributionWorkerStatus;
  bird?: {
    rateLimit: {
      todayCalls: number;
      dailyMax: number;
      minIntervalMinutes: number;
      cooldownUntil?: string;
      cooldownReason?: string;
      nextAllowedAt?: string;
    };
    ledger?: {
      todayCalls: Array<{
        timestamp: string;
        query?: string;
        mode?: string;
      }>;
      cooldown: {
        until?: string;
        reason?: string;
      };
      nextAllowedAt?: string;
    };
  };
  distribution?: {
    detected: {
      unitedMasters?: { url?: string; detectedAt?: string; lastCheckedAt?: string };
      spotify?: { url?: string; detectedAt?: string; lastCheckedAt?: string };
      appleMusic?: { url?: string; detectedAt?: string; lastCheckedAt?: string };
    };
  };
  pendingApprovals?: {
    count: number;
    recent: Array<{
      id: string;
      domain: "persona" | "song";
      summary: string;
      fieldCount: number;
      createdAt: string;
    }>;
  };
  platforms: Record<SocialPlatform, PlatformStatus>;
  musicSummary: MusicSummary;
  distributionSummary: DistributionSummary;
  recentDistributionEvents: DistributionEvent[];
  platformStats: Record<SocialPlatform, PlatformStat>;
  runtimeEvents?: unknown[];
  setupReadiness: SetupReadiness;
  alerts: AlertRecord[];
  recentSong?: SongState;
  lastSunoRun?: SunoRunRecord;
  lastSocialAction?: SocialPublishLedgerEntry;
}

export type ObservabilityExportWindow = "7d" | "30d" | "all";

export interface StatusExportResponse {
  window: ObservabilityExportWindow;
  exportedAt: string;
  status: StatusResponse;
  ledger: {
    events: DistributionEvent[];
    platformStats: Record<SocialPlatform, PlatformStat>;
  };
}

export interface SunoStatusResponse {
  worker: SunoWorkerStatus;
  currentSongId?: string;
  latestRun?: SunoRunRecord;
  recentRuns: SunoRunRecord[];
  latestPromptPackVersion?: number;
  latestPromptPackMetadata?: unknown;
  artifacts?: SunoArtifactIndexEntry[];
  currentRunId?: string;
  lastImportedRunId?: string;
  lastCreateOutcome?: SunoWorkerStatus["lastCreateOutcome"];
  lastImportOutcome?: SunoWorkerStatus["lastImportOutcome"];
}

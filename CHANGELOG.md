# Changelog

## [Unreleased]

### Added
- Distribution-grade Suno browser + captcha human-assist. The plugin now owns the
  Suno browser lifecycle via a new `SunoBrowserService` (launches the single
  persistent `suno` profile with an ephemeral `--remote-debugging-port=0` derived
  from `DevToolsActivePort`), so there is no manual `start-chrome-cdp.sh`, fixed
  9222 port, or `OPENCLAW_SUNO_USE_CDP` opt-in required for the `human_click`
  fallback. Browser knobs are promoted to config `music.suno.browser.{profileDir,
  executablePath, channel, cdpEndpoint}` with the `OPENCLAW_SUNO_*` env vars kept
  as backward-compatible fallbacks; setting `cdpEndpoint` attaches to an existing
  Chrome instead of launching. The suno-cli tool is vendored under
  `vendor/suno-cli/` and its entry auto-resolves (`music.suno.cliEntry` config >
  `OPENCLAW_SUNO_CLI_ENTRY` env > bundled vendor), removing the absolute-path
  requirement; re-sync with `scripts/sync-suno-cli-vendor.sh`. Producer Console
  connect/reconnect/handoff now work for the `suno_cli` driver (the browser opens
  for operator login and releases on handoff), and the Room shows a human-assist
  "press Create" card. Boot/status stay read-only (no browser launch). New npm
  dependencies: none.
- P2c consolidates Suno budget controls around credit budgeting. The legacy
  `suno.dailyBudget` / `OPENCLAW_SUNO_DAILY_BUDGET` generation-count gate is
  ignored; daily create count is controlled by `music.suno.maxGenerationsPerDay`
  and live Suno credit spend is controlled by `music.suno.dailyCreditLimit`.
  Existing stale `runtime/config-overrides.json` `suno.dailyBudget` entries no
  longer enforce a stop.
- Plan v9.15 Phase 4f enables Telegram-confirmed X posting for completed songs. Completed-song pushes can show `[▶ X 投稿準備]`, generate an artist-voice draft with hash/char-count preview, confirm through Bird (`bird whoami --plain` then `bird --plain tweet <text>`), and reflect the returned tweet URL into SONGBOOK. `OPENCLAW_X_INLINE_BUTTON=off` hides the button and makes old callbacks fail closed. IG/TikTok buttons remain excluded; publish gates, `liveGoArmed`, and `autopilot.dryRun=false` remain untouched. New npm dependencies: none.
- Plan v9.15 Phase A mirrors existing Telegram callback actions in the Producer Console. Distribution URL proposals still use `/api/proposals/:id/yes|no`, and completed-song actions now have `/api/songs/:id/songbook-write|songbook-skip` so the UI can reflect SONGBOOK state through the same backup-protected song action registry as Telegram callbacks. The Dashboard/Songs/Platforms views now surface recent distribution and song-completion runtime actions with apply/skip buttons. X real publish, Instagram, and TikTok buttons remain excluded; `openclaw.plugin.json`, publish gates, `liveGoArmed`, and `autopilot.dryRun=false` remain untouched. New npm dependencies: none.
- Plan v9.14 completes the Telegram inline-button confirmation path. The runtime now supports Telegram `inline_keyboard` / `callback_query` handling, callback action lookup in `runtime/callback-actions.jsonl`, callback audit entries in `runtime/callback-audit.jsonl` with hashed chat/user ids and no raw chat text, inline buttons for ChangeSet proposals (Journey F), distribution URL reflection (Journey G), and completed-song SONGBOOK reflection (Journey H). `handleProposalResponse()` is now the shared apply/discard/edit path for text commands, callbacks, and `/api/proposals/:id/*`; unimplemented pendingAction variants (`publish_arm_switch`, `regenerate_suno`, `lyrics_save`) were removed to prevent UI misreading. Excluded for Plan v9.15: X real publish buttons, IG/TikTok publish buttons, and Producer Console mirrors for inline-button actions. Distribution check: `npm pack --dry-run --json` reports 278,292 bytes, up 1,825 bytes (+0.66%) from the Phase 4d baseline of 276,467 bytes and within the 281,914-byte R6 budget; Distribution Gate 23/23 is maintained. Breaking changes: none beyond Plan v9.13 wizard retirement. New npm dependencies: none. `openclaw.plugin.json`, publish gates, `liveGoArmed`, and `autopilot.dryRun=false` remain untouched.
- Plan v9.13 completes the conversational artist core by retiring the Plan v9.11/v9.12 wizard state machines and adding distribution polling for scheduled songs. `/setup`, `/persona edit`, `/song update`, and `/song add` now route toward the conversational artist path instead of chained `/answer` prompts; `/persona migrate` and `/persona reset` keep their explicit confirmation sessions. Scheduled SONGBOOK entries can now be checked against UnitedMasters, Spotify, and Apple Music/iTunes lookup surfaces, emitting distribution-change events for producer confirmation. Breaking changes: legacy wizard sessions and `/skip` `/back` `/answer` runtime command registration are removed; natural Telegram messages are the primary interaction path. New npm dependencies: none. Distribution check: `npm pack --dry-run --json` reports 271,153 bytes, down 5,516 bytes (-1.99%) from the Phase 6 baseline of 276,669 bytes and within the 281,914-byte R6 budget.
- Plan v9.11 upgrades the Telegram persona setup/check-fill journeys with mock-safe AI draft proposals: `/setup` now starts from a rough artist sketch unless `OPENCLAW_PERSONA_PROPOSER=off`, `/persona check fill` can propose drafts for missing or thin fields before preview/confirm writes, and `/persona check suggest` is read-only through the shared proposer path. Field writes take one backup per file per session before mutation, secret-like proposer input/outputs are skipped with warnings, and the legacy handwritten wizard remains available through the retreat flag. Breaking changes: none. New npm dependencies: none. Distribution check: `npm pack --dry-run --json` reports 244,741 bytes before the final docs entry, up 5,293 bytes (+2.21%) from the Plan v9.10 baseline of 239,448 bytes and within the 281,914-byte R6 budget.
- Plan v9.10 hardens the Telegram persona migrate flow for distribution use: artist-runtime now logs runtime-slash command registration and best-effort Telegram command-spec snapshots at startup, and `/persona migrate <operator intent>` now parses explicit field directives instead of echo-wrapping the full operator prompt into every missing field. Recognized aliases cover the 6 ARTIST fields plus 2 SOUL fields, multi-line values continue until the next recognized field key, and `keep ...` / `skip` directives leave fields unchanged. Breaking changes: none. New npm dependencies: none. Distribution check: `npm pack --dry-run --json` reports 239,448 bytes, up 2,112 bytes (+0.89%) from the Plan v9.9 baseline of 237,336 bytes and within the 281,914-byte R6 budget.
- Plan v9.9 lets `/persona migrate <operator intent>` carry migration guidance into the preview/confirm flow. The preview now shows normalized operator intent plus mock-safe proposed drafts for missing or thin persona fields, honors field-specific skip directives such as `socialVoice: keep as-is, skip`, and writes confirmed drafts into the ARTIST/SOUL marker blocks while preserving imported custom sections. Breaking changes: none. New npm dependencies: none. Distribution check: `npm pack --dry-run --json` reports 237,336 bytes, up 2,101 bytes (+0.89%) from the Plan v9.8 baseline of 235,235 bytes and within the 281,914-byte R6 budget.
- Plan v9.8 fixes the production Telegram command path for the persona surface: artist-runtime now registers `/persona`, `/setup`, and wizard session-control commands with OpenClaw's native plugin command registry, so `/persona check` no longer falls through to the OpenClaw agent/model path. It also fixes the SOUL migrator preservation bug that could collapse markerless Obsidian-imported SOUL.md content into a placeholder-only marker block. Plan v9.5-v9.7 distribution gates did not prove the production OpenClaw Telegram command registry path; this entry records that gap and its repair. Breaking changes: none. New npm dependencies: none. Distribution check: `npm pack --dry-run --json` reports 235,235 bytes, up 1,925 bytes (+0.83%) from the Plan v9.7 baseline of 233,310 bytes and within the 281,914-byte R6 budget.
- Plan v9.7 completes the Telegram persona audit/migrate flow for Obsidian-imported artist files: `/persona check` now reports filled/thin/missing fields and custom sections, `/persona check fill` chains missing or thin fields through the existing preview/confirm editor, `/persona check suggest` stays mock-safe through the debug reviewer interface, and `/persona migrate` converts markerless ARTIST/SOUL files into Telegram-managed marker blocks with backups and custom-section preservation. Breaking changes: none. New npm dependencies: none. Distribution check: `npm pack --dry-run --json` reports 233,310 bytes, up 4,552 bytes (+1.99%) from the Plan v9.6 baseline of 228,758 bytes and within the 281,914-byte R6 budget.
- Plan v9.6 completes the Telegram artist-persona first-run experience: `/setup` now drives a lean ARTIST.md wizard, `/setup soul` writes a SOUL.md mini profile, `/persona show|fields|edit|reset` manages Telegram-owned persona blocks, Obsidian artist import preserves Telegram-managed ARTIST/SOUL markers by default, and Telegram worker startup can remind a known owner chat when persona setup is still incomplete. Breaking changes: none. New npm dependencies: none. Distribution check: `npm pack --dry-run --json` reports 228,755 bytes, up 11,898 bytes (+5.49%) from the Plan v9.5 baseline of 216,857 bytes and within the 265,121-byte R6 budget.
- Plan v9.5 finalizes the autopilot revival and Telegram bridge dogfood pass: RuntimeEventBus stage/state/take notifications, owner-only Telegram commands, local free-text inbox staging, debug-only `/review <songId>` mock AI review, and final pre-release distribution gate coverage.

## [0.3.0] - 2026-04-26

First public-release candidate. Bundles the working dry-run runtime,
Producer Console, Suno browser worker scaffolding, social connector
skeletons, and the Plan v9 public-release readiness pass (sanitized
defaults, narrowed marketplace tarball, ESLint/Prettier baseline,
dependabot, branch protection, CodeQL, release workflow, and an
operator/contributor split README).

### Added
- Added `scripts/import-obsidian-artist.mjs` to migrate an artist persona from an Obsidian-style vault into the runtime workspace. Backs up existing `ARTIST.md`, `artist/SOCIAL_VOICE.md`, and `artist/cover.png` before writing, supports `--dry-run` and `--force`, and ships parser-level unit tests.
- Added `scripts/import-obsidian-song.mjs` to migrate a single song folder (lyrics, lyrics-suno, yaml-suno, style with embedded Sliders table, optional references) from an Obsidian-style vault into the runtime workspace. Builds `song.md` with state markers, `brief.md`, `lyrics/lyrics.v1.md`, `lyrics/yaml-suno.md`, `lyrics/lyrics-suno.md`, `suno/style.md`, `suno/exclude.md`, and `suno/sliders.json`. Backs up existing target files before writing; supports `--dry-run`, `--force`, `--song`, and `--song-id`.
- Plan v7 (operator-ready in one shot): pinned a "Last Cycle Summary" card on the Producer Console Dashboard surfacing autopilot stage, ticker outcome, current song, last social action, and Suno artifact count from the existing `/api/status` payload. Skipped ticker outcomes (`skipped:concurrent` / `skipped:disabled`) now render an inline color-coded banner instead of being silently equivalent to a successful run.
- Plan v7 (operator-ready in one shot): exposed `music.suno.driver` (mock / playwright) and `music.suno.submitMode` (skip / live) selects in the Producer Console Config Editor. Switching `submitMode` to `live` shows an inline warning that real Suno credits will be consumed.
- Round 86 (Mega-X-Plus skeleton): added `xLiveGateState.evaluateGate()` returning `idle` for every input, `extractMediaMetadata()` that reads only `stat()` size and extension-based mime, and `mentionedHandles` / `tweetId` enrichment in dry-run reply audit ledger entries. Real publish, real upload, and real fetch paths remain blocked.
- Added `stripSoundCloudLines` helper in `scripts/import-obsidian-artist.mjs` so re-importing the Obsidian vault no longer re-injects the SoundCloud row into the workspace `SOCIAL_VOICE.md` (the Obsidian vault stays read-only / unchanged; the workspace simply drops the row at move time). Three regression tests cover the helper itself and the integrated importer output.
- Added `readExistingSongStatus` helper in `scripts/import-obsidian-song.mjs` plus `main()` integration so re-importing an Obsidian song preserves any explicit `published` / `archived` status set on `song.md` instead of regressing to `lyrics`. New songs (no existing `song.md`) still default to `lyrics`. Three regression tests cover preserved status, file-based status read, and the missing-file fallback path.
- Added `scheduled` to the `songStatuses` enum (`src/types.ts`) for songs whose distribution is approved (例: UnitedMasters scheduled release) but not yet publicly released. `currentSong()` autopilot picker now also skips `scheduled`, the `normalizeSongStatus` parser accepts it, and the Producer Console Archive section surfaces it alongside `published` / `archived` / `failed`.
- Hardened `scripts/import-obsidian-song.mjs` so re-importing an Obsidian song now skips writing `song.md` entirely whenever a workspace file already exists. This preserves the full `<!-- artist-runtime:song-state -->` block (status, public_links, last_reason, run_count, selected_take, last_import_outcome) plus any body annotations the operator has handwritten — newly imported songs (no existing `song.md`) still bootstrap with `Status: lyrics`.
- Hardened `scripts/import-obsidian-artist.mjs` with `extractSpotifyProfileSection` / `readExistingSpotifyProfileSection` helpers so re-importing now preserves the workspace `## Spotify Profile (imported)` section (URLs, bio, header note, artist pick) when one exists. The vault-derived section is still used as the bootstrap source on first import.
- Sanitised the Obsidian importers (`scripts/import-obsidian-{song,artist}.mjs`) so the public defaults are now generic placeholders (`~/obsidian-music-vault`, `my-song`, `my-artist`) and operator-specific paths or slugs come from `OPENCLAW_OBSIDIAN_SOURCE` / `OPENCLAW_DEFAULT_SONG_SLUG` / `OPENCLAW_DEFAULT_ARTIST_SLUG` environment variables. Test fixtures under `tests/import-obsidian-*.test.ts`, `tests/x-bird-connector.test.ts`, and the X dry-run integration tests now use generic mock identifiers (`test_artist`, `test-artist`, `test-song-slug`, `test-profile.artist-x`) instead of personal handles.
- Filled in the public-release templates: `LICENSE` copyright holder is now `yzhonda`, `SECURITY.md` documents the GitHub Security Advisories report flow with an acknowledgement SLA, and `PRIVACY.md` adds an explicit retention policy table covering creative files, ledgers, audit logs, Suno artifacts, connector metadata, and browser profile cookies.
- Synced `openclaw.plugin.json` `version` from `0.1.0` to `0.3.0` to match `package.json`.
- Narrowed `package.json` `files` to public-facing artifacts only (`dist/`, `ui/dist/`, public docs, marketplace metadata) and dropped `src/`, `ui/src/`, `scripts/`, `AGENTS.md`, `CODEX_START_HERE.md`, `SPEC_INDEX.md`, and the numbered internal specs from the marketplace tarball. Updated `name` / `author` / `repository` / `bugs` / `homepage` to the `@yzhonda/openclaw-artist-runtime` namespace.
- Hardened `.npmignore` with explicit blocks for internal docs (`docs/codex-detailed-specs/`, `docs/full-spec/`, `docs/log/`, `docs/ask/`, `docs/SOURCE_NOTES.md`, numbered specs) and contributor-only files (`AGENTS.md`, `CODEX_START_HERE.md`, `SPEC_INDEX.md`, `tests`, `src`, `scripts`, `ui/src`). Verified with `npm pack --dry-run` that the tarball is 210 kB / 173 files with no internal documents.
- Rewrote `docs/README.md` so the marketplace-shipped docs index points readers at the public-facing operator docs only; internal contributor specs are explicitly described as repository-only.

### Changed
- Plan v7: autopilot publishing stage now advances to `published` based on `result.dryRun` and `policyDecision === "deny_dry_run"` instead of fragile string matching on the social authority reason. The new helper `isPublishBlockedByDryRun` is unit-tested.
- Plan v7: Instagram lane is now visually frozen in both the Config Editor and the Platforms list, matching TikTok's existing freeze. The arm toggle is read-only with a `frozen` badge and the upstream `liveGoArmed` is clamped to `false` even if a draft tries to flip it on (mirrors the `feedback_social_real_post_ban.md` and #4 boundary).
- Plan v7: documented a 5-Minute First Cycle in `docs/OPERATOR_QUICKSTART.md` so a fresh operator can verify the Producer Console end-to-end without provisioning real Suno or X credentials.
- Producer Console Songs tab now splits songs into an active list and a separate `Archive` section that surfaces `published` / `archived` / `failed` entries with a hint that autopilot does not touch them, so already-released catalog tracks sit visually apart from in-flight songs.
- Added `docs/X_LIVE_PUBLISH_DESIGN.md` documenting the staged X live publish state machine and the operator GO requirements that remain deferred.
- Marketplace listing docs now summarize connector credential requirements and include a first-pass credential refresh troubleshooting section for X/Bird, Instagram, and TikTok.
- Added `docs/CONNECTOR_AUTH.md` as the dedicated connector setup / refresh guide and linked operator-facing docs back to it.
- Added `docs/GATEWAY_AUTH.md` to document the current plugin-level gateway auth boundary for the HTTP route surface.
- Added a dependency-free `PlaywrightSunoDriver` skeleton and `docs/SUNO_BROWSER_DRIVER.md` for the future operator-managed Suno browser lane.
- Added real Playwright probe wiring plus `scripts/openclaw-suno-login.sh` / `scripts/openclaw-suno-login.mjs` for the manual first-login lane.
- Added `playwright-extra` and `puppeteer-extra-plugin-stealth` so the Suno login lane can ride the Chrome/stealth path documented for operators.
- Added Round 39 Playwright create-form fill support plus `music.suno.submitMode`, keeping the Create button blocked while the Suno lane stays credit-safe.
- Added Round 40 live submit polling so the Playwright Suno lane can click `Create` and wait for new library song URLs when `music.suno.submitMode = "live"`.
- Added Round 41 audio import/download so finished Suno song URLs can be revisited and saved under `runtime/suno/<runId>/` as local mp3 artifacts.
- Added Round 41.1 import metadata/status surfacing so saved Suno assets now carry `format`, optional `title`, and optional `durationSec`, with `/api/status` exposing the imported paths/metadata.
- Added Round 41.2 two-stage live submit polling so `/create` generation cards are checked before the older library-diff fallback.
- Added Round 42 Instagram Graph API skeleton wiring so the connector can model `accounts -> media -> media_publish` while staying dry-run fixed.
- Added Round 43 distribution-authority wiring tests so disabled distribution/platform states are proven to force social publishes back into dry-run before connector execution.
- Added Round 44 `distribution.liveGoArmed` plus `/api/status` dry-run surfacing so the producer can see the global social live arm and each platform's effective dry-run state.
- Added Round 45 per-platform `distribution.platforms.{x,instagram,tiktok}.liveGoArmed` flags so each social lane now needs both the global arm and its own platform arm before upstream dry-run can release.
- Added Round 46 Producer Console live-go toggles for the global arm plus X / Instagram platform arms, while keeping TikTok visibly frozen in the UI.
- Added Round 47 Producer Console probe badges plus rerun controls for X / Instagram, while keeping TikTok visually frozen and probe-disabled.
- Added Round 48 Producer Console imported-asset surfacing for the latest Suno import, showing read-only links plus static metadata without introducing playback UI.
- Added Round 49 cheap boundary tests for Suno import format handling, locking `.mp3`, `.m4a`, and 404-empty outcomes without touching the driver.
- Added Round 50 local-only credential notes for the Suno browser profile and imported Suno artifacts in `SECURITY.md` / `PRIVACY.md`.
- Added Round 51 Suno daily credit budgeting so live Create attempts fail closed with `budget_exhausted` once the UTC-day counter reaches the configured limit.
- Added Round 52 Suno budget surfacing so `/api/status` and the Producer Console now show the UTC-day credit date, consumed amount, limit, and remaining credits.
- Added Round 53 Suno browser recovery runbook docs so operators now have explicit profile-corruption, Google OAuth reauth, migration, and `budget_exhausted` recovery flows.
- Added Round 54 Suno artifact retention/deletion docs so operator-local mp3/m4a handling, manual review, and non-automatic cleanup are now explicit.
- Added Round 55 imported-asset path copy buttons in Producer Console so operators can copy absolute mp3/m4a paths without serving the runtime directory over HTTP.
- Added Round 56 `budget.json` editing guidance so operators now have explicit docs for the Suno credit counter shape, fallback behavior, and safe manual reset flow.
- Added Round 57 invalid-JSON recovery for `runtime/suno/budget.json`, so the budget tracker now falls back to an empty UTC-day state instead of crashing on parse failure.
- Added Round 58 atomic `budget.json` writes, so the Suno budget tracker now writes through a temp file plus `rename(...)` before replacing the final counter file.
- Added Round 59 Producer Console editing for `music.suno.dailyCreditLimit`, so the Suno daily credit ceiling can now be raised or lowered through the existing config patch flow.
- Added Round 60 a confirmed Producer Console reset action for the Suno daily budget counter, backed by `POST /api/suno/budget/reset`.
- Added Round 61 operator security docs for threat modeling, incident response, token expiry, audit redaction, package exclusions, profile recovery, and gateway token-mismatch troubleshooting.
- Added Round 62 CI hardening with boundary-grep, Vitest v8 coverage gating, Node 20/22 matrix jobs, and timeout configuration.
- Added Round 63 Suno runtime resilience with stale budget tmp cleanup, reset audit logging, optional monthly credit limits, classified Playwright create errors, and an operator-confirmed runtime cleanup script.
- Added Round 64 social dry-run E2E hardening with shared effective-dry-run resolution, X/Instagram staging tests, status summaries, config warnings, and `docs/ERRORS.md`.
- Added Round 65 Producer Console observability with recent distribution events, platform 7-day stats, all-platforms dry-run banner, stronger TikTok frozen styling, and budget reset/rollover details.
- Added Round 67 Suno browser-profile lifecycle helpers for stale detection, daily local snapshots, and operator diagnose/backup scripts.
- Added Round 68 Producer Console observability panel tabs plus `/api/status/export` JSON snapshots for 7-day, 30-day, and all-history operator exports.
- Added Round 66 atomic social publish ledger writes with 90-day archive rotation and archive-aware reader coverage.
- Added Mega-A backend/test hygiene: config schema migrations, runtime cleanup scripts/docs, threat-model validation tests, expanded boundary-grep patterns, and Producer Console reason-code runbook links.
- Added Mega-B social-lane polish: X reply-target parsing/audit metadata, platform authStatus/tested-at persistence, Instagram token-expiry status, and a fail-closed Instagram live rehearsal skeleton.
- Added Round 76 X/Bird Firefox profile wiring so `OPENCLAW_X_FIREFOX_PROFILE` can direct runtime probes and dry-run Bird calls at a dedicated artist Firefox profile.
- Added Round 77 X/Bird lane polish with opt-in `t.co` dry-run expansion, normalized reply-target ledger metadata, probe reason badges, and an X probe diagnostics guide.
- Added Round 78 Suno runtime visibility with artifact indexing, budget reset-history surfacing, profile stale banners, and per-URL import failure details.
- Added Round 79 infra hardening with bash-3 compatibility grep rules, route fallback telemetry, Producer Console stale/offline banners, and reason-code doc cross-links.
- Added Round 80 dependency-audit hardening with root overrides for vulnerable transitive packages, a production `npm audit --omit=dev` CI gate, and documented dev-only advisory handling.
- Added Round 81 operator self-serve scripts for doctor checks, manual runtime log rotation, runtime state snapshots, and `docs/OPERATOR_RUNBOOK.md`.
- Added Round 82 Producer Console UX helpers for distribution-event filtering, unified error toasts, reconnect/recovered banners, and keyboard shortcuts without importing React components into root tests.
- Added Round 83 operator quickstart and troubleshooting docs plus a cross-link coverage test for top-level docs references and anchors.
- Added Round 84 in-process gateway chain tests for X probe config persistence, X dry-run reply audit reads, and Suno mock create/import/archive regression coverage.
- Added Round 85 Suno operator UX endpoints and helpers for paged artifact reads, diagnostics export, profile-snapshot retention, and imported-asset URL filtering.

### Changed
- Extracted `buildImportedAssetRows` and `importedAssetsPlaceholder` into `src/services/sunoImportedAssetsView.ts` so the helpers are shared by `SunoOutcomeCard` and root vitest without dragging the React entrypoint into the test scope.

### Fixed
- Bumped Bird probe timeout from 750ms to 3000ms so Firefox-profile-backed `bird whoami --plain` calls finish within the probe budget.

### Notes
- Operator decision (2026-04-25): the Instagram lane is dropped at parity with TikTok. The Graph API skeleton, live rehearsal gates, and existing tests stay as feature carry-over, but no token will be provisioned, no probe is exercised, and no live publish path will be opened without an explicit operator GO.

### Changed
- Connected `docs/CONNECTOR_AUTH.md` refresh steps directly to platform test route anchors in `docs/API_ROUTES.md` and refreshed package-contents docs for the post-0.3.0 doc/test surface.
- Suno worker selection now accepts `music.suno.driver`, defaulting to `mock` while reserving `playwright` for later operator-installed browser automation.
- Added the `playwright` runtime dependency and documented the operator-side Chromium install boundary without enabling real create/import yet.
- The Playwright Suno lane now fills lyrics/style/instrumental fields on `/create` and returns `submit_skipped` until Round 40 unlocks real submission.
- The Playwright Suno lane now snapshots existing library URLs, submits live generations only in `submitMode = "live"`, and fails closed with `playwright_live_timeout` when no new song URLs arrive.
- The Playwright Suno lane now turns returned `/song/<uuid>` URLs into local mp3 files and reports partial-import failures without discarding successful downloads.
- The Playwright Suno import lane now falls back to `.m4a` when `.mp3` is unavailable and mirrors saved paths plus lightweight metadata into the worker status surface.
- The Playwright live create lane now reports whether success came from `/create` card polling or the `/me` library-diff fallback, while keeping the library path as the final safety net.
- The Instagram connector now resolves dry-run Graph API stages but still rejects all non-dry-run publish attempts with `requires_explicit_live_go`.
- `publishSocialAction()` now forces an upstream dry-run hold whenever distribution is disabled or the target platform toggle is off, leaving Instagram live requests to fail closed with `requires_explicit_live_go` only when the upper pipeline is actually armed.
- `publishSocialAction()` now also forces social publish back into dry-run whenever `distribution.liveGoArmed` is false, and `distributionWorker` mirrors `liveGoArmed` plus per-platform `effectiveDryRun` into `/api/status`.
- `publishSocialAction()` now also holds the social lane in dry-run whenever the target platform arm is off, and `/api/status` mirrors `platformLiveGoArmed` alongside each platform's `effectiveDryRun`.
- Producer Console config payloads now carry global/per-platform live-go arms through the existing `/api/config/update` flow, with TikTok forced back to `liveGoArmed=false` at persistence time.
- TikTok connector health now reports `account_not_created` regardless of env state, and the UI short-circuits all TikTok probe fetch paths before they can fire.

### Fixed
- Suno Google OAuth login now uses the stealth-plugin + Chrome-channel probe/login lane instead of the default automation markers that were getting blocked.

## 0.3.0 - 2026-04-22

### Added
- Producer Console config editing now includes `distribution.platforms.x.authority`, `distribution.platforms.instagram.authority`, and `distribution.platforms.tiktok.authority` selectors in both the bundled React UI and the fallback inline shell (`5836e96`).
- Instagram and TikTok connectors now match the X/Bird dry-run contract with env-based auth probes plus fail-closed publish/reply skeletons (`d4a3a3b`).
- Producer Console Suno outcome rendering now flows through a dedicated `SunoOutcomeCard` component, and both the bundled UI and fallback Console show `Dry-run` badges on mock create/import outcomes (`4965dc9`).

### Changed
- README / package contents were refreshed for the post-0.2.0 authority-editor and three-platform connector parity state (`3831a99`).

### Security
- Connector auth contracts are now explicitly documented for X/Bird, Instagram, and TikTok so operator env/CLI requirements are visible before live distribution is enabled (`c5f2ef3`).

## 0.2.0 - 2026-04-22

### Added
- Producer Console live config editor for `autopilot` and `distribution.platforms.*` via `/api/config/update` (`a3f5a93`).
- `ui/src/configEditor.ts` pure payload builder / validator and dirty-state guard for in-flight edits (`a3f5a93`).
- `scripts/openclaw-local-ticker-observe.sh` for repo-local ticker observation via manual `run-cycle` proxy (`e72e8b5`).
- Bird (X) auth probe via `bird whoami --plain` in `XBirdConnector.checkConnection` (3 unit cases).
- Bird (X) text-only publish path via `bird tweet` with text-hash dedupe and min-interval guards (5 unit cases).
- Bird (X) reply code path via `bird reply <targetIdOrUrl>` with `targetId` / `targetUrl` threading (5 unit cases).
- Gateway lifecycle hooks (`gateway_start` / `gateway_stop`) as autopilot scheduling anchor.
- `AutopilotTicker` service for periodic `runCycle` with gating (`enabled`, `paused`, `hardStopReason`, `concurrent`).
- Suno browser worker lifecycle state machine (`connecting` / `connected` / `login_required` / `disconnected` / `stopped`) with manual login handoff skeleton and persistent state.
- `/api/status.ticker` surface exposing `{ lastOutcome, lastTickAt, intervalMs }`.
- `/api/platforms/x/simulate-reply` dry-run-only route for Console reply preview.
- Producer Console UI: bundled React app served from `ui/dist/` with Ticker card, Recent X Result, Simulate Reply form, and 3-second polling.
- `socialPublishing.ts` `SocialActionInput` carries `targetId` / `targetUrl` through to `XBirdConnector.reply()`.
- Autopilot full-cycle dry-run smoke test: `planning → prompt_pack → suno_generation → take_selection → asset_generation → publishing (dry-run) → completed` with external-call-zero assertion.
- Two-cycle autopilot dry-run smoke test that rotates from `song-001` to `song-002` after dry-run publish completion (`d614813`).
- `scripts/openclaw-local-gateway` lifecycle helpers (`start` / `stop` / `status` / `tail`) for repo-local OpenClaw sandbox.
- GitHub Actions CI workflow for `push` / `pull_request` to `main` running `typecheck`, `test`, and `build` (`bd2156f`).
- `workspace-template/artist/{CURRENT_STATE,OBSERVATIONS,PRODUCER_NOTES,RELEASE_POLICY,SOCIAL_VOICE,SONGBOOK}.md` and `workspace-template/songs/.gitkeep` are tracked to keep CI/workspace bootstrap aligned (`68f885f`).
- Suno worker create/import automation skeleton with mockable driver contracts, persistent `currentRunId` / `lastImportedRunId`, and `generating` / `importing` states (`462c3a0`).
- `/api/suno/status` now exposes `currentRunId`, `lastImportedRunId`, `lastCreateOutcome`, and `lastImportOutcome`, and the BrowserWorker connector routes create/import through worker methods (`acd9d70`).
- Producer Console Suno cards in both the bundled React UI and the fallback inline shell now render `Suno Current Run`, `Last Imported`, `Last Create`, and `Last Import` (`f368898`).

### Fixed
- `/api/config/update` accepts `payload.config` as patch fallback.
- `/api/status` now reflects persisted runtime config overrides and `/api/run-cycle` updates ticker getters (`717219d`).
- Eleven helper-backed read routes now resolve persisted runtime config overrides instead of using defaults only (`e3b02f0`).
- `resolveRuntimeConfig()` is promoted to `src/services/runtimeConfig.ts` and reused across 14 mutating routes (`087acdf`).
- `/api/config/update` now resolves its context through the shared runtime-config resolver as well (`aaf75f4`).
- UI bundle resolution uses plugin-root path via `import.meta.url` rather than `process.cwd()`, so the bundled Console renders even when the gateway's cwd is `.local/openclaw/home`.
- `stripUiBasePath` helper normalizes `/plugins/artist-runtime/ui/` asset references to `ui/dist/` relative paths during inlining.
- GitHub Actions CI no longer requires a lock file; the workflow uses `npm install --no-audit --no-fund` without `cache: npm` (`5cad215`).
- `POST /api/platforms/:id/test` no longer 404s under the current OpenClaw Gateway matcher; platform test routes are registered as static exact paths for `x`, `instagram`, and `tiktok` (`dfadbca`).
- Dynamic API routes no longer depend on literal `:param` matching in the gateway. `songs`, `alerts`, `platforms`, and `suno` now dispatch through family-level prefix routes with request-path metadata injected by `pluginApi.ts` (`ebba4ea`).

### Changed
- `.gitignore` excludes repo-root workspace artifacts with root-only patterns so `workspace-template/artist/*` and `workspace-template/songs/.gitkeep` remain tracked (`68f885f`).
- `docs/PACKAGE_CONTENTS.md` was refreshed for the repo-local ticker observer and expanded runtime/test surface (`e72e8b5`).
- README, package contents, and Console-facing docs are now synchronized through the completed Producer Console Suno UX and live route-dispatch behavior (`c356634`, `f368898`).

### Security
- Real Bird / Instagram / TikTok posting, real Suno browser automation, and real
  platform writes remain gated behind explicit operator action. The test suite asserts
  `node:child_process.spawn` and `fetch` are not invoked during dry-run cycles.

## 0.1.0

Initial distributable package skeleton.

- OpenClaw-native plugin package root.
- ClawHub/npm publishing metadata.
- Producer Console route scaffold.
- Autopilot/Suno/Social connector architecture.
- Security, privacy, capability, and publishing documentation.
- Append-only Prompt Ledger and audit log specs.

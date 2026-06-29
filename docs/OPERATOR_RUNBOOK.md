# Operator runbook

This runbook covers operator-run maintenance helpers. The scripts are manual
tools: they do not install cron jobs, systemd timers, launch agents, or hidden
background workers.

See also: [OPERATOR_QUICKSTART.md](OPERATOR_QUICKSTART.md),
[TROUBLESHOOTING.md](TROUBLESHOOTING.md), [ERRORS.md](ERRORS.md), and
[RUNTIME_CLEANUP.md](RUNTIME_CLEANUP.md).

> **Repo-local vs. installed-plugin commands.** Some procedures below (and the
> dated "通常運転手順" change-log sections) use `scripts/openclaw-local-*` and
> `.local/openclaw/bin/openclaw`. Those are the contributor repository sandbox
> wrappers and are **not** included in the published package. If you installed the
> plugin, use the host equivalents:
>
> - `scripts/openclaw-local-gateway start` / `.local/openclaw/bin/openclaw gateway stop` → `openclaw gateway run --allow-unconfigured --bind loopback --auth none --port 43134` (see [OPERATOR_QUICKSTART.md](OPERATOR_QUICKSTART.md))
> - `scripts/openclaw-local-env.sh` → repo-only; export the documented environment variables directly in your shell

## Operator sections

Day-to-day operator topics are listed here. The `## Plan vX.Y …` sections
further down are implementation change history — skip them for routine
operation.

- [Quick checks](#quick-checks) — doctor and health
- [Autopilot mode](#autopilot-mode)
- [Telegram opt-in](#telegram-opt-in)
- [First-run experience: artist persona](#first-run-experience-telegram-artist-persona)
- [Runtime log rotation](#runtime-log-rotation)
- [Runtime state snapshots](#runtime-state-snapshots)
- [Cron examples](#cron-examples)
- [See also](#see-also)

## Quick checks

Run the doctor from the package root:

```bash
scripts/openclaw-doctor.sh
```

Use JSON mode for automation that the operator controls:

```bash
scripts/openclaw-doctor.sh --json
```

The JSON shape is:

```json
{
  "checks": [
    { "name": "gateway", "status": "ok", "detail": "..." }
  ],
  "summary": { "ok": 1, "warn": 0, "fail": 0 }
}
```

Exit codes are `0` for all OK, `1` when at least one check is warning, and `2`
when at least one check fails. The doctor checks the gateway status endpoint,
X auth probe state from `runtime/config-overrides.json`, Suno budget state,
runtime disk usage, and the local Suno browser profile age.

Useful environment knobs:

- `OPENCLAW_GATEWAY_PORT` or `OPENCLAW_LOCAL_GATEWAY_PORT`: gateway port, default `43134`
- `OPENCLAW_DOCTOR_PROFILE_STALE_DAYS`: Suno profile stale threshold, default `30`
- `OPENCLAW_DOCTOR_DISK_WARN_GB`: runtime disk warning threshold, default `10`
- `OPENCLAW_DOCTOR_DISK_FAIL_GB`: runtime disk failure threshold, default `50`

## Autopilot mode

Archive-only mode is retired. The package default now starts the 8-stage
autopilot pipeline in dry-run-protected mode: `autopilot.enabled=true` and
`autopilot.dryRun=true`. This lets the runtime plan, create prompt packs, and
exercise the pipeline while Suno create and social publish remain blocked by
the existing authority gates.

Obsidian importer scripts remain available only as manual CLI tools for
operator-led archive work:

```bash
node scripts/import-obsidian-artist.mjs --help
node scripts/import-obsidian-song.mjs --help
```

The autopilot service does not call those importer scripts. If the operator
needs to preserve or import older Obsidian material, run the scripts manually
before or after an autopilot cycle and keep the resulting song status under
operator review.

## Telegram opt-in

Telegram is disabled by default. With default config and no token, the runtime
starts normally and the Telegram worker performs no fetches.

To opt in, the operator must provide all three gates:

1. Set `telegram.enabled=true` in config.
2. Put `TELEGRAM_BOT_TOKEN` in `.local/social-credentials.env` or the shell
   environment.
3. Put the owner Telegram user id in `TELEGRAM_OWNER_USER_IDS`.

`scripts/openclaw-local-env.sh print` masks the token body and shows only
whether it is set. To disable Telegram again, set `telegram.enabled=false` or
remove either local environment value, then restart the Gateway process that
owns the environment.

## First-run experience: Telegram artist persona

Use this after plugin install, before turning the revived autopilot into a real
production loop. The goal is a lean first-run path where the artist identity is
created from Telegram while all external side effects remain opt-in.

1. Install and enable the plugin as usual. Keep the distributed safety defaults:
   `telegram.enabled=false`, `autopilot.dryRun=true`, and `aiReview.provider`
   left at the mock/default provider.
2. Configure Telegram as described above: create the bot with BotFather, put
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_USER_IDS` in the local environment,
   then set `telegram.enabled=true`. Only the allowlisted owner can drive the
   setup conversation.
3. Send `/setup` to the bot. Answer the six lean ARTIST questions, review the
   preview, then send `/confirm`. This writes only the Telegram-managed
   `ARTIST.md` block and the local `runtime/persona-completed.json` marker.
4. Optional: send `/setup soul` and answer the two SOUL questions for the
   producer-facing conversational voice. `/persona show` summarizes the current
   ARTIST/SOUL fields, `/persona edit <field>` edits one managed field after a
   preview, and `/persona reset` requires `/confirm reset` before removing only
   Telegram-managed persona blocks.

> **Which identity files matter.** `ARTIST.md` is the file the setup gate checks
> and `/setup` writes (artist name, sound, lyrics, Suno profile). The companion
> files `IDENTITY.md`, `INNER.md`, and `PRODUCER.md` are also injected into the
> artist's AI prompts but are **not** written by `/setup` — edit them by hand if
> you want them filled (they ship as `TBD` placeholders). If the openclaw config
> sets `artist.identity.displayName`, that value overrides the `ARTIST.md` name.

After the persona is saved, start or resume autopilot in the usual staged way:
keep `autopilot.dryRun=true` for the first cycle, watch Telegram stage events,
and only consider real Suno or social side effects under their existing operator
GO rules.

Obsidian importer coexistence: `scripts/import-obsidian-artist.mjs` preserves
Telegram-managed ARTIST/SOUL marker blocks by default. Use
`--no-preserve-telegram-persona` only when the operator intentionally wants the
Obsidian import to replace the managed persona blocks.

## Persona audit & migrate (Plan v9.7)

Use this flow after importing an existing Obsidian artist file that has no
Telegram-managed markers or is missing some of the lean persona fields.

1. Send `/persona check` to see which ARTIST/SOUL fields are filled, thin, or
   missing. Custom Obsidian sections are reported separately and are not deleted.
2. If only a few fields need work, send `/persona check fill` and answer the
   chained prompts. Each field still uses preview plus `/confirm`; `/skip`
   leaves the current field unchanged and moves to the next candidate.
3. If the imported files should become marker-managed, send `/persona migrate`.
   Review the backup paths, marker sections, custom sections, and warnings.
4. Send `/confirm migrate` only after the preview is expected. The migrator
   writes backups first, inserts Telegram-managed marker blocks, preserves
   custom sections outside those blocks, and leaves songs, ledgers, budgets,
   profiles, and publish gates untouched.
5. Optional: send `/persona check suggest` for a mock-safe suggestion pass. The
   default provider is still `mock`; no external AI provider is called unless a
   future operator-selected provider is explicitly configured.

## Production Telegram command path (Plan v9.8)

Plan v9.8 wires the persona commands into OpenClaw's native plugin command
registry. This means the main OpenClaw Telegram plugin handles the bot polling
and invokes artist-runtime directly for `/persona ...` and `/setup` instead of
letting those messages fall through to the model.

1. Restart the Gateway after installing the package or rebuilding `dist/` so
   OpenClaw reloads the artist-runtime command registry.
2. Send `/persona check`. The expected response is the artist-runtime audit
   summary with filled/thin/missing fields and custom sections. It should not
   produce an OpenAI-provider error.
3. Send `/persona migrate` only when the preview is expected, then use
   `/confirm migrate` to execute. The migrator now preserves custom SOUL.md
   prose and headings outside the Telegram-managed marker block.
4. For setup/edit flows on the OpenClaw native command path, use `/answer <text>`
   for free-text wizard answers. Session control commands remain `/confirm`,
   `/cancel`, `/skip`, and `/back`.

The older artist-runtime `TelegramBotWorker` remains as a mockable service
module for tests and non-OpenClaw harnesses, but production should not start a
second Telegram long-poll worker against the same bot token. OpenClaw owns the
polling loop.

## Persona migrate with operator intent (Plan v9.9)

Use this when `/persona check` reports missing or thin fields, but the imported
Obsidian sections already contain enough direction for the artist. Add the
operator guidance directly after `/persona migrate`; the preview will keep the
normal backup and marker plan, then add draft values for the missing fields.

Examples:

```text
/persona migrate make the social voice short, unsalesy, and blunt. Use the SOUL prose for refusal style.
/persona migrate socialVoice: keep as-is, skip. Draft soul-refusal from the imported Listener section.
```

The preview includes:

- `Operator intent`, normalized to a single line so it is readable in Telegram.
- `Proposed drafts`, generated through the configured debug AI review provider.
  The distributed default remains `aiReview.provider="mock"`, which produces
  explicit placeholder drafts and performs no external model call.
- `skip per operator intent` for field-specific directives such as
  `socialVoice: keep as-is, skip`.

Send `/confirm migrate` only after the preview looks right. Confirmation writes
the proposed draft values into the Telegram-managed ARTIST/SOUL marker blocks,
creates the usual backups first, and still preserves custom imported sections
outside the managed blocks. If no intent is supplied, `/persona migrate` keeps
the older placeholder fallback behavior.

## Persona migrate field directives (Plan v9.10)

Plan v9.10 adds two operator-facing safeguards for the native Telegram command
path:

1. Gateway startup should log one registration line for each runtime slash
   command, for example `[artist-runtime] registered runtime-slash command:
   persona`.
2. If OpenClaw exposes plugin command specs during registration, startup should
   also log a snapshot like `[artist-runtime] telegram plugin command specs:
   persona,song,...,suno,lyrics,plan,take,draft,... (count=18,
   persona=true)`.
3. `scripts/openclaw-doctor.sh --json` checks the recent Gateway log for the
   text fallback commands `suno lyrics plan take draft dist pulse`. If an old
   Gateway build is still serving Telegram, the `telegram_commands` check fails
   instead of leaving the operator to infer it from chat behavior.
4. The same doctor reads Gateway health and fails `telegram_transport` when
   Telegram is not enabled, configured, running, connected, or has a recorded
   transport error. A green plugin status alone is not enough for a
   Telegram-only workflow.
5. The doctor also checks `telegram_inbound` from artist-runtime status. It
   warns when no Telegram inbound/callback has been recorded recently, so a
   connected-but-not-delivering polling path is visible before production work
   depends on it.

For migration guidance, prefer explicit `field: value` lines after
`/persona migrate`. Values may span multiple lines until the next recognized
field key. Lines such as `Genre: dark folk` are treated as part of the previous
value unless the key is one of the recognized aliases below. Use `keep ...`,
`keep as-is`, `keep as is`, or `skip` to leave a field unchanged.

```text
/persona migrate obsessions: 日本社会の風刺、批評、皮肉
socialVoice: 短く、刺さるように、過剰な売り込みは避ける
soul-tone: 御大に対しては率直、ぶっきらぼう、必要なら反論
soul-refusal: できないことは「できない」と即答、言い訳しない
artistName: keep <your artist name>
```

| Field | Recognized aliases |
|---|---|
| `artistName` | `artistName`, `artist name`, `name` |
| `identityLine` | `identityLine`, `identity`, `manifesto` |
| `soundDna` | `soundDna`, `sound` |
| `obsessions` | `obsessions`, `themes`, `theme` |
| `lyricsRules` | `lyricsRules`, `lyrics`, `lyrics rule` |
| `socialVoice` | `socialVoice`, `social voice`, `voice` |
| `soul-tone` | `soul-tone`, `soul tone`, `conversation tone`, `tone` |
| `soul-refusal` | `soul-refusal`, `soul refusal`, `refusal style`, `refusal` |

The old mock echo wrapper is intentionally gone. If no recognized directive is
found for a missing field, the preview shows `(no value extracted; provide
directive in next /persona migrate)` instead of writing the whole operator
intent into the field.

## Persona AI auto-fill (Plan v9.11)

Plan v9.11 keeps the Telegram persona flow default-safe while reducing first-run
typing. The proposer is enabled by default and uses the configured persona AI
provider; the distributed default is the deterministic `mock` provider, so no
external model call is made unless the operator opts into a real provider later.

Journey A, fresh setup:

1. Send `/setup`.
2. Reply with a rough artist sketch, for example `和風 hip-hop で社会風刺がメインの男性アーティスト、20代`.
3. Review each proposed field with `/confirm`, or use `/answer <text>` to
   override the current field.
4. `/skip` asks for one alternative. A second `/skip` on the same field asks for
   `/confirm skip`, which stores the built-in default for that field.
5. The final `/confirm` writes ARTIST.md, SOUL.md, and the local persona
   completion marker.

Journey B, filling an imported persona:

1. Send `/persona check`.
2. If fields are thin or missing, send `/persona check fill`.
3. Review each AI draft with `/confirm`, override with `/answer <text>`, or use
   the same two-step `/skip` behavior.
4. Before the first write in a session, ARTIST.md and/or SOUL.md are backed up
   once per file. Repeated fields in the same session do not create backup spam.
5. `/persona check suggest` returns the same proposed drafts in read-only mode;
   it does not create a session and does not write files.

Historical retreat flag: before Plan v9.13, `OPENCLAW_PERSONA_PROPOSER=off`
forced the older handwritten wizard for `/setup` and `/persona check fill`.
Plan v9.13 removes that wizard implementation; the flag now only disables
persona proposer calls on any remaining proposer-backed path. It does not rename
commands or change OpenClaw permissions. Secret-like input or AI responses are
rejected for the affected field and surfaced as warnings instead of being
written to ARTIST.md or SOUL.md.

## Plan v9.15 Phase A: Producer Console callback mirror (2026-04-29)

Producer Console now mirrors the safe callback actions that already exist in
Telegram. Recent distribution detections and completed-song events appear as a
Callback Action Mirror card on Dashboard, Songs, and Platforms.

- Distribution apply/skip uses the same pending proposal flow as Telegram:
  `/api/proposals/:id/yes` or `/api/proposals/:id/no`.
- Song completion uses `/api/songs/:id/songbook-write` or
  `/api/songs/:id/songbook-skip`, routed through the same SONGBOOK action
  registry as Telegram callbacks.
- UI mirror operations do not depend on `OPENCLAW_INLINE_BUTTONS`; that flag
  only disables Telegram inline button attachment.
- Phase A only reflected local files or discarded pending local actions. X
  publish buttons are introduced later by Plan v9.15 Phase 4f; Instagram and
  TikTok buttons remain absent.

## Plan v9.15 Phase 4f: X inline publish confirmation (2026-04-29)

Completed-song Telegram pushes may now include `[▶ X 投稿準備]` next to the
SONGBOOK buttons when `OPENCLAW_X_INLINE_BUTTON` is not `off`.

1. Tap `X 投稿準備` to generate a short X draft from the artist voice and the
   completed-song URL. The message is replaced with a preview, char count, and
   draft hash suffix.
2. Tap `Xに投稿` only if the preview is acceptable. The runtime re-checks the
   hash, runs `bird whoami --plain`, then posts with `bird --plain tweet <text>`.
3. On success, the returned tweet URL is reflected into SONGBOOK through the
   ChangeSet applier. `autopilot.dryRun`, `liveGoArmed`, and platform arm flags
   are not changed.
4. Tap `やめる` to discard the draft without file or X changes.

Retreat and prerequisites:

- `OPENCLAW_X_INLINE_BUTTON=off` hides the X button and makes old X callbacks
  fail closed.
- Bird must already be authenticated; check with `bird whoami --plain`.
- Instagram and TikTok publish buttons remain hidden pending separate auth and
  product approval.

## Plan v9.14: Inline Button Confirmation Path (2026-04-29)

Plan v9.14 adds Telegram inline buttons to the existing text-command
confirmation path. The producer can tap buttons on the artist's message, while
`/yes`, `/no`, and `/edit` remain available as text fallbacks.

### Journey F: ChangeSet inline button (persona/song)

When the artist proposes a persona or song ChangeSet, the Telegram message can
include `[✓ Yes] [✗ No] [✏️ Edit]`.

- Yes applies the ChangeSet through the same backup-protected writer used by
  `/yes` and the Producer Console proposal API.
- No discards the pending ChangeSet and keeps the conversation going.
- Edit opens guidance only. Field updates are still entered with
  `/edit <field> <value>` or through the Producer Console; callback payloads do
  not carry free-form field updates.

### Journey G: Distribution apply inline button

When the distribution poller detects a public DSP URL for a scheduled song, the
artist pushes a message with `[✓ 反映する] [⏸ 後で]`.

- 反映する writes the detected Spotify / Apple Music / UnitedMasters URL into
  the relevant SONGBOOK field through the ChangeSet applier.
- 後で discards the pending proposal without changing files.
- The same callback action is idempotent; repeated taps resolve as already
  handled.

### Journey H: Song completion inline button

When the artist reports a completed take, the message includes
`[📝 SONGBOOK 反映] [⏸ 後で]`.

- SONGBOOK 反映 marks the local song state as `published`, updates
  `artist/SONGBOOK.md`, and takes backups for `songs/<id>/song.md` and
  `artist/SONGBOOK.md`.
- 後で is a no-op for files; the producer can revisit the song later.
- No X / Instagram / TikTok publish button is shown in Plan v9.14. If the
  producer posts to X manually, later distribution polling can still detect the
  public release and use Journey G for local SONGBOOK reflection.

### Retreat Flag

- `OPENCLAW_INLINE_BUTTONS=off` disables inline button attachment and returns
  operation to text-command-only confirmation.
- `/yes`, `/no`, and `/edit` always remain active and share the same
  `handleProposalResponse()` path as callback and Producer Console API actions.

### Callback Ledger / Audit Shape

- Lookup ledger: `runtime/callback-actions.jsonl`, append-only, with 24-hour
  default expiry.
- Audit log: `runtime/callback-audit.jsonl`, append-only, with no raw chat text.
  It records `{timestamp, callbackId, action, proposalId?, songId?, platform?,
  chatIdHash, userIdHash, result, reason?}`.
- `callback_data` is only `cb:<shortId>`. Telegram payloads are treated as
  modifiable input, so authority metadata lives in the local lookup ledger.
- Owner check requires `callback_query.from.id`, chat id, and message id to
  match the registered action.

### Why X / IG / TikTok Buttons Are Absent

- X real publish is deferred to a Plan v9.15 candidate with a two-step
  confirmation path and preview hash before any Bird one-shot post.
- Instagram and TikTok buttons stay hidden until auth and platform-specific
  publish readiness are established. Disabled buttons are intentionally not
  shown to avoid misleading the producer.
- Plan v9.14 only reflects local files and pending ChangeSets; it does not
  change publish gates, `liveGoArmed`, or `autopilot.dryRun=false`.

## Conversational artist and distribution polling (Plan v9.13)

Plan v9.13 changes Telegram from chained wizard prompts into producer-to-artist
conversation. The OpenClaw artist-runtime is the artist, the operator is the
producer, and Telegram is the channel between them. The artist answers as
itself, proposes ChangeSets when files should change, and waits for producer
confirmation before writing managed files.

Core journeys:

1. Persona refinement: talk to the artist with `/persona ...` or plain text.
   When a ChangeSet is proposed, use `/yes` to apply, `/no` to discard, or
   `/edit <field> <value>` to revise before applying.
2. Song discussion: use `/song <id> ...` to discuss a song. The artist can
   propose brief, lyric, note, status, or public-link changes using the same
   ChangeSet confirmation path.
3. Autonomous production: autopilot can observe, generate a theme, build a song,
   and report completed takes. `autopilot.dryRun=true` remains the protected
   default for real Suno and social side effects.
4. Distribution autoupdate: scheduled songs are polled against UnitedMasters,
   Spotify, and Apple Music/iTunes lookup. When a public DSP link appears, the
   runtime emits a distribution-change event so the artist can ask whether
   SONGBOOK should be updated.

Operational flags:

- `OPENCLAW_LEGACY_WIZARD=on`: keeps legacy command surfaces safe, but the
  removed wizard implementation is not revived in new builds.
- `OPENCLAW_PERSONA_PROPOSER=off`: disables persona AI proposer calls.
- `OPENCLAW_SONG_PROPOSER=off`: disables song proposer flows that still depend
  on the proposer service.

Runtime safety knobs:

- Suno daily budget: set `runtime/config-overrides.json` under
  `suno.dailyBudget`, or set `OPENCLAW_SUNO_DAILY_BUDGET`.
- X observation pacing: set `bird.rateLimits.dailyMax` and
  `bird.rateLimits.minIntervalMinutes` in `runtime/config-overrides.json`, or
  use `OPENCLAW_BIRD_DAILY_MAX` and `OPENCLAW_BIRD_MIN_INTERVAL_MINUTES`.
  Defaults are deliberately slow to reduce X/Bird ban risk.
- Apple Music lookup: the distribution poller looks up the artist's public
  Apple Music catalog by the artist's iTunes artist id. The poller calls
  `https://itunes.apple.com/lookup?id=<artistId>&entity=song&limit=200` and
  matches scheduled song titles.

The older `/answer` wizard flow is gone. `/skip` and `/back` are no longer
production runtime command registrations; if typed, the bot should steer the
producer back to natural conversation.

### Debug AI review command

`/review <songId>` is a Telegram debug command for inspecting a song's current
brief, latest lyrics, Suno take metadata, selected take, and prompt-pack summary.
It is outside the normal autopilot path: it does not change `selected-take.json`,
does not publish, and does not influence the autopilot publish gate.

The default provider is `aiReview.provider="mock"`, which returns a placeholder
review and writes the result to `runtime/debug-ai-reviews/<songId>-<UTC>.json`.
If a future provider is selected but not configured, the command returns a safe
"provider not configured" response rather than calling an external model.

## Plan v9.5 dogfood sequence

Use this sequence after changing the autopilot or Telegram control surface. Keep
real Suno create and social publish disabled unless a separate operator GO says
otherwise.

Default production flow: Telegram is a post-generation review surface. Autopilot
does not stop at `spawn_proposal_ready`, `planning_skeleton_pending`, or
`prompt_pack_ready` unless `OPENCLAW_PRE_GENERATION_APPROVAL=on` is set. With
the default, X/news observations can flow straight into song creation; the
producer decides after a take is ready whether to keep it, discard it, or ask for
another pass.

1. Start with `autopilot.enabled=false` and `telegram.enabled=true`, then send
   `/status`. This proves the bot worker and owner allowlist without running a
   cycle.
2. Send `/pause` and `/resume`; verify `runtime/autopilot-state.json` changes
   and no external create/publish action starts.
3. Temporarily run one cycle with `autopilot.enabled=true` and
   `autopilot.dryRun=true`.
4. Confirm the stage transition appears through RuntimeEventBus and Telegram
   notification. Automated tests cover this with mock Telegram fetch; live
   Telegram smoke is optional because Phase 2B already proved `/status`.
5. Send `/songs`, `/song <songId>`, and `/review <songId>` against the generated
   dry-run song. `/review` writes only `runtime/debug-ai-reviews/` evidence.
6. Keep `music.suno.submitMode="skip"` for form-fill style validation. Do not
   click Suno `Create` in this dogfood pass.
7. Review budget, profile, and MusicAuthority status before any later live Suno
   GO. Live create remains a separate operator decision.
8. Keep social publishing behind the existing global arm, platform arm, and
   connector edge. Telegram has no command that changes `liveGoArmed` or any
   platform arm.

### Rollback to archive-only behavior

If the operator needs the pre-revival posture, use config rather than deleting
runtime state:

```bash
node -e 'const fs=require("fs"); const p="runtime/config-overrides.json"; const c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{}; c.autopilot={...(c.autopilot||{}), enabled:false, dryRun:true}; fs.mkdirSync("runtime",{recursive:true}); fs.writeFileSync(p, JSON.stringify(c,null,2)+"\n");'
```

Then restart the Gateway process that owns the runtime. Existing songs,
ledgers, Suno budget/profile files, and Telegram inbox/debug-review records are
left in place for audit and recovery.

## Runtime log rotation

`scripts/rotate-runtime-logs.sh` rotates only top-level `runtime/*.log` files.
It moves matching logs into `runtime/logs-archive/<UTC>/` and recreates an empty
log file at the original path so appenders can continue writing.

Dry-run first:

```bash
scripts/rotate-runtime-logs.sh --dry-run
```

Then run manually when the candidate list is expected:

```bash
scripts/rotate-runtime-logs.sh
```

JSON mode reports the candidate paths and archive directory:

```bash
scripts/rotate-runtime-logs.sh --dry-run --json
```

Environment knobs:

- `OPENCLAW_LOG_MAX_SIZE_MB`: rotate logs larger than this size, default `100`
- `OPENCLAW_LOG_MAX_AGE_DAYS`: rotate logs older than this many days, default `14`

## Runtime state snapshots

`scripts/snapshot-runtime-state.sh` copies `runtime/state/` into
`runtime/state-snapshots/<UTC>/` and prunes snapshots older than 30 days. It
does not edit existing state files.

Dry-run:

```bash
scripts/snapshot-runtime-state.sh --dry-run
```

Create a snapshot:

```bash
scripts/snapshot-runtime-state.sh
```

JSON mode:

```bash
scripts/snapshot-runtime-state.sh --json
```

Environment knob:

- `OPENCLAW_STATE_SNAPSHOT_RETENTION_DAYS`: snapshot retention window, default `30`

## Cron examples

These examples are documentation only. The plugin does not register them for
you. If the operator wants scheduled checks, add entries manually with
`crontab -e`:

```cron
15 * * * * cd /path/to/artist-runtime && scripts/openclaw-doctor.sh --json >> runtime/doctor.jsonl 2>&1
30 2 * * * cd /path/to/artist-runtime && scripts/rotate-runtime-logs.sh --json >> runtime/log-rotation.jsonl 2>&1
45 2 * * * cd /path/to/artist-runtime && scripts/snapshot-runtime-state.sh --json >> runtime/state-snapshot.jsonl 2>&1
```

Keep cron output under `runtime/`; it is excluded from package artifacts and
public PRs.

## Plan v9.16 Operational foundation (2026-04-29)

Plan v9.16 は運用基盤強化 3 phase。R10 publish controls untouched、default 動作 unchanged、技術的負債解消が中心。

### Phase A: birdRunner consolidation (`8fd40bc`)

`src/services/birdRunner.ts` (192 lines) に bird CLI 関連を集約:

- `runBirdCommand(args, options)` (低レベル spawn argv 構築、shell 不使用)
- 共通 failure mapping: `bird_cli_not_installed` / `bird_auth_missing` / `bird_auth_expired` / `bird_rate_limited` / `bird_publish_failed` / `bird_command_failed`
- 高レベル wrappers: `birdWhoami` / `birdComposeDryRun` / `birdTweet`
- `buildBirdArgs` / `parseTweetUrl` helpers 統合

`xBirdConnector` (-181 lines) と `xPublishActionRegistry` (-116 lines) は全て shared runner import に置換。`spawnImpl` 注入 pattern は維持されているので既存 test も pass。

### Phase B: callback ledger 24h cleanup (`81cc348`)

`runtime/callback-actions.jsonl` の expired entry が永続蓄積する問題を解消:

- `src/services/callbackLedgerMaintenance.ts`: `cleanupExpiredCallbacks(root, options)`
- 退避: `expired` + `retentionMs` (default 7 日) 経過 entry を filter 削除
- rate limit: `runtime/callback-cleanup-state.json` で `lastCleanupAt` 永続化、default 24h interval
- atomic write + backup (R11 整合)
- `callback-audit.jsonl` は touch しない (audit 別管理)
- autopilotService cycle 開始時に呼び出し、failure は warn log のみで cycle 継続

操作:
- 自動: autopilot cycle で 24h に 1 回実行
- 手動 trigger は不要 (cycle hook で十分)

### Phase C: Producer Console SSE realtime (`11ea6d2`)

Producer Console UI の event 反映を polling から SSE push に移行:

- 新規 endpoint: `GET /plugins/artist-runtime/api/events/stream` (text/event-stream)
- runtimeEventBus subscribe → event を SSE format で push
- heartbeat 30s interval (`:hb\n\n`) で proxy timeout 回避
- secret guard: secretLikePattern 含む payload は filter / redact
- client disconnect 時に subscription 解除
- WebSocket 不採用 (one-way、HTTP 互換、proxy/CDN 対応容易)

UI:
- `RuntimeActionMirrorCard.tsx` が EventSource subscription 追加
- 既存 polling は fallback として維持 (SSE 切断時に degrade graceful)

操作: 自動有効化、退路 flag なし (UI 改善で安全)。

## Plan v9.17: Artist normal operation (2026-04-29)

御大の 3 希望 (普段ツイート / 新規曲お題 / 自発曲提案) を Phase A/B/C で実装。完成曲 X publish は Plan v9.15 Phase 4f-b 既存。すべて default disabled、御大が退路 flag を enable で発火開始。

### Phase A: Artist Daily Voice (`61fd8aa`)

artist の「曲ではない普段の X tweet」を AI が自発生成 → Telegram 二段階確認で publish。

退路 flag:
- `OPENCLAW_ARTIST_PULSE_ENABLED` (default `off`、`on` で発火開始)
- `OPENCLAW_ARTIST_PULSE_HOURS` (default `12`、最短 6h)

操作 walkthrough:
```
[autopilot cycle で半日経過 + pulse rate limit OK]
AI (Telegram push):
  preview (256 char 以内 draft + charCount + 簡易 source 表示)
  [▶ X 投稿] [✏️ 修正] [✗ 取消]

御大: [▶ X 投稿] タップ
→ hash 再検証 → bird tweet → tweetUrl 取得 → audit 記録 (raw text 不在)
```

input source:
- `ARTIST.md` (persona, obsessions, tone)
- `SOUL.md` (mood)
- `.local/openclaw/workspace/observations/` 直近
- `runtime/heartbeat-state.json` (rhythm)
- 直近の制作 fragment (lyrics draft, 不採用 take, style.md)

tone constraint: bot 臭くしない、定型句 NG、artist persona 反映 (社会風刺、知的、観察ベース、二面性)、街/制作/読書 fragment ベース。

### Phase B: /commission (`5909f7b`)

御大が Telegram で「◯◯系の曲を作って」とお題投げる → AI が brief 化 → 既存 ChangeSet inline button で確認 → autopilot song state inject。

退路 flag:
- `OPENCLAW_COMMISSION_ENABLED` (default `off`、`on` で `/commission` 受付開始)

操作 walkthrough:
```
御大: /commission 都市の境界線で見えなくなる音、4 分くらい、太い bass + jazz drum
AI (Telegram):
  ChangeSet 案できた:
  - songId (suggested): commission_d8f3a1
  - title (draft): 境界の音
  - mood: dub-influenced city pop, urban displacement
  - tempo: 132 BPM
  - duration: 4 分
  - style notes: bass を太く、jazz drum brushed pattern

  これで autopilot に投げる?
  [✓ Yes] [✗ No] [✏️ Edit]

御大: [✓ Yes] タップ
→ songStateInjector で workspace/songs/<id>/ skeleton 構築 + autopilot-state.json に inject
→ autopilot cycle で planning → suno → take_select → song_take_completed
```

完成時 Plan v9.15 Phase 4f-b の Journey I で X publish 確認。

### Phase C: Song Spawn Proposer (`3e5cf63`)

autopilot が observations / heartbeat / 直近完成曲 / SOUL から「次に何作る?」AI 判定 → デフォルトではそのまま autopilot inject。生成前に Telegram 確認したい検証運用だけ `OPENCLAW_PRE_GENERATION_APPROVAL=on` を使う。

退路 flag:
- `OPENCLAW_SONG_SPAWN_ENABLED` (default `off`、`on` で発火開始)
- `OPENCLAW_SONG_SPAWN_HOURS` (default `24`、最短 12h)
- `OPENCLAW_PRE_GENERATION_APPROVAL` (default `off`、`on` で spawn / planning / prompt pack の生成前承認を復活)

操作 walkthrough:
```
[autopilot cycle で 24h 経過 + spawn rate limit OK + observations あり]
AI (Telegram push):
  次の曲、こんな感じはどう?

  - songId: spawn_e7c3b2
  - title (draft): 静かな夜の勘定書
  - mood: late-night, observational, slight sarcasm
  - tempo: 128 BPM
  - duration: 4 分
  - reason: 直近の observations で「再開発の経済合理性」というテーマが繰り返し出てる、SOUL.md mood "observational" と整合、budget 残 33/50 OK

  [✓ 進める] [✗ 今は要らない] [✏️ 修正]

御大: [✓ 進める] タップ
→ Phase B injector 流用で autopilot に inject
```

skip 条件: 直近完成曲との距離短い / 予算ぎりぎり / observations 乏しい / heartbeat mood "rest" 系。

### Plan v9.17 通常運転手順

1. **gateway 再起動** で Plan v9.16/v9.17 反映 (現プロセスは古い dist を memory に保持):
   ```bash
   source scripts/openclaw-local-env.sh
   .local/openclaw/bin/openclaw gateway stop
   scripts/openclaw-local-gateway start
   ```
2. **退路 flag enable** (御大の運用シナリオに応じて):
   ```bash
   export OPENCLAW_ARTIST_PULSE_ENABLED=on
   export OPENCLAW_COMMISSION_ENABLED=on
   export OPENCLAW_SONG_SPAWN_ENABLED=on
   ```
3. **bird auth 確認**: `bird --firefox-profile <your-artist-firefox-profile> whoami --plain` で artist account を確認
4. **Telegram で動作開始**: bot worker が Telegram 経由で event push、御大が button 操作

### R10 守備 (Plan v9.17 全 Phase)

publish gate / liveGoArmed / autopilot.dryRun=false **完全 untouched**。

- Phase A: daily voice の bird tweet は御大の `[▶ X 投稿]` button タップ + hash 一致 が唯一の判断 path
- Phase B: commission inject 後も autopilot.dryRun / liveGoArmed 触らない
- Phase C: song spawn inject 後も同上
- 各 phase に R10 untouched dedicated test 同梱 (`r10-daily-voice-untouched.test.ts` / `r10-commission-untouched.test.ts` / `r10-song-spawn-untouched.test.ts`)

## Plan v9.18: Autopilot self-run and SONGBOOK care (2026-04-29)

Plan v9.18 closes the practical gap between "song injected" and "song reaches a
completed take." Phase E strengthens the four autopilot stages. Phase F keeps
`artist/SONGBOOK.md` aligned with song state and public Apple Music links. R10
controls remain untouched: this plan does not arm publish gates, does not set
`liveGoArmed=true`, and does not flip `autopilot.dryRun=false`.

### Phase E-1: Planning skeleton validator (`0d59653`)

`planningSkeletonValidator` checks whether a planning-stage song has the minimum
shape needed to move forward:

- required planning fields: title, mood, tempo, duration, style notes, and lyrics
  theme
- source files: `songs/<id>/song.md` and `songs/<id>/brief.md`
- secret guard on input context, AI completion response, and final drafted text

If fields are missing, autopilot emits a planning-skeleton event and Telegram
pushes an inline confirmation path.御大 can apply the suggested skeleton, skip it,
or edit through the normal ChangeSet path. Apply moves the song toward
`suno_compose`; skip leaves it for a later cycle. If planning stays stalled for
the configured timeout window, default 7 days, autopilot pauses and records
`planning_stalled_<N>days` in state instead of spinning forever.

### Phase E-2: Suno generate stage (`2f33a25`)

The Suno stage now has an explicit guard and retry layer:

- `sunoBudgetGuard` checks daily budget before a generate attempt. Budget-low
  cases emit a Telegram notification and pause/skip the unsafe path.
- `sunoRetryHandler` applies bounded exponential backoff for transient Suno
  failures.
- hard failures emit `suno_generate_failed` and leave the artist in a recoverable
  paused state instead of silently dropping the song.

This stage still respects the existing Suno authority gates. Dry-run mode blocks
real Suno create; Plan v9.18 only makes the internal stage transition and failure
reporting more deterministic.

### Phase E-3: Take select stage (`3b7603d`)

`sunoTakeScorer` gives each imported take a score from three axes:

- `lyrics_score`: lyric completeness and fit to the brief
- `sonic_match`: match against style notes, tempo, and arrangement expectations
- `mood_alignment`: fit against the song mood and artist voice

`sunoTakeSelector` picks the best take with tie-break rules and threshold gates.
If every take is low-score, Telegram asks御大 for a judgment with inline buttons:
adopt the best take anyway, request Suno regeneration, or skip for later. The
callback handlers update local stage state only; no publish flag or social arm is
changed.

### Phase E-4: Completion and full-cycle close (`314eb1d`)

The completion stage now closes the dry-run-safe song loop:

- `writeCompletedStage` writes completed state from selected take data.
- SONGBOOK reflection is coupled to the completion writer with backup-protected
  local file updates.
- failure paths pause with an explicit reason instead of losing the selected
  take.
- the mock e2e covers planning -> suno -> take_select -> completed.

After this phase, a commission or spawn-injected song can progress through the
four-stage autopilot path without stopping at planning or take selection, while
real external side effects remain governed by the existing gates.

### Phase F: SONGBOOK automation (`a43bdc5`)

Phase F adds a maintenance layer for `workspace/artist/SONGBOOK.md`.

`songbookValidator` detects:

- missing SONGBOOK rows for existing song state
- status drift between `songs/<id>/song.md` and SONGBOOK
- missing Apple Music links when a public iTunes/Apple candidate is available
- incomplete rows that can be re-filled from local song state

`itunesArtistLookup` uses the public iTunes Search API for the configured artist:

```text
artistId: <artist iTunes id>
country: <locale, e.g. jp>
endpoint: https://itunes.apple.com/lookup?id=<artistId>&entity=song&limit=200&country=<locale>
```

The lookup returns public metadata and track URLs only. Responses still pass the
secret-like guard before parsing.

`songbookSyncer` combines validation and lookup results, then writes through the
existing song-state writer. Before changing `songs/<id>/song.md` or
`artist/SONGBOOK.md`, it takes backup entries with the same backup discipline
used elsewhere in the runtime.

Producer-facing paths:

- Producer Console: Runtime SONGBOOK card shows validation issues, rows, and
  lookup/sync buttons.
- API: `GET /plugins/artist-runtime/api/songbook/lookup` previews validation and
  Apple Music candidates.
- API: `POST /plugins/artist-runtime/api/songbook/lookup` applies sync through
  the backup-protected writer.
- Autopilot: `OPENCLAW_SONGBOOK_AUTO_SYNC=on` allows the autopilot cycle to run
  the sync hook. Default is off. Keep it off unless御大 wants background
  SONGBOOK upkeep. Use it with the normal slow 12-24h autopilot operating
  cadence; for rapid local test loops, prefer the manual API/UI path.

Plan v9.18 does not add Instagram or TikTok posting. Those buttons remain absent.
X publish remains the Plan v9.15 two-step Telegram confirmation path.

### Plan v9.18 通常運転手順

1. **gateway 再起動** after pulling/building the v9.18 commits:
   ```bash
   source scripts/openclaw-local-env.sh
   .local/openclaw/bin/openclaw gateway stop
   scripts/openclaw-local-gateway start
   ```
   If the local wrapper is already supervising the gateway, use the equivalent
   project restart wrapper that reloads `dist/`.
2. **R10 posture check** before live operation:
   ```bash
   curl -s http://127.0.0.1:43134/plugins/artist-runtime/api/status \
     | jq '.config.autopilot.dryRun, .config.distribution.liveGoArmed, .config.distribution.platforms.x.liveGoArmed'
   ```
   Expected protected posture: `true`, `false`, `false`.
3. **Manual SONGBOOK preview** from Producer Console or API:
   ```bash
   curl -s http://127.0.0.1:43134/plugins/artist-runtime/api/songbook/lookup | jq '.validation.issues'
   ```
4. **Manual SONGBOOK sync** only after the preview is expected:
   ```bash
   curl -s -X POST http://127.0.0.1:43134/plugins/artist-runtime/api/songbook/lookup | jq '.updated, .validation.issues'
   ```
5. **Optional background sync**:
   ```bash
   export OPENCLAW_SONGBOOK_AUTO_SYNC=on
   ```
   Restart the gateway after changing the environment. The default is off, so a
   normal install will not call iTunes lookup from autopilot unless御大 opts in.

### R10 守備 (Plan v9.18)

- Phase E strengthens planning, Suno, take selection, and completion state
  transitions only.
- Phase F reads public iTunes metadata and writes local SONGBOOK state only.
- `autopilot.dryRun`, global `liveGoArmed`, and X platform `liveGoArmed` remain
  unchanged. Dedicated R10 tests cover planning, Suno, take-select, completion,
  and SONGBOOK sync.
- IG/TikTok publish remains outside Plan v9.18.

## See also

- `docs/RUNTIME_CLEANUP.md`
- `docs/INCIDENT_RESPONSE.md`
- `docs/ERRORS.md`
- `docs/SUNO_BROWSER_DRIVER.md`
- `docs/OPERATOR_QUICKSTART.md`
- `docs/TROUBLESHOOTING.md`

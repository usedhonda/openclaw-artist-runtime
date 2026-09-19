# Handoff: Producer-musician creation loop

## Deployed: 901e7d4 on GrokBot; live Suno output pending (2026-09-19 JST)

The producer transferred the working side from CC to Cdx. GrokBot has restarted
after building `901e7d4`; live Max Mode On / Personalize Off output still needs
to be observed on the next normal prompt pack / Suno form.

- GrokBot was already at `901e7d4` with `npm run build:runtime` completed and no
  human-assist wait. The earlier `restart` request correctly performed an
  in-process SIGUSR1 restart: its unchanged child pid `2429441` was expected,
  and loaded JS modules were not refreshed. For a code update, Cdx therefore
  used a full stop followed by start. In future, when no human-assist wait is
  active, use ordinary `stop` first; `--force` is unnecessary.
- New supervisor pid is `3067824`; new gateway child pid is `3067894`.
  `scripts/openclaw-local-gateway status` reports `gateway_state=running` and
  `Connectivity probe: ok`. The built artifact timestamp is
  `2026-09-19 10:11:23 UTC`; the child start time is
  `2026-09-19 10:22:45 UTC`, so the process started after that build.
- The built artifact exports the producer defaults as Variety 2, Max Mode On,
  Personalize Off, Duration 3:30, and Style Influence 100. This is deployment
  evidence, not live Suno-output proof. No song was generated and Create was not
  pressed; verify the next normal prompt pack and actual form before calling the
  behavior proven live.
- `restart` is for rebuilding in-process lane/config state, not loading new JS.
  When it is used, record its returned `status` (`scheduled`, `deferred`, or
  `coalesced`); for `deferred`, also preserve the `restart deferred: <reason>`
  log entry.
- Tailscale SSH: the added `accept` rule for user `box` has no effect, because
  Tailscale applies `check` over `accept` when both match. Removing the check
  needs the default `check` rule's users narrowed to `["root"]` in the tailnet
  policy file. The producer approved one check at about 14:00 JST; it lasts
  about 12 h.

## Restored: Suno Max Mode On / Personalize Off (2026-09-19 JST)

The producer confirmed the standing normal controls are Max Mode On and
Personalize Off (ruling of 2026-09-17, `ce23c62`). `6b89bbe` had silently reverted
them to Off/On inside the tabbed-form fix, so `song-184` was generated with the
wrong pair. The revert is undone, and the ruling is now recorded in
`docs/PRODUCER_DECISIONS.md` and pinned by `tests/producer-decisions.test.ts`.
AGENTS.md §5 forbids changing a producer decision without the producer's
instruction. Sections below that say "Max Mode Off, Personalize On" are
historical.

## Completed: tabbed Create live generation and Telegram proof (2026-09-18 JST)

`Unobserved Now` (`song-184`) completed the current Song/Sounds UI path. The
actual GrokBot CDP target was verified before Create with 2922 lyric characters,
980 style characters, title and Exclude filled, v6, Duration 3:30, Max Mode Off,
Variety 2, Personalize On, and Style Influence 100. Run `suno_mu6fx5ic` was
accepted with two take URLs and advanced to `take_selected`. Telegram completion
message 1977 was verified in the live desktop app and contains the artist's
explanation, lyric/technical notes, both links, previews, and review buttons.

The final selector correction is `111265d`: the current model trigger is exposed
as `Model: v6`. Earlier tab hydration and Lyrics/Styles role-button fixes are in
`8ae6488` through `6b89bbe`. GrokBot runs `111265d`; no human-assist wait remains.
Operational evidence is in
`docs/log/codex/124-suno-tabbed-create-live-verification.md`.

## Analyzed: Suno tabbed Create UI (2026-09-18 JST)

The live desktop Create page now has top-level Song and Sounds tabs. Song owns
the collapsible Lyrics, Styles, and Controls panels; Sounds is a separate
one-shot/loop generator with a 500-character sound description, BPM, and Key.
The reusable DOM/ARIA map, extension state machine, selector hazards, and minimum
regression matrix are documented in
`docs/SUNO_CREATE_TABBED_UI_ANALYSIS.md`. No form value, browser/gateway state,
Create action, or runtime source was changed during the investigation.

## Prepared, awaiting manual Create: Rubber Stamp Ears (2026-09-17 JST)

The producer asked for the `Fifteen Second Expert` lyrics (`spawn_dc796c`) to be
rewritten in full under the new lyric contract and for the song to stop right
before Create. Done, with three live Suno preparation fixes found on the way.

- The gateway was restarted with `stop --force` so the new lyric module loaded;
  the song was reset to `brief` with lane `prompt_pack` and retry 0, then one
  cycle drafted lyrics v2 (xhigh, about 3 minutes) and pack `prompt-pack-v002`.
  Drafting renamed the song to `Rubber Stamp Ears`.
- The new pack carries the new-contract markers: `いちまるきゅうまえ` for 109,
  `しぶや` used once, vowel-chain and internal-rhyme lines, no repeated target
  label as a hook. The creative monotony monitor warned that the attack stance
  「速度への挑発」 repeated for two songs in a row (Telegram message 1944).
- Three preparation failures were fixed and deployed (`97552e1`, `2b2ee7e`,
  `0cc9841`): live Suno sliders ignore Home/End so sliders are now stepped from
  their read-back value; boolean rows are located by an On/Off toggle because
  the Personalize label sits beside a "My Taste" button; and the collapsed
  "More Options" panel is expanded before any control is set because its header
  intercepts clicks. Each fix has a real-Chromium regression that failed before
  the change.
- Active manual-assist wait: run `suno_mu48uoq6`, gateway pid `1752669`, Telegram
  card 1947. `suno-evidence/suno_mu48uoq6/prepared.json` (verified UI readback)
  shows the full lyrics, title, style, exclude, model v6, Weirdness 50, Style
  Influence 100, Variety 2, Max Mode Off, Personalize On; the screenshot shows
  Duration 3:30 and an unpressed Create. Create is pressed only on explicit
  producer direction.
- The producer judged the manual-Create Telegram card useless as a song
  description, so `c1d95d3` adds the observation summary, the artist's angle,
  the hook quote, and the style line to that card. The running gateway still
  holds the old composer; the rebuilt card was sent once for this song as
  Telegram message 1948, and the new code takes effect at the next restart.
- Producer feedback on the card continued: the source URL and the listening
  notes were missing next to the previous song's completed report. `b2c5c0d`
  adds the observed quote with author and URL, the concept, the hook reason,
  the listen-for points, and the musical intent; that version was sent for this
  song as Telegram message 1949. `3dc2a41` then maps Suno preparation and
  browser failures (closed page, unsettable control, click timeout) to one
  plain Japanese clause instead of a raw Playwright call-log dump.
- Blocked at the time of writing: Tailscale SSH asked for re-authentication, so
  the box could not be updated or driven; and the local safety classifier
  refuses the Create click as a real-world transaction even though the producer
  directed it. Neither is a runtime fault.
- Known cosmetic gap: the readback record stores `duration: "Off"` although the
  slider reads 3:30 on screen (text-control readback picks the wrong segment).
  Not fixed; noted for a later change.

## Active handoff: CC Solo takes the working side (2026-09-16)

The producer explicitly transferred this project from Cdx Solo to CC Solo. CC is
the next working side and should continue from the state below without redoing the
completed lyric work.

- Commits `64039b4` and `fd99364` are on `origin/main`, deployed to GrokBot at
  `fd993649e6d381cf5123976d0aef0ad561d2bec0`, and built there.
- The private used::honda profile on GrokBot has SHA-256
  `d049bcc579dba60a0c255a496247496fd1c05b4e723172847ba4b929f4c17374`.
- Focused lyric/pronunciation tests pass 30/30; typecheck, lint, and runtime build
  pass. Full suite is 2,130/2,131 with only the pre-existing randomized
  tempo-band test missing `slow`.
- The active human-assist wait is still `spawn_dc796c` for `Fifteen Second
  Expert`. Do not restart the gateway, navigate or close its browser, refill the
  form, or click Create unless the producer explicitly directs it.
- Because the gateway was intentionally not restarted, the new tracked lyric
  module loads on the next safe canonical restart after that manual wait clears.
  The private artist profile itself is already updated.
- New lyric contract: `渋谷109` becomes `しぶや いちまるきゅう`; Japanese rap
  uses explicit 2-4 mora vowel chains, compound/internal rhyme and cadence turns;
  city/ad critique starts from varied indirect imagery rather than repeated names.

## Applied: indirect Japanese diss and audible rhyme contract (2026-09-16)

The used::honda lyric path now treats `渋谷109` as a proper name and renders it
for Suno as `しぶや いちまるきゅう`; unrelated numeric uses such as `109えん`
retain their ordinary number reading. Japanese rap drafting now specifies one or
two 2-4 mora vowel-chain anchors per verse, compound and internal rhyme inside
each four-bar unit, carried line endings, cadence changes, and wordplay, while
keeping meaning and natural Japanese ahead of forced rhyme.

City and advertising critique now starts from a fresh transformed image and its
physical effects before using a target label. The live private used::honda profile
rotates indirect attack stances such as decaying terrain, bright empty boxes,
speaking walls, shadowed white coats, and construction-noise prosody; examples are
invention patterns rather than reusable catchphrases. The profile was updated on
GrokBot without restarting the gateway or touching the active manual Create page.
Focused drafting/pronunciation tests pass (30/30).

## Applied: normal Suno V6 control defaults (2026-09-16)

The producer set the standing normal-generation defaults to Max Mode Off,
Custom Duration 3:30, Variety High (2), Personalize On, and Style Influence 100.
New prompt packs now store these controls in the hashed `suno-payload.json`;
the nested CLI slider payload also carries Style Influence 100. Production
revisions inherit the same defaults, including revisions based on older packs.
Legacy unchanged packs remain immutable.

The already prepared `Fifteen Second Expert` form was updated in place through
its exact CDP page. Readback was Duration 210 seconds, Max Mode false,
Personalize true, Variety 2, Weirdness 50, and Style Influence 100. The title
remained exact, the Create button remained visible, and no Create click occurred.
Commit `5bfaeb6` is deployed and built on GrokBot. The browser and gateway were
not restarted because the manual Create wait is active; the new source default
loads on the next safe canonical gateway restart after that wait clears.

## Prepared, awaiting manual Create: V6 controls (2026-09-16)

Approved scope: integrate suno-kit `a3ae7cd`, improve relationship-based prompts,
preserve manual Create, verify preparation, and distinguish recommendation / UI
readback / observed submitted material. At this earlier checkpoint, Personalize
and Max Mode advice was not automatically applied; the standing defaults above
supersede that preparation policy. Existing ledger formats and public config shape
are unchanged.

Independent slices are committed: vendor/prompt guidance, pre-Create UI helper,
and Telegram observed-material grounding. The integration adds a passive exact-page
generate observer with strict musical-field allowlisting and response clip-ID
binding. Credentials and raw network bodies are not retained. Runtime commit
`3147c9c` is deployed through a Git bundle; no upstream push was performed.
Typecheck, lint, and build pass. Full tests: 2,127 pass, one pre-existing
tempo-distribution failure (missing slow sample). Focused preparation and passive
wait tests pass, including a real Chromium fixture.

Live preparation reached `Fifteen Second Expert`, song `spawn_dc796c`, run
`suno_mu3wbo2j`. Readback matched lyrics (2,599 characters), Style (995), Exclude
(80), and title. Observed controls: V6, Weirdness 50, Style Influence 50, Variety 2.
At the producer's request, the live form was then changed before Create to Max
Mode On, Personalize On, and Custom Duration 3:15 (195 seconds), matching the
song's duration plan; all values were read back and Variety remained 2. The My
Taste profile editor was inspected but its saved profile text was not changed.
Preparation guidance was delivered as Telegram message `1940`. Screenshot and
DOM readback confirmed the filled form and unpressed Create boundary. Proposal
and original preparation evidence exist; actual submission capture and
completed-song Telegram delivery remain unverified.

An active manual-assist wait owns this prepared page. Do not restart the gateway,
navigate, refill fields, or click Create during verification.

## Resolved: artist-authored Telegram new-song message (2026-09-16)

Successful song delivery is now one artist-authored message instead of a
completion/status report. It presents the bound news link and factual summary,
the artist's reaction, how that reaction became lyrics, selected technical lyric
details, the musical transition, and listening points. The formatter uses the
immutable submitted Prompt Pack, persists a `creative-note.json` beside each new
pack, and reconstructs the same format for legacy packs without inventing an
audition. Progress-only Suno URL notices are silent; errors and stalls remain
system notices.

Commits `7ffeec5`, `6868121`, and `b2b66c8` are deployed on GrokBot. A true
gateway-child replacement was required because the ordinary in-process restart
kept the old loaded plugin module. The live V6 trial `Permission Not Possession`
(`spawn_ec22a4`, run `suno_mu3mxh1d`) generated two accepted Suno URLs and
delivered exactly one completion text as Telegram message `1939`. Native Telegram
inspection confirmed the new ordered sections and no visible `提出する` report.
The selected take links are present; the current import attempt recorded no local
audio path, so the message correctly stayed link-only.

## Resolved: bilingual pronunciation, V6 prompt guidance, and Telegram proof (2026-09-16)

English spans in Japanese-led lyrics now remain in an English pronunciation
domain: numeric English phrases are written as English words (`72 hours` becomes
`seventy-two hours`), and drafting guidance keeps language switches at clean
phrase or section boundaries. The vendored suno-kit is already at upstream main
`afb421d569bf08e28c6c0a4d2030f093d1ef9fab` (0.4.0); no vendor replacement was
needed. V6 Style guidance now prioritizes explicit attribute relationships and
removes the undocumented 760-900 character padding target.

The live V6 song `Small Bite Alibi` (`spawn_0ebe69`) completed with two imported
Suno URLs and selected take `1bdefc68-ff68-43a7-981e-f27edc266e65`. Its bound
source is a Yomiuri report about the Fukuoka assembly Paris dinner. Telegram
completion message `1935` exposed a remaining formatter defect: the Japanese
publisher became `@unknown` and raw prompt language dominated the explanation.
Commit `7df53d5` preserves publisher names and turns the bound background, opening,
hook, section movement, turning point, and sound design into explanatory prose.
It is deployed; the gateway restarted cleanly with no human-assist wait. The
corrected completion was re-sent as Telegram message `1936` and visually checked
in the native Telegram client: `読売新聞`, its article URL, detailed song background,
actual hook, full section movement, turning point, and production design are all
present, with no ARTIST.md/SOUL.md boilerplate.

## Resolved incident: Suno browser disappeared after generation (2026-09-16)

The producer observed the GrokBot Suno window disappear after the accepted
`Vacant Seat Warranty` generation. The accepted human-assist path released its
last `SunoBrowserService` holder, which closed the plugin-launched persistent
Chrome; its driver also closed an owned page or navigated a reused page home.
The persistent browser now remains alive after holder release, and an accepted
generation preserves and foregrounds its exact result tab. Failed plugin-created
input tabs retain their existing cleanup behavior. Focused tests, typecheck, lint,
and build pass. The full suite remains at 2,103/2,104 because the pre-existing
tempo-distribution test still misses the `slow` band. Commit `9bc57d3` is deployed
on GrokBot. After a fresh gateway child loaded it, `/api/suno/connect` opened and
then released the final browser hold; six seconds later the Chrome process and
visible authenticated Suno Create/results window were both still present.

## Live checkpoint: cadence diagnosis and new song delivery (2026-09-16)

The producer changed `autopilot.songsPerWeek` to 50 and the song-spawn interval
to 13 hours, but no immediate song appeared. Live evidence showed that
`songsPerWeek` is a weekly cap, while `songSpawn.minIntervalHours` independently
blocked another automatic proposal until `2026-09-16T04:59:41.896Z`; status hid
that distinction behind `song_spawn_waiting_for_proposal`. An operator-requested
cycle safely bypassed only this one cooldown, refreshed observations, and created
`spawn_93fc42` (`Vacant Seat Warranty`). The Suno form was filled correctly; the
configured manual submit mode stopped on the visible Create button, which was
clicked through the GrokBot screen. Suno accepted run `suno_mu3gi92k` with two
take URLs, the runtime selected take `25f16aec-aa72-4a73-94b6-ff2915e2e8ff`, and
Telegram delivered the detailed completion as message `1931`. Failed notification
count remained zero. No persistent config or source code was changed.

## Checkpoint: song-specific Telegram explanations (2026-09-16)

The completion formatter now uses the run-bound immutable lyrics and style pack
to report the song's observation background, opening scene, actual hook, section
progression, turning point, BPM, and arrangement language. It rejects persona-file
and machine-artifact prose instead of falling back to an `ARTIST.md`-shaped stock
line. Typecheck, zero-warning lint, runtime/UI build, the 27-test formatter gate,
and the 17-test voice/privacy follow-up pass. The full suite passes 2,103 of 2,104
tests; only the pre-existing tempo-distribution test still misses the `slow` band.
Commit `5a2ee15` is deployed on Linux, where the runtime/UI build passed and the
gateway restarted after a zero-active-work preflight. The gateway returned ready,
Telegram polling ingress restarted, and a live completion for `spawn_857237` was
delivered as Telegram message `1927`. Before sending, the live formatter output was
checked for all five explanation sections, the X source, and absence of persona-file
or old stock prose; the append-only delivery ledger records the receipt.

## Resolved incident: thin Telegram song explanations (2026-09-16)

The producer observed that completed-song explanations had become extremely terse
and news sources disappeared. The song brief retained the selected source, but
commission injection did not persist it to song state; completion events without an
observation summary therefore discarded the explanation and source. Separately, a
timed-out AI spawn pitch fell back to a card that omitted its source footer.

The repair persists the first frozen source and artist motivation in song state,
uses that immutable song-bound summary when completion events omit it, emits a
grounded explanation plus source URL, and keeps the source footer on spawn-pitch
timeouts. Focused regressions cover all three paths: 25 relevant tests pass,
along with typecheck, lint, and the runtime/UI build. The full 2,103-test gate
has 2,100 passes and three failures: two formatter regressions were corrected
and now pass; the remaining pre-existing tempo-distribution test still misses
the `slow` band and is outside this incident scope. The live V6 trial
`spawn_857237` reached `archived` with two accepted Suno URLs. Its frozen X
source was restored to song state and a corrected `song_take_completed` message
was delivered to Telegram with the explanation, quote, and source URL; the
append-only delivery receipt confirms acceptance. A forced production observation
refresh also replaced the three-day empty news cache with five current entries
carrying publisher URLs, proving the repaired OpenAI runtime path can again perform
news editorial selection.

## Resolved incident: Telegram error flood (2026-09-15)

The live host had two gateway owners. A manually launched orphan gateway
(`4134014`) retained the state directory and loopback port while the canonical
tracked supervisor retried every 60 seconds. Its children exited at startup with
`Another gateway ... already owns this state directory`; the crash counter reached
3,649 and the append-only crash ledger grew to 346,536,700 bytes.

The orphan alone was terminated after confirming zero pending Suno take waits.
The existing supervisor then acquired the gateway normally as child `1202709`.
Verification showed `gateway_state=running`, Telegram polling ingress started,
Suno connected, zero failed plugin notifications, and no crash-ledger growth after
recovery. Do not start the legacy host-local direct gateway launcher
directly; use `scripts/openclaw-local-gateway` so the supervisor remains the sole
owner.

## Active incident: autonomous song timeout and Suno V6 migration (2026-09-12)

Live status showed three consecutive songs parked before Suno with
`native_runtime_timeout`; the Suno worker and ticker remained connected. The
lyrics-only `xhigh` override is being replaced by the proven `high` level.

The updated suno-kit adds V6 model identifiers and controls, but a wholesale
vendor sync removed artist-runtime's protected exact-target feed, audio fallback,
and CDP-login patches and failed 12 focused tests. The vendor tree now carries
only the reviewed V6 delta on top of those protected patches. The sync script
fails before replacement until suno-kit absorbs the protected patches.

Current acceptance target: full local gate, commit, Linux reflection, then one
operator-requested song through lyrics, V6 prompt pack, prepared Suno form, and
Telegram receipt. No public publish, CAPTCHA handling, login action, or Max Mode.

Checkpoint: commits `fb35d38` and `7f8c8c6` are deployed on Linux. The local gate
was green (2100 tests). The operator-requested trial became `Mute the Magic`
(`spawn_ca32b7`) and reached `take_selected` with two imported Suno URLs. The
gateway ownership incident above did not roll back the V6 runtime.

## Active goal: producer-musician creation loop (2026-09-09)

The earlier preparation repair did not complete the producer's required workflow.
The active task is to make conversation lead to an interpretable musical revision,
an actual trial, a musician-facing submission, comparison, and a further revision
or producer adoption. Do not equate tool success or form preparation with this goal.

- Production revisions: implement arrangement/title/BPM changes independently of
  lyric changes, preserving prior material and accepted audio.
- Conversation: persist subject, request, constraints, exact trial and pending
  decision; background events must not change the conversation subject.
- History: compare and select a take from its actual song/run, not latest results.
- Reports: exact submitted version, request/delta, playable references and grounded
  listening guidance; operational diagnostics are not the song submission.
- Verification: focused regressions, integrated required gate, Linux reflection,
  actual Telegram trial submission and reply-driven continuation.
- Current deployment access: normal Tailscale SSH now succeeds. The committed
  runtime was rebuilt and reflected through a safe gateway-child replacement.
- Boundaries: manual Create, no public publishing, no CAPTCHA automation, no
  broader tool permissions, no existing ledger-format changes.

Implementation ownership: production-revision worker owns revision persistence;
report worker owns song notifications; history worker owns take selection/material
history; root owns trusted conversation context, tools, run integration and rollout.

Local implementation checkpoint: immutable production revisions, durable trusted
conversation and reply bindings, queued manual preparation, trial import,
historical adoption, and Telegram audio transport are implemented. Reporting now
compares immutable material, keeps original audio, and gives concrete listening
points without claiming audition. Existing normal X/SONGBOOK controls remain.

Verification: the initial implementation passed 411 files / 2,094 tests,
typecheck, lint, runtime/UI builds and boundary/maintainer scans. The subsequent
producer-authorization correction passed its regression tests, typecheck, full
lint and runtime build. Its full suite passed 2,095 tests with one old fixture
failure; that fixture was corrected and all three tests in its file passed,
followed by scoped lint. Unaffected green results were retained.

The first live request exposed a mismatch between native gateway ownership and
the existing Telegram producer allowlist. Commits `f77b938` and `6b4f9b6` correct
the guard and fixtures without granting gateway administrator rights. Both are
deployed on Linux. The repeated actual Telegram request successfully saved a
production revision and prepared Suno. The original adopted take is preserved.
The first prepared run is `suno_mtsymk9p`, production pack 4, prepared at
`2026-09-08T17:45:17Z`. Its title is bilingual, tempo is 148 BPM, and lyrics refer
to the unchanged adopted version. Independent payload readback then found a
contradiction: legacy `BPM 94` survived beside `148 BPM`. No Create was clicked.
The agent closed only its prepared Suno tab; the runtime detected closure and
released its browser. The BPM replacement missed prefix notation. Commit
`e28f404` fixes both notation forms and is deployed. All 411 files / 2,097 tests
passed, along with typecheck, relevant lint and runtime build. The failed run has
no URLs; its pending marker cleared, and a fresh zero-active-work preflight
preceded reflection. Preserve the bad pack as history. The corrected natural
Telegram request produced pack 5, but full payload readback exposed a second
tempo inconsistency: the submitted Intro instruction and YAML vocal-pacing note
still said 92 BPM, while Style and YAML `tempo` said 148. This is a submitted-
payload consistency gap, not another notation-only patch. The canonical lyric
source must remain immutable; rendered production directions must be updated
without touching sung text. Commit `64c6e76` corrects the full rendered contract:
Style, YAML production notes/cues, tempo fields and section directions agree;
canonical source and literal sung tempo references remain unchanged. Its regression
failed before the fix, then all 2,098 tests passed, with typecheck, relevant lint,
and local/Linux runtime builds passing. The commit is deployed; an idle preflight
allowed replacement of only the gateway child, preserving its supervisor.
No Create was clicked for either prepared run. The agent closed the pack-5 Suno
input tab as well; its pending marker cleared before reflection.
Do not report this goal complete.

Live checkpoint: actual Telegram prepared pack 6 and acknowledged manual Create
at `2026-09-08T18:10:18Z`, run `suno_mtszir4z`. Independent stored-payload readback
found only 148 BPM in Style, submitted Lyrics and YAML, with canonical lyric bytes,
lyric hash, title and original adopted take all preserved. The actual Linux Suno
screen shows the bilingual title and an unclicked Create button. This run is
pending manual submission: do not restart its gateway or close its input tab.

Next: operator manual Create. Then verify actual audio import/submission and
reply-driven revision or historical adoption. Never substitute fixtures for live
proof.

## Completed checkpoint: conversational production repair (2026-09-08)

See [the archived completion record](archive/2026-09-08-telegram-production-repair.md).
Linux runtime reflection, real Telegram revision/adoption/preparation, and manual
window persistence are verified. The prepared form is left for the operator;
the existing configured human-submit deadline still applies. Do not restart the
gateway while that pending manual run is active.

The historical parity checkpoint below is retained as prior context, not current
evidence for Telegram enablement or live gateway configuration.

Task ID: linux-host-parity-20260906
Last updated: 2026-09-06 (UTC+9) by orchestrator
Status: in-progress

## Objective
Bring the artist-runtime gateway to parity on a Linux host: the Mac-only
gateway lifecycle is retired, the Suno browser lane and creative pipeline
behave correctly under Linux constraints (containers, no systemd, small
`/dev/shm`), and the operator docs describe how the runtime actually behaves
today rather than the prior Mac-only assumptions.

## Scope
- Linux gateway lifecycle (systemd `--user` units, and the tracked supervisor
  path for hosts without systemd)
- Suno browser ownership (launch vs attach) and human-assist reliability on
  Linux
- Creative pipeline correctness for the structure axis (validator + monotony
  watchdog) introduced by the Dis-dominant creative spine
- Test isolation so live-workspace state cannot leak from the test suite
- Operator-facing docs and this handoff kept in sync with the above

## Explicitly out of scope
- New Instagram/TikTok publish lanes (remain frozen per operator decision)
- Config schema, ledger format, or `package.json.files` changes
- CAPTCHA automation or login-challenge automation

## Current state

Checkpoint 2026-09-07 (whole-system audit on the Linux host):

- Scheduled autopilot ticks ignored config overrides changed after boot (the
  ticker pinned the boot-time snapshot as the tick payload). Fixed in
  `src/services/autopilotTicker.ts` (`scheduledBaseConfig`); the host's `dist`
  is rebuilt and the fix takes effect at the next gateway restart. Until then
  the ticker watcher's safe tick drives cycles.
- The launcher derived in-host HTTP/WS URLs from the tailnet address even when
  the gateway is bound to loopback, so the ticker watcher's safe tick and the
  status connectivity probe always hit a closed port. Fixed in
  `scripts/openclaw-local-env.sh`.
- Out-of-band watcher restarts need the gateway's safe-tick token; without a
  fixed `OPENCLAW_SAFE_TICK_TRIGGER_TOKEN` in the machine-local env the launcher
  generates a fresh random one per shell. A fixed token is now set on the host
  (applies at the next restart). Before that restart, kill the manually started
  watcher so the supervisor's own watcher is the only one.
- Open: the Producer Console is reachable only on loopback on the host. Moving
  to a tailnet bind with token auth needs a gateway restart, which must wait for
  the outstanding human-assist Create window to close (marker
  `runtime/suno/human-assist-pending.json`).
- Open: the plugin's `llm.complete` path did not fall back when the primary
  model returned HTTP 429; the operator temporarily switched the primary model
  by hand. Verify OpenClaw fallback behavior on that path before relying on it.

Several parallel lanes landed fixes toward Linux parity:

- The Mac-only gateway posture is retired; Linux is now a first-class host.
  `scripts/openclaw-local-gateway start|stop|status|health` (the tracked
  supervisor) is the lifecycle owner on a Linux host without systemd
  (containers); `systemd --user` templates under `scripts/linux/` are the
  lifecycle owner on a Linux host that runs systemd. Both are documented in
  `docs/LOCAL_RUNTIME_OPS.md`.
- `SunoBrowserService` owns the Suno browser lifecycle in one of two modes:
  **launch** (default, no `cdpEndpoint` configured) is now Linux-aware
  (`--disable-dev-shm-usage`) and closes its own window when the last holder
  releases it; **attach** (a configured `cdpEndpoint`) never closes the
  externally owned browser and now returns a reused tab to the Suno home
  surface after an accepted submit. See `docs/SUNO_BROWSER_DRIVER.md`.
- Human-assist manual-submit is now single-flight: an outstanding wait blocks
  further creates behind a durable marker, and a closed tab/disconnected
  browser fails the wait fast instead of polling forever.
- The Dis-dominant creative spine's `structure` axis (section order rotation)
  is now validated correctly by the prompt-pack validator (no more false
  section/prehook warnings for non-standard structures) and tracked by the
  monotony watchdog (three-song same-structure streaks now raise a warning).
- A live-workspace leak in the Telegram callback test path is fixed: test
  callbacks no longer fire a background autopilot cycle against the operator's
  real workspace.
- Operator docs (`docs/SUNO_BROWSER_DRIVER.md`, `docs/OPERATOR_RUNBOOK.md`,
  `docs/LOCAL_RUNTIME_OPS.md`, `docs/CONNECTOR_AUTH.md`) and `CHANGELOG.md`
  were updated to describe this behavior, including a recovery runbook for the
  Suno session-expiry / cross-song-rejection failure mode.

## Completed
- [x] Suno browser ownership documented (launch vs attach) — evidence:
  `docs/SUNO_BROWSER_DRIVER.md`, commit `99a570c`.
- [x] Linux shared-memory flag for the plugin-launched browser — evidence:
  commit `7953a27`.
- [x] Human-assist single-flight — evidence: commit `160ab85`, documented in
  `docs/SUNO_BROWSER_DRIVER.md`.
- [x] Structure-aware prompt-pack validation — evidence: commit `b9c3f5f`.
- [x] Three-song structure-streak monotony flag — evidence: commit `b03117a`.
- [x] Live-workspace leak in Telegram callback tests fixed — evidence: commit
  `d4f3270`.
- [x] Linux systemd `--user` templates and healthcheck — evidence: commit
  `7f4d316`.
- [x] Tracked-supervisor-on-Linux-without-systemd path documented — evidence:
  `docs/LOCAL_RUNTIME_OPS.md`.
- [x] Session-expiry recovery runbook written — evidence:
  `docs/OPERATOR_RUNBOOK.md#suno-session-expiry-recovery`.

## Files changed
| File | Change |
|---|---|
| `docs/SUNO_BROWSER_DRIVER.md` | Browser ownership (launch/attach), human-assist single-flight, expired-session failure mode |
| `docs/OPERATOR_RUNBOOK.md` | Suno session-expiry recovery runbook |
| `docs/LOCAL_RUNTIME_OPS.md` | Tracked-supervisor subsection for Linux hosts without systemd |
| `docs/CONNECTOR_AUTH.md` | Linux Firefox-profile-cookie note for Bird/X |
| `CHANGELOG.md` | Entries for the commits above |
| `src/services/sunoBrowserService.ts`, `src/services/sunoBrowserLaunch.ts`, `src/services/cdpHumanAssistDriver.ts`, `src/services/sunoHumanAssist.ts`, `src/services/humanAssistPending.ts` | Browser ownership and single-flight behavior |
| `src/validators/promptPackValidator.ts`, `src/suno-production/durationPlan.ts`, `src/suno-production/generatePromptPack.ts` | Structure-aware validation |
| `src/services/creativeQualityLedger.ts` | Structure-streak monotony flag |
| `scripts/linux/*` | systemd `--user` unit, healthcheck, logrotate templates |

## Decided (do not relitigate)
| Decision | Reason |
|---|---|
| Mac gateway posture is retired; Linux is a first-class host | Operator moved primary operation to a Linux host |
| Tracked supervisor (not systemd) owns the gateway on a Linux host without systemd | Containers have no init/session to run `systemd --user` |
| Suno browser **launch** (not attach) is the default ownership mode | No CDP endpoint is configured by default; attach is reserved for operator-started Chrome |
| Suno normal controls: Max Mode On, Personalize Off, Duration 3:30, Variety 2, Style Influence 100 | Producer ruling; source of truth is `docs/PRODUCER_DECISIONS.md` |
| Creative spine stays Dis-dominant (本気 Dis default posture) | Producer ruling recorded in project memory; see `project-creative-decision-spine` |

## Rejected alternatives
| Option | Why rejected |
|---|---|
| Keep Mac-only gateway lifecycle docs as the single source of truth | Operator has moved primary operation to Linux; Mac-only docs actively misled operators |
| Auto-solve or bypass Suno CAPTCHA to avoid human-assist entirely | Explicitly prohibited by `AGENTS.md` §6 safety invariants |

## Commands run
```
git log --oneline -- src/services/sunoBrowserService.ts -> confirmed launch/attach history
git show --stat 99a570c / 7953a27 / 160ab85 / b9c3f5f / b03117a / d4f3270 / 7f4d316 -> confirmed change scope per commit
```

## Test results
- Not re-run by this docs-only pass; see each lane's own commit for its test evidence.

## Open questions
- None blocking this docs pass.

## Known risks
- No dedicated operator API route exists yet for attaching feed-verified takes
  after a session-expiry recovery; the runbook step is a manual/developer-
  assisted ledger write (tracked as an open item below).
- DOM take harvest can still cross-attribute takes when the CLI session is
  stale and no feed baseline is available; the fail-closed guard rejects the
  run today but does not prevent the underlying stale-session condition.

## Next actions
1. Phase 4: audio import — resolve the `/api/forbidden` placeholder handling
   so a stale/forbidden CDN URL is distinguished from a genuinely not-ready
   asset, per `docs/SUNO_BROWSER_DRIVER.md`'s import section.
2. Phase 5: re-enable Telegram, autopilot, and social publishing on the Linux
   host under an explicit producer GO (currently retired/paused pending this
   parity work).
3. Add a container-restart hook so the gateway recovers automatically after a
   host/container restart on Linux (no systemd case).
4. Add external monitoring for the Linux gateway beyond the local healthcheck
   timer (`scripts/linux/gateway-healthcheck.sh`).
5. C7 reliability items:
   - Fail-closed DOM take-accept when no feed baseline is available (currently
     only rejects post hoc as cross-song; should refuse to accept from DOM
     alone earlier).
   - Session-expiry precheck before a human-assist run starts, instead of
     discovering the stale session only after a cross-song rejection.
   - Build the missing operator attach-takes API route referenced in the
     session-expiry recovery runbook.

## Completion conditions
- [ ] Linux host runs the full autopilot pipeline (Telegram, Suno, social)
  under an explicit producer GO with no Mac-only assumption remaining in
  tracked docs or code.
- [ ] Phase 4 audio import handles `/api/forbidden` correctly.
- [ ] C7 reliability items above are closed.

## References
- Project memory: `project-creative-decision-spine`, `project-live-runtime-state-location`,
  `project-gateway-launchd-lifecycle`, `project-suno-v55-create-dom`
- Design docs: `docs/SUNO_BROWSER_DRIVER.md`, `docs/LOCAL_RUNTIME_OPS.md`,
  `docs/OPERATOR_RUNBOOK.md`, `docs/CONNECTOR_AUTH.md`

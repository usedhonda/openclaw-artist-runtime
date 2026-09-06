# Local Runtime Ops (repo-local development sandbox)

How to start, stop, check, and resume the repo-local OpenClaw gateway used to
develop the artist-runtime plugin. This is for **contributors working in this
repository**, not for distributed operators.

## What this is

The plugin runs inside a repo-local OpenClaw sandbox under `.local/openclaw/`
(gitignored). The gateway is the `openclaw` CLI launched in `gateway run` mode,
kept alive by a supervisor wrapper. The artist autopilot, the Suno browser
worker, and the Telegram producer room all run inside this gateway process.

- Gateway HTTP/WS: `http://<tailscale-ip>:43134` when Tailscale is available;
  otherwise `http://127.0.0.1:43134`
- Live workspace + state: `.local/openclaw/workspace/`
- Secrets (sourced by `scripts/openclaw-local-env.sh`):
  `.local/social-credentials.env`, `.local/news-feeds.env`

The `openclaw` binary itself is **not** global; it lives at
`.local/openclaw/bin/openclaw` and is invoked through `scripts/openclaw-local`.

There must be exactly one lifecycle owner. Choose either the manual wrapper
(`scripts/openclaw-local-gateway start|stop`) or the launchd wrapper
(`scripts/openclaw-gateway-launchd.sh install|stop|restart`); never run both. The
manual `start` and `stop` commands fail closed when launchd owns the gateway, so
they cannot create a contender or kill the launchd tree.

## Environment: tracked defaults vs machine-specific overlay

`scripts/openclaw-local-env.sh` is a **tracked, generic** launcher. It must never
carry values unique to one Mac, so it stays clean in `git status`. Anything
specific to this machine goes in a gitignored overlay:

- `.local/openclaw-local-env.local.sh` — machine-specific env **seeds** (e.g. the
  Bird/X `BIRD_FIREFOX_PROFILE` id, a local `OPENCLAW_SUNO_CLI_ENTRY` checkout
  path, or the legacy `OPENCLAW_SUNO_USE_CDP` attach). Sourced early by the
  tracked script; the generic `"${VAR:-default}"` fallbacks then pick the seeds
  up, so setting a var here overrides the tracked default without editing the
  tracked file.

The tracked script keeps only public-safe generics (repo-relative paths, dynamic
Tailscale detection, `OPENCLAW_SUNO_DRIVER=suno_cli` for the live lane). Credentials
still live in `.local/social-credentials.env`, not in the overlay. If you need a
per-machine tweak, add it to the overlay — do not edit the tracked script.

## Start

```sh
scripts/openclaw-local-gateway start
```

Starts a single supervised gateway. Verify it is healthy:

```sh
scripts/openclaw-local-gateway status
scripts/openclaw-local-gateway health
```

`health` should report `ok: true`, `artist-runtime` in `plugins.loaded`, and
`channels.telegram.connected: true`.

## Stop (clean, no leftovers)

In manual mode, stop the PID-file supervisor with:

```sh
scripts/openclaw-local-gateway stop
```

If launchd is installed, do not use the manual command. Boot the launchd job
out through its owner wrapper instead:

```sh
scripts/openclaw-gateway-launchd.sh stop
```

Then confirm nothing still holds the port (no output = clean):

```sh
lsof -nP -iTCP:43134 -sTCP:LISTEN
```

## Resume after stop

```sh
scripts/openclaw-local-gateway start
```

On the first tick after start, the autopilot automatically sweeps any song left
at `suno_take_url_ready` and imports its takes — it writes the mp3 under
`.local/openclaw/workspace/runtime/suno/<runId>/` and sends the Telegram take
notification. **No manual step is needed to recover an in-flight song**; stopping
mid-pipeline does not lose or corrupt it (the Suno credit is already spent and
the song remains in the Suno library by URL).

If the producer manually paused the pipeline, resume it from Telegram:

```
/resume
```

`/resume` clears the manual pause. A Suno song that exhausts transient retries is
parked individually and the autopilot continues with the next observation; use the
song retry route when that specific song has been repaired.

## Auto-restart via launchd (persistent gateway)

To make the gateway survive login and its own death, register it as a per-user
launchd LaunchAgent (gui domain, no sudo, no LaunchDaemon). Do this only when
the manual gateway is stopped:

```sh
scripts/openclaw-gateway-launchd.sh install
```

`install` renders the machine-specific plist from the tracked template
`scripts/openclaw-gateway-launchd.plist.template` into
`~/Library/LaunchAgents/com.openclaw.artist-runtime.gateway.plist`, then loads
and starts it. What it gives you:

- **RunAtLoad** — starts at login (and boot, once you have logged in).
- **KeepAlive** — if the supervisor process dies, launchd re-spawns it within
  ~10s (the `ThrottleInterval`).
- The agent runs `scripts/openclaw-local-gateway-supervisor` **directly**, not
  `openclaw-local-gateway start`. `start` re-detaches the supervisor with
  `setsid`, which would make it launchd's grandchild and defeat `KeepAlive`. Run
  directly, the supervisor is launchd's foreground child, and it still runs its
  own inner `gateway run` crash/backoff loop underneath.

Machine-specific values (repo root, `$HOME`, and node's bin dir — Homebrew arm64
vs Intel) are resolved by the generator at install time, so the tracked template
and script carry no absolute machine paths. The real plist and the
`.local/openclaw/logs/gateway.launchd.{out,err}.log` output are gitignored.

Verify health the same way as a manual start:

```sh
scripts/openclaw-gateway-launchd.sh status   # launchd state + pid
scripts/openclaw-local-gateway health         # ok:true, plugins, telegram
```

### Managing a launchd-run gateway

Once launchd owns the process, use `launchctl` (or the wrapper below) for
lifecycle, **not** `openclaw-local-gateway stop/start`:

```sh
scripts/openclaw-gateway-launchd.sh restart    # safe restart after active work drains
scripts/openclaw-gateway-launchd.sh stop       # boot out the job, keep plist
scripts/openclaw-gateway-launchd.sh status     # loaded? pid? last exit code
scripts/openclaw-gateway-launchd.sh uninstall  # stop, unload, remove the plist
```

Ownership notes:

- `openclaw-local-gateway stop` refuses to kill anything while the launchd job
  is loaded. Use `scripts/openclaw-gateway-launchd.sh stop` or `restart`.
- `openclaw-local-gateway start` refuses to spawn while launchd owns the live
  supervisor, and also refuses when launchd is loaded but not ready. It never
  treats another owner's HTTP listener as proof that its own process started.
- A manual start reports success only after its spawned PID is alive and owns
  `runtime/gateway-supervisor.lock`; the HTTP smoke check is secondary.
- After a source rebuild (`npm run build:runtime`), restart with
  `scripts/openclaw-gateway-launchd.sh restart`. It calls the live Gateway's
  drain-aware restart request through the configured URL; it does not replace
  the launchd-owned supervisor and never falls back to a force restart.

To go back to fully manual operation, run `uninstall` and then use
`scripts/openclaw-local-gateway start` as before.

## Linux (systemd --user) operation

On a Linux host there is no launchd; supervise the gateway with a
`systemd --user` unit instead. Templates live under `scripts/linux/` and are
tracked, public-safe, and placeholder-only (`__NAME__`) — nothing
machine-specific is committed, the same "tracked template + local fill-in"
split as the macOS launchd plist above.

### Without systemd: tracked supervisor (containers)

The `systemd --user` templates above apply only to a Linux host that actually
runs systemd. On a container without systemd (no init, no `--user` session),
use the same tracked supervisor documented for macOS instead:

```sh
scripts/openclaw-local-gateway start|stop|status|health
```

Machine-specific values still come from the gitignored overlay,
`.local/openclaw-local-env.local.sh` (see "Environment: tracked defaults vs
machine-specific overlay" above); on this kind of host the overlay is also
where the operator reassigns the `openclaw_local_*` derivations (`prefix`,
`state`, `config_dir`, `workspace`, `logs`, and the gateway `port`) to fit the
container's filesystem layout, and exports `TZ=Asia/Tokyo`, `DISPLAY`, and any
container-specific `PATH` entries the gateway process needs. The tracked
`scripts/openclaw-local-env.sh` sources this overlay early and keeps only
public-safe generic fallbacks, so none of that machine detail lands in a
tracked file. Do not install the systemd templates on a host that cannot run
them; the tracked supervisor is the intended lifecycle owner there.

### Install

1. Write a gateway launcher script with the same shape as the manual command
   documented above — export `HOME`, `OPENCLAW_LOCAL_WORKSPACE`,
   `OPENCLAW_ARTIST_PRIVATE_ROOT`, `DISPLAY`, `OPENCLAW_TELEGRAM_NOTIFIER`,
   then `exec openclaw --profile <profile> gateway run --bind loopback
   --port <port>` — and keep it outside the repo, for example
   `~/.openclaw-artist/start-artist-gateway.sh`.
2. Copy the templates into `~/.config/systemd/user/`, dropping the
   `.template` suffix, and fill in every `__PLACEHOLDER__`:

   ```sh
   mkdir -p ~/.config/systemd/user
   cp scripts/linux/openclaw-artist-gateway.service.template \
     ~/.config/systemd/user/openclaw-artist-gateway.service
   cp scripts/linux/openclaw-artist-healthcheck.service.template \
     ~/.config/systemd/user/openclaw-artist-healthcheck.service
   cp scripts/linux/openclaw-artist-healthcheck.timer.template \
     ~/.config/systemd/user/openclaw-artist-healthcheck.timer
   $EDITOR ~/.config/systemd/user/openclaw-artist-gateway.service
   $EDITOR ~/.config/systemd/user/openclaw-artist-healthcheck.service
   ```

3. **Enable linger.** Without it, `systemctl --user is-system-running`
   reports `offline` and no `--user` unit starts without an active login
   session — this is required, not optional, for boot start:

   ```sh
   loginctl enable-linger "$USER"
   ```

4. Load and start both units:

   ```sh
   systemctl --user daemon-reload
   systemctl --user enable --now openclaw-artist-gateway.service
   systemctl --user enable --now openclaw-artist-healthcheck.timer
   ```

### Reflecting a new build

`Restart=always` recovers the gateway unit from a crash, but Node does not
hot-reload a source change. After `npm run build:runtime` on the host,
restart it explicitly:

```sh
systemctl --user restart openclaw-artist-gateway.service
```

### Reading logs

The unit template logs to the journal (`StandardOutput=journal` /
`StandardError=journal`):

```sh
journalctl --user -u openclaw-artist-gateway.service -f
journalctl --user -u openclaw-artist-healthcheck.service -n 50
```

If a launcher instead redirects stdout/stderr to a plain file, rotate it with
`scripts/linux/logrotate-openclaw-artist.conf.template` (fill in the log path
placeholder first).

### Healthcheck timer

`scripts/linux/gateway-healthcheck.sh` polls the plugin status endpoint
(`GET .../plugins/artist-runtime/api/status`) and a heartbeat file. By
default it prefers `runtime/supervisor-heartbeat.json` (`timestamp` field,
written every ~15s by `scripts/openclaw-local-gateway-supervisor` whenever
the gateway process is up, independent of autopilot activity) and falls back
to `runtime/autopilot-heartbeat.json` (`updatedAt` field) only when the
supervisor heartbeat file does not exist. Use the autopilot heartbeat as the
signal only when autopilot is expected to tick regularly — on a host where
autopilot is intentionally disabled, the supervisor heartbeat is the correct
default and avoids a false `fail` after autopilot's own idle window.
`HEARTBEAT_FILE` overrides the selection entirely; either heartbeat shape may
carry an ISO string or an epoch-ms number as its timestamp. The chosen file's
basename is recorded in every log line as `heartbeat_file=...`. The script
fails — one `fail ...` log line, non-zero reason recorded — when the HTTP
response is not 200, or the heartbeat is missing or older than
`HEARTBEAT_MAX_AGE_SEC` (default 900s / 15 minutes). The script **always
exits 0**, so the timer
loop itself never stops on a failing check; the pass/fail state and a
consecutive-failure counter are recorded in `STATE_FILE`
(`runtime/gateway-healthcheck-state.json` by default). Once consecutive
failures reach `FAIL_THRESHOLD` (default 3), and again once on recovery, an
optional `NOTIFY_CMD` executable is invoked with a one-line message.
`openclaw-artist-healthcheck.timer.template` runs it every 5 minutes,
starting 2 minutes after boot.

### Timezone

The gateway unit template sets `Environment=TZ=Asia/Tokyo` explicitly. Only
`src/services/newsObservationCollector.ts` pins this timezone in code — the
rest of the artist's date-sensitive logic (song dating, daily cadence)
follows the host's local timezone. A Linux host left at its default `UTC`
would silently shift every other date-based decision by the JST offset, so
the unit sets it rather than relying on the host default.

### Boot must stay read-only

The gateway unit starts only the gateway process, never a browser (AGENTS.md
section 6, "Boot"). The Suno browser worker starts only from an explicit
operator action. Do not add a browser launch to the launcher script or to
any unit here.

### No systemd / cron available (containers)

On a Linux host where PID 1 is not systemd and cron is not available (for
example, a container), `scripts/linux/gateway-healthcheck.sh` still needs
something to run it on a schedule. `scripts/linux/gateway-healthcheck-loop.sh`
covers that case: `start` detaches a singleton background loop (pid file plus
a `setsid` detach, mirroring `scripts/openclaw-local-gateway`) that runs the
healthcheck every `HEALTHCHECK_INTERVAL_SEC` seconds (default 300) and logs
to `${OPENCLAW_LOCAL_LOGS}/healthcheck.log`; `status` reports the pid, whether
it's alive, and the last log line; `stop` terminates it; `run-once` runs a
single healthcheck in the foreground for debugging. Prefer the systemd timer
above when systemd `--user` is available — this loop is the fallback for when
it is not.

After a container restart nothing starts on its own on such a host (there is
no init hook for user processes). The operator runbook is two commands from
the repository root: `scripts/openclaw-local-gateway start` and then
`scripts/linux/gateway-healthcheck-loop.sh start`. An external probe (a cron
job on another machine that runs `gateway-healthcheck-loop.sh run-once` over
SSH and notifies on failure) is what detects the outage in the first place;
the in-container loop dies with the container.

## Applying a code change to the running gateway

The gateway runs the compiled `dist/`. Node does **not** hot-reload, so after a
source change you must rebuild and restart:

```sh
npm run build:runtime          # rebuild dist
# then request a safe in-process restart:
scripts/openclaw-gateway-launchd.sh restart
```

Confirm the new process is newer than the dist build time before trusting it.

## Suno degraded-box self-heal (shipped fix, commit adf57fb)

Suno's lyrics textarea `maxLength` fluctuates between the normal box (5000) and a
transient degraded box (1250) depending on UI state (see
`src/suno-production/knowledge/suno_v55_reference.md`). A payload that fits the
real box but exceeds the live cap is now classified as a **retryable**
`suno_lyrics_box_degraded` (not a truncation). The driver reloads the create page
to re-measure a fresh `maxLength`; the autopilot soft-retries without hard-pausing
up to a cap and re-polls at the import cadence, so a create lands automatically
once Suno restores the normal box. Genuine oversize payloads (> the real box)
still fail closed before submit.

Verified live: a ~4000-char payload first hit `maxLength=1250`, self-healed, and
submitted successfully at `maxLength=5000` (`readbackMatches: true`).

## Development backlog

1. **Tune the self-heal cap** (`SUNO_LYRICS_BOX_DEGRADED_MAX_ATTEMPTS`, currently
   8). Observe how long the 1250 state persists in practice and extend if needed.
2. **Investigate the autopilot-state cycleCount/runId mismatch** observed during
   monitoring (possible concurrent state writers or restart residue). No
   functional impact seen; the submit succeeded.
3. **Distribution readiness (`.loop`)**: operator docs reference tarball-external
   scripts. On hold per maintainer.

## Dev env vs. producer (responsibility split)

- **In this repo (development):** implement/test/build the fix, tune the cap,
  investigate state, write docs. All of this is doable here without firing songs.
- **In Telegram (operation):** firing songs, GO / adopt / discard, listening. The
  producer does this — the same flow a distributed operator would use.
- **Do NOT** fire songs from the dev env via curl/scripts. A stuck pipeline is
  fixed by making it recoverable from Telegram, not by a manual dev-side trigger.

## Troubleshooting

- **Multiple supervisors / port held:** inspect the owner with
  `scripts/openclaw-gateway-launchd.sh status`; use that wrapper for launchd or
  `scripts/openclaw-local-gateway stop` for manual mode, then start exactly one
  owner.
- **Telegram silent:** check `.local/openclaw/logs/gateway.log` and the
  `channels.telegram` block in `scripts/openclaw-local-gateway health`. Emit is
  not delivery. Successful signal sends append metadata-only receipts to
  `.local/openclaw/workspace/runtime/telegram-deliveries.jsonl`; match the event
  type, song id, and Telegram message id there instead of inferring delivery from
  `runtime-events.jsonl` or channel health. Receipt entries never contain message
  text, URLs, chat ids, or tokens.
- **Telegram network errors:** the installed main-thread polling and fatal-error
  patches rebuild Telegram polling locally. The supervisor's whole-Gateway
  Telegram watchdog is opt-in (`OPENCLAW_TELEGRAM_WATCHDOG_ENABLED=1`) and must
  not be enabled as a routine recovery mechanism because it can terminate an
  active producer reply.
- **OpenClaw install/update:** `scripts/openclaw-local-install.sh` reapplies both
  Telegram transport patches before declaring the install complete. If the
  upstream patch seam changed, installation fails closed and the running
  Gateway must not be restarted until the patch is reviewed.
- **Telegram producer turn edits code or disappears after a self-restart:** the
  local gateway seeds `messages.visibleReplies=automatic` and denies runtime,
  file-mutation, and gateway-control tools to the public artist. This leaves
  read access and the registered `artist_*` production tools available while
  ensuring normal final text is delivered without a `message` tool call.
- **Telegram shows internal commands:** the local gateway seeds
  `channels.telegram.streaming.preview.toolProgress=false` while retaining
  partial answer previews. Existing explicit streaming choices are preserved;
  set this field to `false` in the local OpenClaw config if an older config still
  exposes file reads or shell commands.

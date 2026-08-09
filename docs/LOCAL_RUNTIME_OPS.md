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

If a song was paused mid-pipeline, the producer resumes it from Telegram:

```
/resume
```

`/resume` clears the stuck reason and resets the Suno retry budget, so an
exhausted-retry song actually re-attempts.

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
scripts/openclaw-gateway-launchd.sh restart    # force restart (launchctl kickstart -k)
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
  `scripts/openclaw-gateway-launchd.sh restart` rather than the manual Stop/Start
  sequence.

To go back to fully manual operation, run `uninstall` and then use
`scripts/openclaw-local-gateway start` as before.

## Applying a code change to the running gateway

The gateway runs the compiled `dist/`. Node does **not** hot-reload, so after a
source change you must rebuild and restart:

```sh
npm run build:runtime          # rebuild dist
# then restart exactly one lifecycle owner:
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

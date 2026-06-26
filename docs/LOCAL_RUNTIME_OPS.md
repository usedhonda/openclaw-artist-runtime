# Local Runtime Ops (repo-local development sandbox)

How to start, stop, check, and resume the repo-local OpenClaw gateway used to
develop the artist-runtime plugin. This is for **contributors working in this
repository**, not for distributed operators.

## What this is

The plugin runs inside a repo-local OpenClaw sandbox under `.local/openclaw/`
(gitignored). The gateway is the `openclaw` CLI launched in `gateway run` mode,
kept alive by a supervisor wrapper. The artist autopilot, the Suno browser
worker, and the Telegram producer room all run inside this gateway process.

- Gateway HTTP/WS: `http://127.0.0.1:43134`
- Live workspace + state: `.local/openclaw/workspace/`
- Secrets (sourced by `scripts/openclaw-local-env.sh`):
  `.local/social-credentials.env`, `.local/news-feeds.env`

The `openclaw` binary itself is **not** global; it lives at
`.local/openclaw/bin/openclaw` and is invoked through `scripts/openclaw-local`.

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

A plain `stop` kills the PID-file supervisor, but nested supervisors/watchers
can survive. To tear the whole tree down:

```sh
scripts/openclaw-local-gateway stop
pkill -f "openclaw-ticker-watcher" || true
pkill -f "openclaw-local-gateway-supervisor" || true
pkill -f "gateway run" || true
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

## Applying a code change to the running gateway

The gateway runs the compiled `dist/`. Node does **not** hot-reload, so after a
source change you must rebuild and restart:

```sh
npm run build:runtime          # rebuild dist
# then run the full Stop sequence above, then:
scripts/openclaw-local-gateway start
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

- **Multiple supervisors / port held:** run the full Stop sequence, confirm the
  port is clear, then Start.
- **Telegram silent:** check `.local/openclaw/logs/gateway.log` and the
  `channels.telegram` block in `scripts/openclaw-local-gateway health`. Emit is
  not delivery — confirm an actual inbound/outbound, not just that an event fired.

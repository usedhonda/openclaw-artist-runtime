# Supervisor Self-Heal

Plan v10.54 Phase A adds two local runtime artifacts:

- `runtime/supervisor-heartbeat.json`
- `runtime/crash-evidence/gateway-exits.jsonl`

The local gateway supervisor writes its own heartbeat and captures gateway exit
evidence before each restart. A lightweight watcher can keep the supervisor
itself alive when the supervisor process dies.

## Manual detached watcher

```bash
nohup node scripts/openclaw-supervisor-health.mjs watch-supervisor \
  --workspace .local/openclaw/workspace \
  --supervisor scripts/openclaw-local-gateway-supervisor \
  --stale-ms 60000 \
  --interval-ms 15000 \
  --log .local/openclaw/logs/supervisor-watchdog.log \
  >/tmp/openclaw-artist-runtime-supervisor-watchdog.out 2>&1 &
```

## macOS launchd option

Create `~/Library/LaunchAgents/com.openclaw.artist-runtime.supervisor-watchdog.plist`
with the repository path adjusted for the installed plugin checkout:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.openclaw.artist-runtime.supervisor-watchdog</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/artist-runtime/scripts/openclaw-supervisor-health.mjs</string>
    <string>watch-supervisor</string>
    <string>--workspace</string>
    <string>/path/to/artist-runtime/.local/openclaw/workspace</string>
    <string>--supervisor</string>
    <string>/path/to/artist-runtime/scripts/openclaw-local-gateway-supervisor</string>
    <string>--stale-ms</string>
    <string>60000</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

Load it with:

```bash
launchctl load ~/Library/LaunchAgents/com.openclaw.artist-runtime.supervisor-watchdog.plist
```

## Linux systemd user option

Create `~/.config/systemd/user/openclaw-artist-runtime-supervisor-watchdog.service`:

```ini
[Unit]
Description=OpenClaw Artist Runtime supervisor watchdog

[Service]
WorkingDirectory=/path/to/artist-runtime
ExecStart=/usr/bin/node /path/to/artist-runtime/scripts/openclaw-supervisor-health.mjs watch-supervisor --workspace /path/to/artist-runtime/.local/openclaw/workspace --supervisor /path/to/artist-runtime/scripts/openclaw-local-gateway-supervisor --stale-ms 60000
Restart=always
RestartSec=15

[Install]
WantedBy=default.target
```

Enable it with:

```bash
systemctl --user daemon-reload
systemctl --user enable --now openclaw-artist-runtime-supervisor-watchdog.service
```

## cron fallback

Use cron only when launchd/systemd are unavailable:

```cron
@reboot cd /path/to/artist-runtime && nohup node scripts/openclaw-supervisor-health.mjs watch-supervisor --workspace .local/openclaw/workspace --supervisor scripts/openclaw-local-gateway-supervisor --stale-ms 60000 >> .local/openclaw/logs/supervisor-watchdog.log 2>&1 &
```

## ticker external watcher

`scripts/openclaw-ticker-watcher` keeps the autopilot tick loop progressing and
recovers the gateway after a restart. It reconciles two runtime files on every
interval and never takes a side effect until it has established process liveness
from the authoritative source.

### Authoritative state

| File | Meaning | Writer / cadence |
|---|---|---|
| `runtime/supervisor-heartbeat.json` `gateway.pid` / `gateway.state` | **Process-liveness authority.** The single source of truth for whether the gateway process exists and is `running`. | supervisor, via `scripts/openclaw-supervisor-health.mjs`, every 15s |
| `runtime/autopilot-heartbeat.json` | **Tick-loop progress only.** Valid solely under pid fencing: `heartbeat.pid === supervisor gateway.pid`. An unfenced or stale entry is treated as no progress, never as liveness. | the autopilot tick loop inside the gateway |
| `logs/gateway.pid` | Manual-start bookkeeping. **Never** consulted for liveness. | manual `scripts/openclaw-local-gateway` start |

The watcher derives the gateway pid from `supervisor-heartbeat.json` and never
falls back to the autopilot heartbeat pid — that writer may be stale, orphaned,
or unrelated. Starting a supervisor contender is safe because the supervisor's
`acquire_singleton_lock` refuses a second live owner.

### Decision table

Every branch, its bound, its escalation, and the covering test in
`tests/ticker-external-watcher.test.ts` (keep this mapping in sync so drift is
visible):

| Condition | Action | Bound / escalation | Covering test |
|---|---|---|---|
| Heartbeat fresh **and** fenced (`heartbeat.pid === gateway.pid`) | none | — | `takes no action when the ticker heartbeat is fresh and fenced to the supervisor-owned gateway` |
| Heartbeat stale **or** unfenced, gateway alive | `POST /plugins/artist-runtime/api/autopilot/safe-tick-trigger` | safe-tick rate-limited to once per 5 min | `triggers the safe tick endpoint when the ticker heartbeat is stale and the gateway process is alive` (fencing variants: `uses the live supervisor-owned gateway when the recorded ticker writer has exited`, `rejects a fresh heartbeat written by a process other than the supervisor-owned gateway`) |
| Gateway dead, supervisor alive | wait for the supervisor to restart the gateway | bounded 5-min wait, then a one-shot tombstone at `runtime/ticker-watcher-escalation.json` (removed on recovery) **and one Telegram notice** | `escalates a prolonged supervisor wait exactly once`; notice: `sends exactly one Telegram notice when the supervisor-wait escalation tombstone is created` |
| Supervisor heartbeat missing | respawn the supervisor script | safe: `acquire_singleton_lock` rejects a second live owner | `respawns the supervisor when stale ticker heartbeat points to a dead gateway and supervisor heartbeat is absent` |
| Gateway dead **and** supervisor dead | respawn the supervisor script | safe: singleton lock | `respawns the supervisor when the supervisor heartbeat is present but both the gateway and supervisor processes are dead` |
| 3 consecutive safe-tick delivery failures (HTTP error / unreachable) | one Telegram notice | one notice per incident; the consecutive-failure counter resets on the next successful delivery | `sends the safe-tick delivery Telegram notice only on the third consecutive failure, once` |

The Telegram notice is fire-and-forget: it posts straight to the Telegram Bot
API (so it works even when the gateway is dead), never touches the watcher's
decision logic, and skips silently with a single `telegram notice skipped
token_missing` log line when no token is resolvable (covering test: `skips the
Telegram notice silently when no bot token is resolvable and leaves the decision
unchanged`). The token comes from `TELEGRAM_BOT_TOKEN` and the chat id from the
first entry of `TELEGRAM_OWNER_USER_IDS` — the same env source the gateway reads.
The token is never placed on argv or in any log line.

### Safe-tick keep-alive is intentional

When the autopilot idles longer than `staleMs` (20 min default) the watcher
fires a guarded no-op safe-tick cycle. This is deliberate: it is the
bounded-progress SLA — any expired cooldown redrives within `staleMs`. It is
why there is **no separate liveness timer**: a liveness-only freshness signal
would mask a wedged tick loop that still writes heartbeats. The pid fence plus
the safe-tick keep-alive together distinguish "idle but healthy" from "wedged".

### Running it

The safe tick endpoint requires a local token. Set the same value for the
watcher process and the gateway process (the supervisor hands it to the watcher
through the environment, never on the command line):

```bash
export OPENCLAW_SAFE_TICK_TRIGGER_TOKEN="$(openssl rand -hex 24)"
nohup scripts/openclaw-ticker-watcher \
  --workspace .local/openclaw/workspace \
  --gateway-url http://127.0.0.1:43134 \
  --supervisor scripts/openclaw-local-gateway-supervisor \
  --stale-ms 1200000 \
  --interval-ms 60000 \
  --log .local/openclaw/workspace/runtime/ticker-watcher.log \
  >/tmp/openclaw-artist-runtime-ticker-watcher.out 2>&1 &
```

The live watcher log is `runtime/ticker-watcher.log` under the workspace, not
under `logs/`.

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

# Suno Runtime Browser Strategy

Plan v10.34 adopts a layered browser strategy for the Suno background worker.

## Default: Layer 1

The default macOS path is:

- Playwright bundled Chromium
- an OpenClaw-owned persistent profile at `.openclaw-browser-profiles/suno`
- `--password-store=basic`
- `--disable-blink-features=AutomationControlled`

Do not default to system `Google Chrome.app`. On macOS, the Chrome app singleton
can route a launched worker tab into the operator's already-running visible
Chrome instance. That risks repeated Suno navigation in the operator's browser.
The default must isolate the worker process. The operator signs in once through:

```bash
scripts/openclaw-suno-login.sh
```

The Suno worker then reuses the same profile directory.

## Security Note

`--password-store=basic` stores browser secrets inside the local profile
directory instead of macOS Keychain. Treat `.openclaw-browser-profiles/suno` as
local sensitive runtime state.

Do not place this directory in a shared folder, synced drive, public backup, or
symlinked location. Do not commit it.

## Reauthentication

If Suno expires the session, run:

```bash
scripts/openclaw-suno-login.sh
```

Complete login in the opened browser window, then close the browser window. A
monthly reauthentication check is recommended, and earlier reauthentication may
be needed if Suno forces login, CAPTCHA, account checks, or policy prompts.

## Optional Escape Hatches

The plugin owns the Suno browser lifecycle: `SunoBrowserService` launches the
persistent `.openclaw-browser-profiles/suno` profile itself (with an ephemeral
`--remote-debugging-port=0` derived from `DevToolsActivePort`), so no manual
Chrome launch or fixed 9222 port is required. Each knob below is a saved config
field under `music.suno.browser.*` that wins over its legacy `OPENCLAW_SUNO_*`
env var; the env var stays as a backward-compatible fallback.

`music.suno.browser.executablePath` (env `OPENCLAW_SUNO_CHROME_EXECUTABLE`) may
point at a custom Chrome-compatible executable for operator-controlled recovery.
It is not auto-detected and should remain unset for normal installs.

`music.suno.browser.channel: "chrome"` (env `OPENCLAW_SUNO_BROWSER_CHANNEL`) is
an explicit opt-in escape hatch for machines where the operator accepts the macOS
Chrome singleton risk. It is not the default.

`music.suno.browser.cdpEndpoint` (env `OPENCLAW_SUNO_CDP_ENDPOINT` +
`OPENCLAW_SUNO_USE_CDP=on`) is the advanced/emergency attach mode: instead of
launching, the plugin attaches to an already-running Chrome over CDP at that
endpoint. Use it only when the persistent profile lane cannot launch.

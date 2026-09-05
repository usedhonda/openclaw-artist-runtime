# Private data root (optional)

Artist Runtime **code** lives in the public repository. Operator-owned data
(workspace archives, songs, state snapshots, env templates) may live in a
separate **private** checkout. CI, package builds, and marketplace installs must
not require that private repo to exist.

## Env var

| Env var | Required | Purpose |
| --- | --- | --- |
| `OPENCLAW_ARTIST_PRIVATE_ROOT` | No | Absolute path to a private data checkout (or synced mirror). When unset, the runtime uses its normal local paths (e.g. `.local/openclaw/workspace` or `OPENCLAW_HOME` / `~/.openclaw-artist`). |

Example:

```bash
export OPENCLAW_ARTIST_PRIVATE_ROOT=/path/to/openclaw-artist-private
```

Optional overlays (host-specific; not schema defaults):

```bash
# export OPENCLAW_ARTIST_WORKSPACE="$OPENCLAW_ARTIST_PRIVATE_ROOT/workspace"
# export OPENCLAW_ARTIST_SONGS_DIR="$OPENCLAW_ARTIST_PRIVATE_ROOT/songs"
```

## What belongs in the private root

- `workspace/` — persona files, ledgers, artist notes
- `songs/` — audio archive and song metadata
- `runtime/state/`, `runtime/suno/` — migration snapshots (not a substitute for live `OPENCLAW_HOME`)
- `env/*.example` — templates only
- `secrets/` — **local only**, gitignored contents

## What must never enter git (public or private history)

- Tokens, cookies, session files
- Logged-in browser profiles
- OpenAI Platform API keys (not used by this project)

## Relationship to live gateway homes

| Path | Role |
| --- | --- |
| Public repo `openclaw-artist-runtime` | Code / plugin |
| `OPENCLAW_ARTIST_PRIVATE_ROOT` | Optional private data / migration payload |
| `~/.openclaw-artist` (example artist gateway `:19001`) | Live Artist OpenClaw home — may stay as-is |
| `~/.openclaw` (Pocket-Chi, `:18789`) | **Do not mix** with Artist paths |

Absence of `OPENCLAW_ARTIST_PRIVATE_ROOT` is normal for CI and fresh installs.

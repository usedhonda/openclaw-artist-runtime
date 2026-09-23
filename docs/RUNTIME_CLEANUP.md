# Runtime Cleanup

Artist Runtime keeps operator-local runtime state out of package artifacts, but
it does not assume the operator wants automatic deletion. Cleanup scripts are
manual tools: they show what would be removed first, and only delete after an
explicit operator action.

See also: `docs/ERRORS.md` for reason-code anchors related to disk pressure,
artifact import failures, and cleanup-facing incidents.

## Policy table

| Runtime area | Default retention | Script handling | Notes |
| --- | ---: | --- | --- |
| `runtime/suno/<runId>/` | 30 days | `scripts/cleanup-runtime.sh` and `scripts/runtime-retention-enforce.sh` can remove old run directories | Imported mp3/m4a assets stay local until the operator deletes them. |
| `social-publish.archive.jsonl` | 90 days | `scripts/runtime-retention-enforce.sh` lists old archive ledgers | The active social ledger rotates old entries into this archive during append. |
| `prompt-ledger.jsonl` | 365 days | `scripts/runtime-retention-enforce.sh` lists old prompt ledgers | Prompt ledgers are audit artifacts; delete only after operator review. |

## Scripts

### `scripts/cleanup-runtime.sh`

Deletes old `runtime/suno/<runId>/` directories when confirmed.

```bash
scripts/cleanup-runtime.sh --dry-run
scripts/cleanup-runtime.sh --dry-run --json
scripts/cleanup-runtime.sh --cron
```

- `--dry-run` prints candidates and performs no deletion.
- `--json` emits a machine-readable candidate list.
- `--cron` is intended for an operator-owned cron entry and skips the prompt.

### `scripts/runtime-disk-usage.sh`

Prints a compact disk-usage table for `runtime/*/`.

```bash
scripts/runtime-disk-usage.sh
scripts/runtime-disk-usage.sh --json
```

Use this before deleting artifacts so the operator can see what is consuming
space.

### `scripts/runtime-retention-enforce.sh`

Shows the full retention policy across Suno artifacts, social archives, and
prompt ledgers.

```bash
scripts/runtime-retention-enforce.sh --dry-run
scripts/runtime-retention-enforce.sh -y
```

Run `--dry-run` first. Use `-y` only after reviewing the listed paths.

## Cron example

Artist Runtime does not register cron entries automatically. If the operator
wants scheduled cleanup, add an entry manually:

```cron
15 3 * * * cd /path/to/artist-runtime && scripts/cleanup-runtime.sh --cron >> runtime/cleanup.log 2>&1
```

Keep this under operator control because cleanup is a local data-retention
decision, not a plugin side effect.

## Recovery

If cleanup removes the wrong local artifact, restore it from an operator backup.
The plugin does not maintain a hidden trash folder. For Suno assets, the source
song URLs may still be visible in the run ledger, but re-importing can depend on
the operator's current Suno session and platform availability.

# Observation Pipeline

How the artist turns current events into X (Twitter) observations that seed song
briefs. This documents the mechanism: query construction, staged execution,
zero-result broadening, caching, the Bird output parser, and the diagnostics
trail. For the read-only diagnostics surface and the operator verification steps,
see [Observation Diagnostics](RUNTIME_SETTINGS.md#observation-diagnostics) and the
[X Search Verification Runbook](RUNTIME_SETTINGS.md#x-search-verification-runbook).

Primary sources: `src/services/newsObservationCollector.ts`,
`src/services/newsReactionQuery.ts`, `src/services/xObservationCollector.ts`,
`src/services/birdRateLimiter.ts`, `src/services/xObservationDiagnostics.ts`.
The autopilot wiring lives in `src/services/autopilotService.ts:1098-1116`.

## 1. Pipeline overview

Each autopilot cycle runs three stages before a spawn brief is composed:

1. **News collection.** `collectNewsObservations`
   (`newsObservationCollector.ts:644`) fetches RSS feeds, resolves article bodies,
   ranks against persona motifs, and writes `<workspace>/observations/news-<YYYY-MM-DD>.md`.
2. **Reaction query construction.** `buildNewsReactionQueries`
   (`newsReactionQuery.ts:79`) turns the top news entry into an ordered list of
   X search queries (§2).
3. **X observation collection.** `collectObservations`
   (`xObservationCollector.ts:546`) runs those queries against Bird one at a time,
   filters and ranks the tweets, and writes `<workspace>/observations/<YYYY-MM-DD>.md`.

The call site is `autopilotService.ts:1106-1112`:
`buildNewsReactionQueries(newsObservation.entries, { personaText })` feeds its
`queries` and `seed` into `collectObservations`. When news yields no reaction
queries the cycle falls back to the fixed query `"music OR society OR culture"`
(`autopilotService.ts:1109`). The resulting `<YYYY-MM-DD>.md` observation file and
its diagnostics then flow into the spawn brief
(`cycleObservation.observations` / `observationPath` at `autopilotService.ts:1401-1416`).

### News collection detail

`newsRssUrlsForRun` (`newsObservationCollector.ts:99`) builds the feed list as
`buildTopicalNewsRssUrls()` (Google News top headlines) + operator env feeds
(`OPENCLAW_NEWS_RSS_URLS`) + `buildMotifNewsSearchUrls(motifs)` (a Google News
search query built from persona motifs), capped at `maxFeedsPerRun = 5`
(`newsObservationCollector.ts:66`). Feeds are fetched, parsed
(`parseRssXml`), optionally article-resolved (`resolveArticleUrls`, gated by
`OPENCLAW_NEWS_ARTICLE_RESOLVE`), motif-ranked, and cached for
`newsCacheTtlMs = 6h` (`newsObservationCollector.ts:65`). With no motifs and no env
feeds the stage skips with reason
`news_motifs_unavailable_and_OPENCLAW_NEWS_RSS_URLS_unset`
(`newsObservationCollector.ts:652-654`).

## 2. Query variants: order and rationale

`buildNewsReactionQueries` (`newsReactionQuery.ts:79-107`) takes the top news
entry (first with a URL or non-empty text) and emits queries in this order, most
specific first, de-duplicated:

1. **`exactPhrase` (quoted).** The strongest headline phrase, quoted
   (`newsReactionQuery.ts:89,95`). `headlinePhrases`
   (`newsReactionQuery.ts:53-70`) derives it from the first clause (split on
   `。!?！？` / ` - ` / `｜` / `|`), plus adjacent token pairs, plus standalone
   tokens that are acronyms/numbers (`[A-Z0-9]{2,}`) or CJK compounds
   (`[一-龠ぁ-んァ-ヶー]{3,}`). This rule keeps compound words and acronyms intact
   rather than shattering them into single tokens.
2. **`entityPhrase` (quoted).** The next distinct headline phrase, or the first two
   tokens joined (`newsReactionQuery.ts:90,96`). A second angle on the same event.
3. **Dated Japanese query.** `"<exactPhrase>" lang:ja since:<7d>`
   (`newsReactionQuery.ts:92,97`) — the same phrase constrained to recent
   Japanese-language posts (§3).
4. **Motif variant.** `"<exactPhrase>" ("motif" OR "motif" OR "motif")`
   (`motifQueryVariant`, `newsReactionQuery.ts:72-77`), intersecting the headline
   with the top persona motifs — only added when persona text is present.
5. **Broad token fallback (last).** The top tokens joined with ` OR `
   (`newsReactionQuery.ts:91,99`). The widest net, tried only after every specific
   variant, so broadening never precedes precision.

Token cleaning strips URLs and non-letter/number/CJK characters, drops tokens
shorter than 2 chars, and ignores structural noise (`https|www|com|news|google|rss`)
(`newsReactionQuery.ts:15-51`).

## 3. Search operators actually used

Only the operators emitted by the code above are in play. In query strings:

- **`"phrase"`** — exact-phrase quoting (`quotePhrase`, `newsReactionQuery.ts:38-40`).
- **`lang:ja`** — Japanese-language filter, on the dated variant only
  (`newsReactionQuery.ts:92`).
- **`since:<YYYY-MM-DD>`** — 7-day recency window (`sinceDate`,
  `newsReactionQuery.ts:42-44,92`).
- **`a OR b`** and **`("x" OR "y")`** — token/motif alternation
  (`newsReactionQuery.ts:76,91`).

Bird itself is invoked as `bird search <query> --json` for a query, or
`bird home --plain` for the timeline fallback (`defaultRunner`,
`xObservationCollector.ts:112-126`). No other operators (for example `min_faves`,
`from:`, `filter:`, `until:`) are constructed anywhere in the pipeline.

## 4. Zero-result broadening

`collectObservations` runs the ordered queries as a staged loop
(`xObservationCollector.ts:573-620`):

- Attempts are bounded by
  `maxAttempts = min(maxObservationQueryAttempts=3, gate.remaining, queries.length)`
  (`xObservationCollector.ts:574`), so the rate gate (§ below) and the daily Bird
  budget both cap how many variants are tried.
- Each attempt runs one query, parses and filters the output (§6, §7), records the
  Bird call, and appends a per-attempt diagnostic.
- The loop **breaks as soon as an attempt yields `entries.length > 0`**
  (`xObservationCollector.ts:617-619`). Because the query list is ordered
  specific→broad (§2), execution naturally widens only until something lands.
- If every attempt is empty, the empty result is still rendered and written (an
  empty observation file plus diagnostics).

Rate gate: before any query runs, `tryAcquireBirdCall`
(`birdRateLimiter.ts:122`) is consulted. If a cooldown is active the cycle returns
`cooldown`; if the daily max is spent it returns `skipped`
(`xObservationCollector.ts:568-572`). `gate.remaining` also shrinks `maxAttempts`,
so broadening never exceeds the remaining daily Bird budget.

## 5. Empty-result cache

`collectObservations` caches the day's observation file and keys the TTL on whether
it holds any entries (`cacheTtlFor`, `xObservationCollector.ts:481-483`):

- **Non-empty:** `observationCacheTtlMs = 6h` (`xObservationCollector.ts:47`).
- **Empty:** `emptyObservationCacheTtlMs = 20min` (`xObservationCollector.ts:48`).

A cache hit also requires the cached query/reactionSeed to match the requested ones
(`cachedObservationMatches`, `xObservationCollector.ts:468-479`). The short empty
TTL means a zero-result cycle is retried ~20 minutes later instead of being frozen
for 6 hours, while a good haul is reused for the rest of the day.

## 6. Bird output parser

`parseBirdOutput` (`xObservationCollector.ts:222-235`) dispatches by shape:

1. **JSON (`--json`).** `parseBirdJsonOutput` (`xObservationCollector.ts:199-220`)
   parses a top-level JSON array and, for each tweet, composes the canonical URL
   `https://x.com/<author>/status/<id>` from `author.username` and `id`, taking
   `text` and `createdAt` as `postedAt`.
2. **Record-separated plain text.** If a `──────────` separator is present,
   `parseBirdChunk` reads `@author`, `date:`, and `url:` lines per chunk
   (`xObservationCollector.ts:128-169`).
3. **Line plain text.** Otherwise `parseBirdLines` scrapes URL/author/ISO-date out
   of each `- ` line (`xObservationCollector.ts:171-`).

The JSON path is the default runner's output; the plain parsers are fallbacks for
non-JSON Bird output.

## 7. Diagnostics

`filterObservationEntries` (`xObservationCollector.ts:237-259`) classifies every
parsed tweet with `isAcceptable` (`xObservationCollector.ts:74-87`). A tweet is
accepted only with a full `x.com/<user>/status/<id>` URL, a real author, and a
`postedAt`; otherwise it is rejected with one of the enums
`short_url_only` | `missing_author` | `missing_postedAt`
(`RejectionReason`, `xObservationCollector.ts:51`). Accepted tweets are motif-ranked
before rendering.

Each attempt produces an `XObservationAttemptDiagnostic`
(`xObservationCollector.ts:53-64,283-291`):

- **`query`** — the query string tried (or undefined for the timeline).
- **`rawCount`** — tweets parsed from Bird output before filtering.
- **`acceptedCount`** — tweets that passed `isAcceptable`.
- **`rejectedCountsByReason`** — a count per rejection enum.
- **`firstRejectionSample`** — a privacy-safe shape of the first rejected entry:
  `reason`, `hasAuthor`, `urlKind` (`full`|`short`|`missing`), `hasPostedAt`
  (`rejectionSample`, `xObservationCollector.ts:269-281`). No tweet body, no URL.

The snapshot is written by `buildXObservationDiagnosticsSnapshot` /
`writeXObservationDiagnostics` (`xObservationDiagnostics.ts:26,49`) to
`<workspace>/runtime/x-observation-diagnostics.json`, carrying an `outcome`
(`collected` | `cooldown` | `error`) and a sanitized `reason` so cooldown and error
runs also leave a trail (`xObservationCollector.ts:593-600,625-632,654-661,671-678`).

**Privacy.** Rejected tweet body text and rejected URLs are never surfaced in
Telegram, Producer Room, or status JSON — only counts, rejection enums, and the
boolean/url-kind sample. Full rejected entries go only to the local
`runtime/x-observation-rejected.jsonl` audit log (`appendRejectedLog`,
`xObservationCollector.ts:89-102`).

**Ban detection.** `detectBirdBanIndication` (`xObservationCollector.ts:524-540`)
scans the runner's stderr always, but scans stdout only when stdout produced zero
parsed entries and looks like a short non-JSON error blurb (`stdoutLooksLikeBirdError`,
`xObservationCollector.ts:518-522`). stdout that parsed at least one raw entry is
treated as real tweet payload and never scanned, so ordinary tweets containing
words like 速度制限 cannot trigger a false 24h cooldown. When a genuine ban
indicator fires, the recorded reason is a sanitized marker
`ban_indication: <token> (source: stderr|stdout|error)`
(`banIndicationReason`, `xObservationCollector.ts:542-544`), never raw tweet text,
and a 24h cooldown is triggered via `triggerCooldown` with a
`bird_cooldown_triggered` event (`xObservationCollector.ts:588-607`). This
error-output-only scoping was introduced in commit `91a0f90`.

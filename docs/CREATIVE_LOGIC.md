# Creative Logic

This file records the runtime-facing creative policy that drives autonomous song
generation. The whole pipeline turns on one idea: **every creative axis for a song
is decided once, by one module, recorded in one structured record, and read by
every downstream stage.** Before this redesign the decisions were scattered — some
axes nobody chose, some computed independently in four places, some decided and
then thrown away — and they travelled between stages as a lossy `brief.md` string
that two writers filled with divergent schemas. That structure produced the whole
family of bugs (a lens stuck on one bank, fallback boilerplate, a fixed intro, the
"same face four songs running", the anger draining out of the lyrics). The record
below is the cure.

## The CreativeDecision spine

One song, one decision. `src/services/creativeDirector.ts` (`decideCreative`) is a
pure function: given the song id, the JST date, the verbatim persona text, the
observation, and the recent decision history, it returns a `CreativeDecision`
(`src/types.ts`). No `Date.now()`, no `Math.random` — the same input yields the
same decision, so a re-run never silently re-decides a song mid-flight.

The decision is persisted **once** as `songs/<id>/song-plan.json`
(`src/services/songPlan.ts`, write-once: an existing plan is returned unchanged).
Downstream stages **read the plan** instead of re-hashing each axis on their own.
`brief.md` remains as a human-readable summary, but the machine source of truth is
the plan.

## Source, observation, and artistic response

A source is not yet an artistic observation. For a new proposal, a resolved news
article is preferred over a surrounding X reaction. The proposal must keep one
source as its factual anchor, record the artist's own `artistObservation` about
that fact, then derive the lyric and musical choice from that response. Persona
material controls the critical voice and sound; it cannot introduce an unrelated
second subject. If the connection cannot be stated plainly, the runtime declines
to force a proposal.

### Decision axes

| Axis | Field | Decided by | Notes |
|---|---|---|---|
| Critique lens | `lens` | material-bank rotation, no 3-in-a-row | A/B/C: consumption_face / net_generation / shibuya_city |
| Lens material | `lensMaterial` | the chosen lens's bank only | other banks are never carried into the directives |
| Attack stance | `attackStance` | per-lens rotation, exclude previous | breaks the "整形広告のマンネリ" one-note attack |
| Emotional mode | `emotionalMode` | Dis-default rule (below) | `{ label, spec }`; spec is the mood |
| Aggression | `aggression` | Dis-default rule | `dis` \| `changeup` |
| Tempo | `tempo` | weighted band pool, band + bpm from one sub-seed | `{ band, bpm }` |
| Dopagaki | `dopagaki` | **single** density computation | `{ active, threshold, variationSeed }` |
| Intro | `intro` | artist-authored opening contract for lyrics AND style | `{ archetype, modifier, lyricInstruction, styleMove }`; the writer chooses the opening from the song rather than rotating stock forms; empty/scatted vocal openings are prohibited |
| Hook shape | `hookShape` | rotation, exclude previous | question / number / list / call_response / reversal / one_line |
| Shibuya tag | `shibuyaTag` | rotation, exclude previous | technique id from the canon |
| Signature | `signature` | 1 of 5, exclude previous | the artist's recurring "癖" |
| Observation | `observation` | from the collector | `{ url, author, motifScore }` or null |
| Degraded inputs | `degradedInputs` | recorded, never hidden | e.g. `observation_null`, `material_banks_empty` |
| Vocal gender | `vocalGender` | persona | mirrors the pack's own default |

### Who decides / consumes / records

- **Decides:** `creativeDirector.decideCreative`, called at materialization —
  `songSpawnProposer.proposeSpawn` (commission path) and
  `songIdeation.createSongIdea` (autonomous path). Both persist the plan.
- **Consumes (plan-first):** the lyric prompt
  (`lyricsDraftingPrompt.buildLyricsDraftingPrompt` — selective injection, mood),
  lyric drafting (`lyricsDrafting` — intro, tempo band, emotional mode, dopagaki),
  the prompt pack / style (`sunoPromptPackFiles` + `generatePromptPack` — bpm,
  vocal gender, intro styleMove, emotional-mode style hint, style notes), retry
  (`retryPromptPackService`), and run telemetry (`sunoRuns` — tempo-band target).
  Each reads the plan when it exists and falls back to the legacy brief string only
  for songs created before the spine shipped.
- **Records:** `creativeQualityLedger` appends the decision plus the result
  (hook text, diss-bank hits, bare-lyric size, degraded flags). `/api/status`
  exposes the lens/mode/tempo/intro/stance distributions and the recent list.

### The Dis-default aggression rule

Per producer direction the artist attacks in almost every song. The rule lives in
code (the canon carries vocabulary and posture; the code carries probability and
history):

- Base: `aggression = "dis"`, `emotionalMode = 本気 Dis`.
- A changeup is allowed **only** when the previous song was Dis **and** the seed
  hash lands in the top 20% band. So the Dis rate is ~80%+, and two changeups can
  never run back to back.
- The lyric prompt enforces the teeth on every mode: at least two punchlines per
  verse, slang welcome, and an **免罪句 (absolution-phrase) ban** — the draft may
  not write "個人攻撃ではない" / "no villain here" style disclaimers. A repair pass
  lints for them; if one survives, the song still ships but the ledger records
  `softened: true`.
- The safety line is unchanged and unconditional: never attack a named private
  individual or a protected trait. The diss target is systems, incentives, styles,
  cultures, industries, and public structures.

## Selective prompt injection

The lyric prompt no longer dumps every bank and asks the model to rotate. When a
decision is present, `buildLyricsDraftingPrompt` injects a bounded directive block
(`SELECTIVE_BLOCK_START` … `SELECTIVE_BLOCK_END`) carrying **only** what the
decision chose: the chosen lens's material, the chosen tag-technique bullet, the
signature, the hook shape, the attack stance, and the aggression directives. The
full persona is still appended as ground, but the *directives* point at one lens.
Legacy songs with no plan keep the previous critique-lens prose.

## style / pack alignment

`generatePromptPack` / `buildStyle` read the plan, not independent hashes:

- The style `Intro Move` is derived from the plan's `intro.styleMove`, so the
  lyric intro and the style intro can no longer contradict.
- `bpm` and `vocalGender` come from the plan.
- `emotionalMode.spec` (感情) and `moodHint` (音色) are role-separated: the mode
  is the emotional stance, the moodHint is the sonic colour, and both reach the
  style through the plan / pack input.
- The brief's `- Style notes:` line is now actually threaded into `buildStyle` as
  an extra hint (it used to be written and then dropped) — but only for songs that
  have a plan; the legacy path stays byte-identical.

## brief.md: one renderer, one schema

`src/services/briefRenderer.ts` is the single brief writer. Both the commission
path (`songStateInjector`) and the ideation path (`songIdeation`) build a
`BriefModel` and route through `renderBrief`. The model is the superset of every
field either path needs; the renderer emits a Direction line only for the fields
that are set, in one fixed order, so the two briefs still differ in which lines
appear but share one schema and one formatter.

Two properties this fixes:

- **bpm no longer vanishes on the ideation path.** The ideation brief now carries
  a `- Tempo: NNN BPM` line, so `readBriefTempo` (which matches only `- Tempo:`)
  parses it instead of falling back to the mid default.
- **band and bpm agree inside one brief.** The `- Tempo band:` line and the
  `- Tempo:` line derive from a single tempo source per brief (an explicit bpm →
  its band via `bandForBpm`; otherwise the plan's band + bpm), so the two can no
  longer disagree.

### Heading parsing shares one contract

The parsers that slice the live persona used to match headings on an exact line,
so a heading that gained a trailing space, changed case, or picked up a full-width
space silently returned `[]` and the pipeline degraded with no error. All of them
now compare through `src/services/personaHeadings.ts`: canonical heading constants
plus `normalizeHeading` (trim, drop markdown `#` markers, fold case, collapse
whitespace, treat full-width spaces as ASCII). The **persona contract doctor reads
the same constants**, so the doctor and the parsers cannot drift apart.

Canon sections the parsers read, with their exact headings (all from
`personaHeadings.ts`):

| Heading | Parser | Purpose |
|---|---|---|
| `### Emotional Modes` | `emotionalModesFromArtist` | the 7 modes incl. 本気 Dis |
| `### Critique Lens` | `critiqueLensLines` / doctor | legacy critique prose |
| `### Shibuya Tag Techniques` | `parseTagTechniques` | tag technique pool |
| `### Attack Stances` | `parseAttackStances` | per-lens attack pool |
| `### Consumption & Face Material Bank` | `materialBankGroups` | lens A material |
| `### Net & Generation Material Bank` | `materialBankGroups` | lens B material |
| `### Shibuya Diss Material Bank` | `materialBankGroups` / `extractDissBankItems` | lens C material + diss telemetry |
| `## Current Obsessions` | `chooseTheme` | ideation theme seed |
| `## Current Artist Core` | `chooseTheme` | ideation theme fallback |

## The persona contract doctor

`src/services/personaContractDoctor.ts` runs the **real** parsers over the live
`ARTIST.md` and reports every contract that no longer holds: three non-empty
material banks, a Critique Lens, 7 Emotional Modes with a Dis mode, ≥4 Attack
Stances per lens, ≥8 tag techniques, and an intact signature contract. Results are
always visible in `/api/status` diagnostics; a failing set emits
`persona_contract_degraded` once per distinct failure set (the end of silent
degradation).

## Monotony watchdog

`creativeQualityLedger` aggregates the recent decisions and detects streaks — same
lens 3 in a row, consecutive changeups, a repeated title word, a repeated attack
stance. A streak emits a runtime event and one tombstoned Telegram notice (no
spam). This is what would have caught "same face four songs running" automatically.

## Dopagaki variation

Dopagaki is an autonomous anti-template density variation, not a genre. Target rate
~40%. It is computed **once**, inside the director, and stored on the plan
(`dopagaki`). Every consumer — lyric prompt, style seed, retry, ledger — reads that
one value, so the recorded `dopagakiActive` can no longer contradict the style
block. Active mode is overt (clipped fragments, instant hook pressure,
fast-development contrast), high-speed delivery is limited to 2-4 bar bursts, and
the nu-jazz low-bass core with the dry intelligible lead stays intact. Source of
truth: `src/services/creativeVariationPolicy.ts`.

## Opening contract

The runtime does not rotate a catalogue of intro archetypes. Each lyric writer must
make the opening from the current observation, emotional turn, and musical plan.
There are two renderable forms only: an `[Instrumental Intro]` with a concrete sound
gesture and no lyric lines, or an `[Intro]` carrying exactly one complete,
intelligible lyric line. Empty intro sections, count-ins, phonetic filler, scat,
vocal chops, and ad-libs before the first written lyric are prohibited. Fast flow is
scoped to Verse sections, so a global rap direction cannot turn a sparse opening
into an invented vocalise.

## Rap lyrics density

The default 80-bar nu-jazz rap DurationPlan is dense by default. Verse 1 and Verse
2 carry 14-16 lines each, roughly one lyric line per bar, with internal rhymes and
controlled syllable density. Bare lyrics must clear a dual floor before a draft is
accepted: at least 1200 bare-lyric characters (80 bars × 15) **and** at least 52
non-marker lyric lines. Fast bands target a shorter runtime; the band comes from
the plan. Source of truth: `src/suno-production/durationPlan.ts`.

### Meaningful repetition only

Section-level Hook repeats remain part of the song form. Within a lyric line,
however, a repeated mora or short filler (`だ、だ、だ`, `よよよ`, `da-da-da`) is
regenerated once rather than used to fill the opening or a verse. The sole narrow
exception is one intentional response tag in a call-and-response hook; it never
permits an intro stutter. This keeps repetition as a deliberate hook device,
not the default vocal gesture.

## Contract → test map

Each protected contract and the test file that pins it:

| Contract | Source | Test |
|---|---|---|
| Decision determinism, all-axis anti-repeat, Dis-rate rule | `creativeDirector.ts` | `tests/creative-director.test.ts` |
| Plan write-once + downstream thread-through | `songPlan.ts`, `generatePromptPack.ts` | `tests/prompt-pack-v55-plan-thread-through.test.ts` |
| bpm resolution (brief vs plan) | `sunoPromptPackFiles.ts` | `tests/prompt-pack-v55-bpm.test.ts` |
| Selective directive injection + 免罪句 lint | `lyricsDraftingPrompt.ts`, `lyricsDrafting.ts` | `tests/lyrics-drafting-prompt.test.ts`, `tests/lyrics-drafting-repair.test.ts` |
| Title anti-repeat, seeded motif | `songSpawnProposer.ts` | `tests/title-anti-repeat.test.ts` |
| Tempo band templates | `durationPlan.ts` | `tests/duration-plan-tempo-bands.test.ts` |
| Artist-authored opening contract | `creativeVariationPolicy.ts`, `lyricsDraftingPrompt.ts` | `tests/intro-variant-rotation.test.ts`, `tests/lyrics-drafting-prompt.test.ts` |
| Persona contract doctor | `personaContractDoctor.ts` | `tests/persona-contract-doctor.test.ts` |
| Monotony streak detection + one notice | `creativeQualityLedger.ts` | `tests/creative-monotony-watchdog.test.ts` |
| Ledger records decision + result | `creativeQualityLedger.ts` | `tests/creative-quality-ledger.test.ts` |
| Unified brief renderer, heading normalization, plan-first readers | `briefRenderer.ts`, `personaHeadings.ts` | `tests/brief-string-bus-f6.test.ts` |

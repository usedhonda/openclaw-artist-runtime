# Suno Create tabbed UI analysis

Observed: 2026-09-18, authenticated Suno V6 Create page in desktop Chrome.

This document is a reusable implementation reference for browser drivers and
Chrome extensions. It records the observed UI and DOM contract; it is not a
claim that Suno has published or guaranteed these selectors.

## Executive summary

The Create surface is now split into two top-level tabs:

- **Song** creates music tracks. Lyrics, Styles, and Controls are nested panels
  inside this tab and may not exist as visible controls until expanded.
- **Sounds** is a separate sound-effect / loop generator. It is not the place to
  edit a song's Style prompt.

An integration must select **Song** before resolving song fields, expand each
required panel, and reacquire the DOM after every tab or panel transition. A
global query for the first textarea, the first `Off` button, or any hidden input
is unsafe.

## Evidence labels

- **Observed**: read from the live page's rendered accessibility tree, screenshot,
  and DOM on the observation date.
- **Current-code finding**: read from this repository's existing driver.
- **Recommendation**: proposed implementation behavior, not a Suno guarantee.

## Top-level mode map

| Mode | Observed controls | Meaning |
|---|---|---|
| Song | Describe your song, Audio, Voices, Inspo, Lyrics, Styles, Controls, title, workspace, Create | Full song generation |
| Sounds | Sound description, One-Shot / Loop, BPM, Key, Create | Sound-effect or loop generation |

The active tab exposes `role="tab"` with `aria-selected="true"`. Generated IDs
such as `base-ui-_r_2p_` changed during the same inspection and must not be
persisted as selectors.

## Song mode structure

> Live update, 2026-09-19: the top-level labels changed from `Song / Sounds` to
> `Simple / Advanced / Sounds`. `Advanced` now owns the full lyrics, Styles,
> controls, and Create surface. Runtime selection therefore accepts either the
> former `Song` tab or the current `Advanced` tab as the song composer, but never
> treats `Sounds` as a song surface.

### Always-visible shell

| Element | Observed semantic signal | Notes |
|---|---|---|
| Song composer tab | `[role="tab"]`, visible text `Song`, or `aria-label="Advanced"`; `aria-selected` | Select this before any song operation |
| Sounds tab | `[role="tab"]`, visible text `Sounds` | Never select during a song fill |
| Model | button `aria-label="Model: v6"`; currently also `data-testid="mobile-create-model-button"` | Prefer aria label; treat test ID as secondary |
| Song description | visible textarea under heading `Describe your song` | No stable placeholder or aria label was observed |
| Create | button `aria-label="Create song"`, visible text `Create` | Boundary action; filling must never click it |

### Optional controls

Audio, Voices, and Inspo are buttons. Lyrics and Styles are collapsible panels.
Controls is also collapsible, although it was expanded in the observed session.

#### Lyrics panel

After expanding the `Lyrics` button:

- the toggle has `aria-expanded="true"`;
- the editor is a contenteditable element with
  `role="textbox"` and `aria-label="Lyrics editor"`;
- the displayed limit is 5,000 characters;
- Undo, Redo, New draft, Saved lyrics, and full-screen editor controls appear;
- a Cowriter prompt textarea also appears and must not be mistaken for lyrics.

The editor's semantic label is the strongest observed field selector:

```css
[role="textbox"][aria-label="Lyrics editor"]
```

#### Styles panel

After expanding the `Styles` button:

- the prompt is a textarea inside the expanded Styles section;
- the displayed limit is 1,000 characters;
- its placeholder contains changing recommended styles, so the placeholder is
  not a stable exact selector;
- saved-style, personalization, refresh, and recommendation buttons appear.

Select the textarea by scoping it to the expanded Styles section, not by matching
its current placeholder text.

#### Controls panel

Observed controls:

| Control | Observed signal |
|---|---|
| Exclude styles | `input[placeholder="Exclude styles"]` |
| Vocal Gender | row label plus `Male` / `Female` buttons |
| Duration | row label plus `Custom` / `Auto` buttons |
| Max Mode | row label plus `Off` / `On` buttons |
| Weirdness | `[role="slider"][aria-label="Weirdness"]` |
| Style Influence | `[role="slider"][aria-label="Style Influence"]` |
| Variety | `[role="slider"][aria-label="Variety"]` |
| Personalize | row label plus `My Taste`, `Off`, and `On` buttons |
| Song title | `input[placeholder="Song Title (Optional)"]` |

`Off` and `On` are repeated. They are valid only when resolved inside the row
whose visible label identifies Max Mode or Personalize.

## Sounds mode structure

Observed after selecting the Sounds tab:

| Section | Controls |
|---|---|
| Sound | one description textarea, 500-character display limit |
| Advanced Options | Type, BPM, Key |
| Type | One-Shot / Loop buttons |
| BPM | numeric stepper, Auto when empty |
| Key | popup button, Any by default |

Lyrics, Styles, song sliders, Personalize, and song title were removed from the
visible accessibility tree while Sounds was active. This confirms that Sounds is
a distinct creation mode, not a second page of the song form.

## DOM lifecycle and selector hazards

1. **Tab switches remount controls.** Generated IDs changed and whole element
   ranges disappeared/reappeared. Never cache DOM nodes or generated IDs across
   a tab switch.
2. **Panel expansion changes the candidate set.** Expanding Lyrics adds a second
   textarea for Cowriter; expanding Styles adds its own textarea. `textarea[0]`
   is therefore order-dependent.
3. **Repeated labels require row scope.** `Off`, `On`, `Custom`, and `Auto` occur
   in multiple controls.
4. **Hidden or inactive DOM may coexist in future builds.** Filter candidates by
   visibility and the active Song panel even if today's inactive tab is unmounted.
5. **Text can change.** Recommended Style placeholder content and generated
   accessibility IDs are ephemeral.
6. **React input state must be respected.** Direct property assignment without
   the matching input/change events can produce visual text that Suno does not
   retain.

## Recommended extension state machine

```text
OPEN_CREATE
  -> SELECT_SONG_TAB
  -> VERIFY_SONG_SELECTED
  -> FILL_DESCRIPTION (only when requested)
  -> EXPAND_LYRICS -> FILL_LYRICS -> READ_BACK_LYRICS
  -> EXPAND_STYLES -> FILL_STYLE -> READ_BACK_STYLE
  -> EXPAND_CONTROLS -> FILL_EXCLUDE_AND_CONTROLS
  -> FILL_TITLE
  -> VERIFY_ALL_FIELDS
  -> READY_FOR_HUMAN_CREATE
```

After every arrow, query the page again. A missing expected field should produce
a schema-drift result and stop; it must not trigger a fallback click on a nearby
button.

Sounds should have its own independent state machine and payload type. Do not add
`mode: "sounds"` as a loose option on a song payload whose Lyrics/Styles fields
would then silently disappear.

## Selector strategy

Use selectors in this priority order:

1. semantic role plus accessible name;
2. stable aria label;
3. stable placeholder;
4. a visible section heading/toggle followed by a scoped descendant query;
5. a documented test ID as a secondary fallback.

Avoid:

- generated `base-ui-*` IDs;
- `nth()` or the first global textarea;
- exact dynamic Style placeholder text;
- global `button:has-text("On")` / `button:has-text("Off")`;
- coordinates;
- a selector that accepts both Song and Sounds fields.

Recommended helper boundaries:

```ts
ensureCreateMode("song")
ensurePanelExpanded("Lyrics")
ensurePanelExpanded("Styles")
ensurePanelExpanded("Controls")
findVisibleWithin(panel, selector)
setAndVerify(field, value)
readSongForm()
```

`ensureCreateMode("song")` should be idempotent: if Song is selected, it does
nothing; otherwise it clicks Song once and waits for `aria-selected="true"` plus
one Song-only landmark such as the Lyrics toggle.

## Setting fields safely

For ordinary inputs and textareas, use the native value setter and dispatch both
`input` and `change` events when the extension runs in the page context. For the
contenteditable Lyrics editor, use its editor-compatible insertion path when
available; otherwise update content and dispatch an `InputEvent` with bubbling.

Every write must be followed by a normalized readback. For lyrics, compare the
full text and character count. For sliders and segmented buttons, compare their
accessible value or selected state rather than CSS color.

## Current artist-runtime incompatibilities

Current-code findings from the selector audit:

- `waitForSunoCreateFormReady()` assumes Create navigation, an Advanced button,
  and Create controls coexist visibly on one flat surface.
- preparation resolves lyrics, style, title, exclude, and controls globally and
  does not first establish top-level Song mode;
- the separate Playwright driver still contains exact legacy selectors and does
  not share a Song-tab activation helper;
- control lookups use label/ancestor relationships but are not scoped to the
  active top-level tab;
- existing fixtures model the older flat layout.

The smallest compatible repair is one shared `ensureSunoSongMode()` helper,
called before readiness, before fill/readback phases that may follow a remount,
and in both CDP and Playwright lanes. Field resolution should then be scoped to
the active Song surface. Sounds support is a separate feature, not part of that
repair.

## Minimum regression matrix

1. Page opens with Sounds active; the integration selects Song before resolving
   any song field.
2. Both tab DOMs are mounted; hidden Sounds fields are never selected.
3. Lyrics and Styles begin collapsed; each is expanded and filled correctly.
4. Cowriter textarea exists; it is never filled as lyrics or style.
5. Repeated `On` / `Off` buttons exist; Max Mode and Personalize are set by their
   own rows.
6. A panel remounts after another panel opens; locators are reacquired and
   readback still succeeds.
7. Song tab or a required field is absent; preparation fails closed and never
   clicks Create.
8. Sounds payloads cannot enter the song preparation path.

## Safety boundary

Preparation ends when all requested fields have been read back and the Create
button is visible. Clicking Create is a separate action and must never be hidden
inside discovery, selector recovery, or extension auto-fill logic.

# Producer Room Design System

Version: 1

Source direction: Superhuman-inspired quiet editorial productivity, tempered with Linear-style signal restraint.

This file is the visual source of truth for the OpenClaw Artist Runtime Producer Room. It must stay generic for distributed plugin users. Do not encode a specific producer, artist, account, workspace path, or private identity.

## Concept

Producer Room is not a machine console. It is a quiet room where the producer can understand what the autonomous artist is doing, see the next meaningful creative milestone, and make at most one decision when the artist actually needs one.

The interface should feel like a premium editorial workspace:

- Slow, calm, and readable.
- One primary action per moment.
- Health and creative signal before raw mechanics.
- Internal machinery hidden unless the user opens Diagnostics.
- Setup presented as identity design, not file editing.

## Design Principles

1. Signal only.
   - Show creative milestones, hard stops, and the single next action.
   - Do not surface routine internal churn in the main room.

2. One CTA per state.
   - Room may show one primary action when blocked or waiting for producer judgment.
   - Healthy states should explicitly say that nothing is needed.

3. Human language first.
   - Prefer "Artist is", "Status", "Why", "You can" over raw stage names.
   - File names such as ARTIST.md may remain visible, but role language must lead.

4. Editorial pacing.
   - Use generous space, strong hierarchy, and calm prose.
   - Avoid dashboards packed with equal-weight cards.

5. Diagnostics are secondary.
   - Developer controls, raw JSON, run-cycle, ledgers, and low-level panels belong in Diagnostics.
   - Room, Songs, Settings, and Setup should remain producer-facing.

## Color System

The system uses three canvases.

### Dark Indigo

- Token: `--pr-indigo`
- Value: `#1b1938`
- Role: hero/status bands, serious blocked states, header accents.
- Text: `#ffffff`
- Use sparingly. It should feel like a night room, not a default app background.

### White

- Token: `--pr-canvas`
- Value: `#ffffff`
- Role: primary content floor, cards, forms.
- Text: `#292827`

### Deep Teal

- Token: `--pr-teal`
- Value: `#0e3030`
- Role: resolving band, footer, important calm end-state panels.
- Text: `#ffffff`
- Non-negotiable: every major Producer Room page should have one teal resolving moment or footer band.

### Supporting Colors

- `--pr-ink`: `#292827` for primary text.
- `--pr-muted`: `#73706d` for helper text.
- `--pr-faint`: `#9a9794` for tertiary text and disabled hints.
- `--pr-soft`: `#fafaf8` for quiet alternate panels.
- `--pr-line`: `#e8e4dd` for hairlines.
- `--pr-violet`: `#c9b4fa` for rare highlight chips on dark indigo.
- `--pr-warning`: `#8b5e00` for warnings.
- `--pr-danger`: `#9f2f24` for critical error text.

Do not introduce a second loud accent palette. Color should clarify state, not decorate machinery.

## Typography

Use a single warm sans stack for UI:

```css
font-family: "Inter Variable", "Avenir Next", system-ui, -apple-system, "Segoe UI", sans-serif;
```

Recommended weights:

- Display: 540 if variable fonts are available, otherwise 600.
- Section title: 540 or 600.
- Body: 460 if variable fonts are available, otherwise 400.
- Button: 650 or 700.

Type scale:

- Hero display: `clamp(2.4rem, 5vw, 4rem)`, line-height `0.96`.
- Page title: `2rem`, line-height `1.08`.
- Section title: `1.25rem`, line-height `1.2`.
- Body: `1rem`, line-height `1.5`.
- Helper: `0.9rem`, line-height `1.45`.
- Micro labels: `0.78rem`, line-height `1.35`, letter-spacing `0.08em`.

Avoid monospace in main producer-facing surfaces except proposal IDs, technical run IDs, and Diagnostics.

## Layout

- Max width: 1120px for the app shell.
- Base spacing: 8px.
- Section rhythm: 64px minimum, 96px preferred for major blocks.
- Card gap: 16px to 24px.
- Card padding: 24px desktop, 18px mobile.
- Room header should be a wide editorial panel, not a grid of widgets.
- Setup should read as layered identity design: map first, core layers expanded, deep layers collapsed.

## Components

### Primary Button

- Background: dark indigo.
- Text: white.
- Radius: 8px.
- Padding: 12px 20px.
- One primary button per surface.

### Secondary Button

- Background: white.
- Text: warm ink.
- Border: 1px solid warm hairline.
- Radius: 8px.

### On-Dark Button

- Background: soft violet.
- Text: dark indigo.
- Radius: full pill.
- Use only inside a dark indigo band.

### Card

- Background: white or soft white.
- Border: 1px solid warm hairline.
- Radius: 12px.
- Shadow: none or very subtle. Avoid heavy dashboard shadows.

### Status / Signal Card

- Healthy: white card, muted helper text, no primary CTA.
- Paused / blocked: dark indigo header treatment with one action if the producer can fix it.
- Hard stop: concise explanation and a recovery instruction, no noisy internals.
- Resolved / closing: deep teal band.

### Setup Layer Card

- Show the human role first, then the file name.
- Keep file names visible for transparency.
- Field help must explain where the field affects the artist.
- AI draft buttons must state that they only fill the draft field and do not save.

## Room Grammar

Room must preserve this fixed producer-facing grammar:

- Artist is:
- Status:
- Why:
- You can:

Rules:

- `Why` appears only when there is a blocker or hard stop.
- `You can` contains one action or one calm instruction.
- Healthy state: "Nothing needed - 次の曲を構想中".
- Reauth state: explain that reauthentication is required and `/resume` cannot fix it.

## Navigation

Primary navigation:

- Room
- Songs
- Setup
- Settings

Diagnostics is a small footer link, never a primary tab.

## Motion

Use motion sparingly:

- Page load: subtle fade/raise for the Room header.
- State change: one short highlight pulse on the changed card.
- No looping ambient animation in the main room.

## Do

- Lead every main view with a human summary.
- Keep the main UI calm even when the system is busy.
- Use dark indigo for serious moments and deep teal for resolution.
- Keep buttons plain and specific.
- Keep setup copy generic for any artist identity.

## Do Not

- Do not make Room look like a developer dashboard.
- Do not show more than one primary CTA in Room.
- Do not add producer commands that bypass the artist flow.
- Do not encode a specific artist, producer, account, or path.
- Do not use Spotify-style music-player chrome.
- Do not use Notion-style colorful database clutter for the core room.
- Do not turn Linear influence into a dense issue tracker.

## View Guidance

### Room

The Room is the main producer surface. It should contain:

- The fixed grammar header.
- The current creative timeline.
- One decision mirror when Telegram has an active decision.
- A small note that Telegram is the primary action surface when relevant.

### Songs

Songs is an archive and playback ledger. It should be quiet and read-only unless an existing approved action is already available.

### Setup

Setup is identity design. It should explain the five persona layers and each field's downstream effect.

### Settings

Settings is steering. It may expose configuration, but should be grouped into calm sections: Autonomy, Suno, Platforms, Safety.

### Diagnostics

Diagnostics can remain dense. It is the storm shelter for raw controls, old dashboard tools, and developer-only inspection.

## Implementation Notes

- Keep behavior changes out of visual work.
- Prefer CSS variables matching this document.
- Existing React component names may remain.
- If a component must violate this design for a functional reason, document the reason in code or a follow-up plan.

# Producer Room UI Evaluation Loop

This document defines how to judge and iterate on Producer Console / Producer Room usability.

The loop is intentionally evaluation-first. Do not start by redesigning screens. First capture evidence, score the page, list failures, and only then pick a small fix.

## Method References

- NN/g heuristic evaluation: evaluate UI against usability principles after walking through representative tasks.
  <https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/>
- NN/g cognitive walkthrough: inspect whether a new user can discover and complete the next correct action.
  <https://www.nngroup.com/articles/cognitive-walkthroughs/>
- NN/g severity rating: prioritize problems by frequency, impact, and persistence.
  <https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/>
- W3C WAI Easy Checks: basic readability, headings, labels, forms, focus, and interaction checks.
  <https://www.w3.org/WAI/test-evaluate/preliminary/>

## Product Contract

- Telegram is the primary operation surface.
- Console is mirror, setup, settings, recovery, and audit.
- Healthy states should not show extra action buttons.
- Blocked, hard-stop, paused, or decision-pending states may show one useful next action.
- Do not solve confusion by adding screens, wizards, or debug panels.
- Do not bring Run Cycle, Manual Create, or debug controls into Room.
- Do not expose workspace-local paths, personal distribution IDs, personal URLs, or artist-specific defaults in distributable UI.
- Do not touch R10, publish gate, dryRun, or OPENCLAW_SUNO_LIVE during UI evaluation loops.

## Evaluation Axes

Score each axis 0-3.

- 0: Broken. The producer is likely to misunderstand or fail the task.
- 1: Confusing. The task may be possible, but depends on memory or guesswork.
- 2: Usable but rough. The task works, but copy, ordering, or duplication hurts comprehension.
- 3: Clear. The page communicates current state and the next action quickly.

### 1. Task Success

Can the producer complete the intended task?

Check:
- Can the producer tell what the artist is doing now?
- Is the next producer action zero or one, not several competing actions?
- Are healthy, blocked, paused, and decision-pending states mutually consistent?
- Is each action result predictable?
- Does Console stay a mirror instead of replacing Telegram?

### 2. Information Architecture

Is information placed in a readable order?

Check:
- Is the most important information at the top?
- Are long text fields readable instead of horizontally squeezed?
- Are non-equivalent items visually differentiated?
- Is repeated explanatory copy removed?
- Are internal filenames and stages secondary, not dominant?

### 3. Language

Does the page use producer language instead of implementation language?

Flag unless justified:
- callback
- producer decision
- asset_generation
- Live-Go Arm
- Suno Submit Mode
- AI下書き
- ARTIST.md / SOUL.md as dominant user-facing labels

Check:
- Is Japanese / English mixing intentional and understandable?
- Does each button label describe the result?
- Does each setting explain what it affects?

### 4. Operation Trust

Can the producer trust visible controls?

Check:
- No button should look actionable if it is a no-op.
- Disabled controls should have an understandable reason.
- Save scope should be clear.
- AI-assisted field changes should be reversible.
- Checkboxes and labels should be visually connected.
- Dangerous actions should not look the same as routine actions.

### 5. Duplication / Contradiction

Does the page avoid conflicting or repeated state?

Check:
- The same song should not appear in multiple forms with different implied meaning.
- The same action should not appear as multiple independent rows.
- A setting should not appear in multiple places without a clear source of truth.
- Room, Songs, Setup, Settings, and Diagnostics should not compete for the same job.

### 6. Distribution Readiness

Can this UI ship to another operator?

Check:
- No local absolute paths.
- No personal URLs or distribution IDs as defaults.
- No artist-specific identity hardcoded into distributable UI.
- A first-time operator can understand how to create their own artist.

## Severity

Use severity to choose the next loop.

- S0: Not a usability problem.
- S1: Cosmetic.
- S2: Minor.
- S3: Major. Fix soon.
- S4: Catastrophic. Must fix before release.

Severity must mention:
- Frequency: how often the producer hits it.
- Impact: what task breaks or becomes risky.
- Persistence: whether the problem keeps blocking future attempts.

## Required Evidence

No evidence, no issue.

Each issue must cite at least one:
- screenshot path
- visible DOM text
- API response path and relevant field
- file:line

Do not write:
- probably
- looks like
- seems fixed
- should be fine

Write:
- Fact: screenshot `<path>` shows `<text>`.
- Fact: DOM contains `<text>`.
- Fact: GET `<api>` returns `<field>`.
- Fact: `<file>:<line>` renders `<component>`.

## Browser Capture Targets

Open with Playwright or browser use:

- `http://127.0.0.1:43134/plugins/artist-runtime#room`
- `http://127.0.0.1:43134/plugins/artist-runtime#songs`
- `http://127.0.0.1:43134/plugins/artist-runtime#setup`
- `http://127.0.0.1:43134/plugins/artist-runtime#settings`
- `http://127.0.0.1:43134/plugins/artist-runtime#diagnostics`

Capture for each page:
- screenshot
- body visible text
- headings
- buttons
- links
- form controls
- relevant API responses

Use `domcontentloaded` plus a fixed wait. Do not rely on `networkidle`; EventSource can keep the network open.

## Page Tasks

### Room

- Identify what is happening now.
- Identify whether producer action is needed.
- If action is needed, identify the one next action.
- Check whether Console is trying to replace Telegram.
- Check whether the same song, action, or status is repeated.

### Songs

- Identify the state of one song.
- Distinguish finished, adopted, discarded, and still waiting.
- Check whether the song list is readable without parsing IDs.
- Check whether lifecycle timeline adds value or duplicates the list.

### Setup

- Identify what identity field is being edited.
- Read the current field value before editing.
- Check whether AI assist is understandable and reversible.
- Check whether save scope is clear.
- Check whether internal filenames help or distract.

### Settings

- Identify safety-critical settings.
- Check whether checkboxes are visually attached to labels.
- Check whether dangerous controls are visually separated.
- Check for duplicate source-of-truth settings.
- Locate language ratio, identity, Suno style, and lyrics policy settings if present.

### Diagnostics

- Check whether opening Diagnostics shows something useful.
- Check whether Diagnostics is clearly secondary.
- Confirm debug controls stay here and not in Room.
- If blank or loading, confirm the page explains what is happening.

## Report Format

First produce a score table:

```text
Page | Task Success | IA | Language | Operation Trust | Dup/Contradiction | Distribution | Worst Severity
Room | 0-3 | 0-3 | 0-3 | 0-3 | 0-3 | 0-3 | S0-S4
Songs | ...
Setup | ...
Settings | ...
Diagnostics | ...
```

Then list issues:

```text
Issue ID:
Page:
Severity:
Axis:
Fact:
Evidence:
Impact:
Fix:
Do not fix by:
```

`Do not fix by` is mandatory. It prevents over-complex fixes.

Common examples:
- Do not add a new page.
- Do not add a wizard.
- Do not make Console primary.
- Do not show more internal state.
- Do not add explanatory copy where layout is the real problem.

## Loop Selection

Pick at most 1-3 issues for the next implementation loop.

Priority:
- User-observed pain first.
- S4/S3 before S2/S1.
- Remove confusion before adding UI.
- Fix ordering and wording before adding controls.
- Prefer deleting repeated copy to adding more explanation.

Before editing, output:

```text
This loop will fix:
- ...

This loop will not fix:
- ...

Expected screen change:
- ...

Likely files:
- ...
```

Stop for owner confirmation unless autonomous implementation was explicitly requested.

## Judge Prompt

Use this exact prompt for an AI judge.

```text
You are evaluating Producer Room as a producer-facing UI, not as a developer dashboard.

Product contract:
- Telegram is the primary operation surface.
- Console is mirror, setup, settings, recovery, and audit.
- Healthy states should not show extra action buttons.
- Blocked, hard-stop, paused, or decision-pending states may show exactly one useful next action.
- Do not propose new screens, wizard flows, or debug controls in Room.
- Do not expose workspace-local paths, personal distribution IDs, personal URLs, or artist-specific defaults in distributable UI.

Method:
- Use browser evidence only.
- Do not infer from code alone.
- For each issue, provide Fact / Impact / Fix.
- Every Fact must cite screenshot path, visible DOM text, API response, or file:line.
- If evidence is missing, say "Evidence missing" and do not score that issue.

Evaluate these pages:
- Room
- Songs
- Setup
- Settings
- Diagnostics

For each page, perform these tasks:
1. Identify what the artist is doing now.
2. Identify whether producer action is needed.
3. If action is needed, identify the one next action.
4. Identify visible buttons and whether their result is clear.
5. Identify duplicated song/action/status/config information.
6. Identify internal terms that producer should not need to understand.
7. Identify any conflict with Telegram-primary / Console-mirror.
8. Identify any distributability problem.

Score each page 0-3 on:
- Task Success
- Information Architecture
- Language
- Operation Trust
- Duplication / Contradiction
- Distribution Readiness

Severity:
- S0 no issue
- S1 cosmetic
- S2 minor
- S3 major
- S4 usability catastrophe

For each issue output:
Issue ID:
Page:
Severity:
Axis:
Fact:
Evidence:
Impact:
Fix:
Do not fix by:

At the end, choose at most 3 issues for the next implementation loop.
Prefer removing confusion over adding UI.
Do not implement.
```

# LOOP: Persona Setup と Suno 生成品質の回帰を止める

GOAL: Persona Setup の 5 MD 正本ルール、AI 提案ボタン、Suno prompt pack の style/language 反映を、実装変更後も毎回テストで保証する。特に「AI が作った内部/generated ファイルの問題をユーザーに見せる」「設定にあるのに曲生成に反映されない」「ドパガキ/言語比率の指示が Style/YAML/payload に届かない」を再発させない。

DONE: 全 SUCCESS CRITERIA が現在のコードと生成物で満たされ、VERIFY gate が 2 連続 clean。完了時は `FINAL` を出して止まる。

SUCCESS CRITERIA:
1. 5 MD の全体像が UI/API/test で保たれる。`ARTIST.md` / `SOUL.md` / `PRODUCER.md` はユーザー入力領域を持ち、`IDENTITY.md` は derived read-only、`INNER.md` は runtime/internal 管理として扱われる。raw 5 MD tabs は復活しない。
2. 正本 owner が散乱しない。artist display name と producer callname は config の canonical identity だけが user input owner で、MD 内の名前欄や wrong-file duplication は audit fail になる。`INNER.md` 未入力は setup completion を block しない。
3. Setup UI の説明は、各ファイルの「何を書く / 自動生成か / 必須か / 任意か」が一目で分かる。短い badge が折り返して読みにくくならず、英語のまま自然なタイトルと日本語補助説明の混在を許す。
4. AI 提案機能は draft-only で動く。未入力補完、全体添削、尖った案の各ボタンは対象フォーム付近へ提案を返し、保存済み内容を勝手に上書きしない。失敗時は user-facing error を出し、テストで少なくとも 1 つの失敗経路を押さえる。
5. 内部/generated ファイルの自己ダメ出しをユーザーに見せない。AI が生成する `IDENTITY.md` / `INNER.md` 系の不備は、可能な範囲で自動修復するか内部 audit に落とし、Setup のユーザー警告にしない。
6. Suno prompt pack は ARTIST/設定の style/language 指示を実際に反映する。通常の「少しドパガキ」は薄い揺らぎ、強い/露骨な「ドパガキ」は overt dopamine-pop pressure として Style に出る。曲ごとの揺らぎがあり、完全テンプレート化しない。
7. 歌詞の日本語/英語比率は YAML と payload の両方に反映される。意図した bilingual lyrics で residual kanji 警告を誤爆させない。
8. public/package 対象に producer の個人情報に近いコメント、内部語、絶対パス、ローカル固有名が残らない。`.local/` のユーザー固有内容は seed/history として扱い、配布物へ出さない。

VERIFY gate (最速から。最初の red で停止して原因を直す):
1. `npm run typecheck`
2. `npx vitest run tests/persona-file-builder.test.ts tests/persona-field-auditor.test.ts tests/persona-setup-detector.test.ts tests/persona-proposer.test.ts tests/persona-route.test.ts tests/persona-editor.test.ts tests/producer-room-app.test.ts`
3. `npx vitest run tests/prompt-pack-v55-style.test.ts tests/prompt-pack-v55-yaml.test.ts tests/prompt-pack-v55-orchestration.test.ts tests/lyrics-language-lint.test.ts tests/lyrics-residual-kanji.test.ts tests/suno-payload-lyrics-text.test.ts`
4. `npm test`
5. `npm run build`
6. `npm run pack:verify`

Manual/generated-output check:
- If an iteration changes prompt-pack generation or `.local` song output, generate or inspect one fresh prompt pack and verify:
  - `validation.valid` is `true`
  - `validation.errors` is empty
  - Style contains the requested variation strength without malformed comma tags
  - YAML `language` and payload lyrics contract reflect the requested Japanese/English ratio
  - no user-specific producer comments are written outside `.local/`

STATE FILE: `.loop/persona-suno-regression-state.md`
- Read before every run. Resume, do not restart.
- Append each iteration: observed failure, changed files, test evidence, next step.

LEARNINGS FILE: `.loop/learnings.md`
- Read before every run. Add one durable rule only when a new reusable failure class is found.

BUDGET:
- iteration cap 6
- no-progress streak 2
- one failure class gets at most 3 fix attempts before `failure`

EACH ITERATION:
1. RE-READ this loop, state, learnings, and the latest user observation that triggered the run.
2. RUN VERIFY until the first red. If everything is green and no new requested change exists, run the fastest focused gate once more; if still green, count it as a clean iteration.
3. PLAN one smallest user-visible or contract-visible failure to fix. Keep `Task Intent` to one sentence.
4. EXECUTE the smallest change that makes the failed criterion testable and green.
5. REGRESSION GUARD: for every fixed bug, add or update one focused test that would have failed before the fix.
6. VERIFY the focused test first, then continue through the gate. Run full `npm test`, `npm run build`, and `npm run pack:verify` before `FINAL`.
7. UPDATE state with evidence. Commit and push any repo change before reporting completion.
8. DECIDE:
   - all criteria green for 2 consecutive clean iterations -> output `FINAL`
   - otherwise output `ITERATING`

STOP WHEN (label the stop_reason):
- success: 2 consecutive clean iterations
- no-progress: 2 iterations with no new evidence or the same plan/tool action repeated
- oscillation: same problem/fix pair repeated 3 times
- failure: one failure class still red after 3 focused attempts
- budget: iteration cap 6 reached
- scope-boundary: a fix would require changing unrelated product scope, exposing secrets, or baking user-specific data into public/package files

RULES:
- User observation is fact. If the UI screenshot shows a regression, the loop explains and fixes that path.
- Do not make the user repair generated/internal files. Generated/internal failures should be auto-fixed or hidden behind internal diagnostics.
- Do not weaken tests or hide warnings to get green.
- Do not add broad rewrites. Every diff line must trace to a SUCCESS CRITERION.
- Search before saying a setting is unused.
- Keep public templates neutral and distribution-safe.
- Report compactly: changed behavior, evidence command, remaining risk, `FINAL` or `ITERATING`.

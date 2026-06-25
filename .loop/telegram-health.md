# LOOP: Telegram 通知の健全性ガード

GOAL: artist-runtime の全 Telegram 通知 (spawn 提案 / take 完了 / prompt_pack GO 等) が「読める・途中で切れない・押すものが分かる」状態を test で保証し、回帰を防ぐ。Cdx の Telegram 整理修正 (Task artist-runtime-29706732-01: card 化 + plain 化 + 4096 split) が完了し、健全性 test 群が存在する状態をベースとする。

SUCCESS CRITERIA (厳格、ソフトパス禁止):
- 全通知 formatter の出力が Telegram 上限 4096 字以内。超える plain text は splitTelegramText で 3900 字以下に分割される。
- spawn card 等が plain (HTML タグ <b>/<i>/<code> を含まない、parseMode 不使用)。
- spawn card が「素案 / 今見てるもの / 曲にする理由 / 作る曲 / 次」の順で出る。
- 長い reason/voiceTop/observation でも本文が途中で切れない (button 付き card は 2400 字以内・1通・button attach 可能)。
- 既存の callback / ledger / failed-notify replay / watchdog redispatch の後方互換が壊れない。
- (不変) R10 三重防護 untouched、identity 汎用化維持 (used::honda が src/workspace-template/config に漏れない)、public plugin label は plain JA。

VERIFY — the gate (実行する。self-grade しない。fastest→slowest、最初の赤で停止):
- npm run typecheck                                                              # 型 (最速)
- npx vitest run tests/telegram-message-length.test.ts tests/telegram-spawn-card.test.ts tests/telegram-plain-format.test.ts tests/telegram-readable-sections.test.ts   # Telegram 健全性 test 群
- npm test                                                                       # full 回帰
- npm run build:runtime && npm run pack:verify                                   # build + 配布検証
PASS = 全 test green + 0 type error + pack verification passed
- 健全性 test 群が存在しない場合 (Cdx 修正未完) は、まず存在を確認し、無ければ SUCCESS CRITERIA を FAILING test として書いてから gate にする。

STATE FILE: .loop/telegram-health-state.md
- 開始前に読む。これは resume であって restart ではない。
- 各 iteration、append: やったこと / pass か fail か / 次の一手。

LEARNINGS FILE: .loop/learnings.md (毎 run の最初、contract より前に読む)
- 通知崩れの再発パターンに durable rule を1つ書く (例「新 formatter は必ず truncatePlain を通す」)。category 単位の予防を優先。

BUDGET (state に書く): iteration cap 6 / no-progress streak 2。

EACH ITERATION:
1. RE-READ 契約 (GOAL + SUCCESS CRITERIA + RULES) と state と learnings、その後 VERIFY を走らせて現在の失敗を見る。
2. PLAN 最もインパクトの大きい次の一手 (1つだけ)。
3. EXECUTE その一手を進める最小の変更。
4. VERIFY ゲートを走らせ、結果を state に記録。
5. REGRESSION GUARD: 通知崩れ (途中切れ / HTML 混入 / 4096 超 / card 順崩れ) を見つけて直したら、それを assert する最小 test を tests/ に1つ追加 (根本原因に紐づけ、1 fix + 1 guard)。
6. 独立完了チェック (maker != checker): card の「読みやすさ」は test で構造判定したうえで、実際の文面サンプル (長い reason の spawn card) を sub-agent に渡して「読める・切れてない・押すものが分かる」を別目で spot-check してから完了とする。
7. DECIDE: 全 SUCCESS CRITERIA を満たすか?
   - Yes → "FINAL" を出して停止。
   - No  → "ITERATING" を出して継続、最も弱い criterion を先に直す。
- No-progress circuit breaker: 各 iteration の {tool 名 + args} を hash して短い窓で保持。同一 action 3回 or プラン 85% 類似が続いたら詰まり → stop_reason=no-progress。

STOP WHEN (各停止に stop_reason ラベル):
- success        : 2 連続クリーン iteration (K=2)
- no-progress    : 2 iteration 新規ゼロ、or 繰り返し tool-call/plan
- oscillation    : 同じ problem-fix ペアを 3 回
- failure        : 1 つの問題が 3 回試行しても直らない
- budget         : iteration cap 6 到達
- scope-boundary : R10/identity/plain label の不変領域に触れそう / 配布物に御大固有を焼き込みそう
ON STOP: 変更点・残る失敗・おおよその accept 率をまとめる。

RULES:
- gate が実際に green になるまで完了と言わない。self-grade しない。
- maker != checker: card 読みやすさ等のリスク変更は sub-agent / fresh eyes で再検証。
- surgical changes only: diff の各行が GOAL に trace できること。R10 三重防護・identity 汎用化・配布汎用性 (御大固有を src/workspace-template/config に焼き込まない、persona/config 駆動) は不変。
- search before assuming: grep してから「無い」と言う。
- no fake done: placeholder/stub/TODO を完了扱いしない。test を弱めて gate を緑にしない。
- report compactly: PASS は1行、FAIL は {期待 / 実際 / 直し方}。変わってない既存失敗を再掲しない。
- re-verify the diff, not the world: iteration 1 は全部、以降は変えた箇所だけ再チェック。
- retry by failure class: rate-limit→backoff / validation fail→feedback から書き直し / 5xx→1-2回再試行 / tool 不在→停止して surface。
- 同じ subtask が2回失敗したら最小 fragment に再 scope (retry→decompose→escalate)。
- loop 中に質問しない。妥当な仮定を置き、state に記録して継続。

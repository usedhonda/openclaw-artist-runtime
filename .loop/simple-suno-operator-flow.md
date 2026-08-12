# LOOP: Suno の操作面を簡単なまま保つ

GOAL: Suno 楽曲制作で、修復可能な内部不具合は runtime が処理し、producer には必要な操作と完成結果だけを見せる。manual submit では入力済み画面を前面に出して Create の直前で止まり、producer が押した後は取込・選曲・Telegram 完了通知まで自動で進む。

SUCCESS CRITERIA（soft pass 禁止）:
1. 漢字残留・歌詞長・一時的な prompt-pack validation failure は bounded retry で内部修復され、途中の `lyrics_generation_degraded` を Telegram へ送らない。
2. 内部修復を使い切った1曲は、その曲だけを監査可能な状態で隔離する。autopilot 全体を pause/hard stop にせず、別の曲・観測・日次処理を継続できる。
3. `music.suno.submitMode` は Producer Console で `manual` / `live` を選べる。`manual` はフォームを入力して前面表示するが Create を押さず、`live` の既存自動 Create 契約を壊さない。
4. manual submit の Telegram は内部コードや validator detail を見せず、「調整して Create」を1回だけ依頼する。Create 後は URL ready と completion を重複なく通知する。
5. Create 後の accepted run は同じ run identity のまま imported -> take_selected へ進み、実ファイルと Telegram delivery receipt が残る。再 Create で回復しない。
6. public/package 対象へ認証情報、個人情報、端末固有の絶対パス、`.local/` の曲データを出さない。CAPTCHA・login・payment の自動操作は追加しない。

VERIFY（最速から。最初の red で停止）:
1. `npm run typecheck`
2. `npm run lint`
3. `npx vitest run tests/prompt-pack-park-and-advance.test.ts tests/lyrics-drafting-repair.test.ts tests/config-field-meta.test.ts tests/config-editor-payload.test.ts tests/producer-room-app.test.ts tests/human-assist-suno-connector.test.ts tests/suno-human-assist-card.test.ts tests/telegram-notifier.test.ts tests/autopilot-suno-import-stage.test.ts tests/autopilot-completion-stage.test.ts tests/telegram-take-completed-push.test.ts`
4. 変更がブラウザ DOM/driver に触れた場合だけ: `npx vitest run tests/cdp-human-assist-session.test.ts tests/cdp-human-assist-informational-dialog.test.ts tests/suno-selector-regression.test.ts`
5. FINAL の直前だけ: `npm test`
6. FINAL の直前だけ: `npm run build && npm run pack:verify && npm run boundary-grep && npm run leak-scan`

PASS:
- 関連 focused gate が全て exit 0。
- FINAL では full gate も全て exit 0。registry に未公開の依存など repo 外要因は green 扱いせず、`stop_reason=failure` として事実を state に残す。
- runtime/browser 挙動を変更した場合は、下記 LIVE ACCEPTANCE を1回だけ満たす。

LIVE ACCEPTANCE（課金・外部 side effect のため毎 iteration では禁止）:
- 既存の `song-085` は t=0 の確認済み基準: manual Create、2 takes accepted、2 non-empty audio files、take_selected、`song_take_completed` delivery receipt。
- 新しい live run は、runtime/browser の挙動を変更し、かつユーザーがその run を直接許可した場合だけ1回行う。
- 実行時は `manual` を確認し、フォーム入力済み・Create visible/enabled・未押下を DOM readback で確認する。producer が押した後に accepted/imported/take_selected、non-empty files、Telegram completion receipt を確認する。
- CAPTCHA/login/payment challenge は止めて通知する。解決を自動化しない。

STATE FILE: `.loop/simple-suno-operator-flow-state.md`
- 最初に読む。restart ではなく resume。
- 各 iteration に、対象 criterion、変更、focused gate、full/live gate の要否、次の1手を追記する。

LEARNINGS FILE: `.loop/learnings.md`
- run の最初に読む。同じ失敗が2回起きるまでは UNVERIFIED、独立再現後だけ DURABLE に昇格する。

BUDGET:
- iteration cap 6
- no-progress streak 2
- 同じ failure class は最大3回
- 重い full gate は FINAL 前の1回。変更なしで再実行しない。
- live generation はユーザーが直接許可した1回だけ。

EACH ITERATION:
1. この contract、state、learnings、最新のユーザー観測を読む。ユーザー観測を一次事実として扱う。
2. focused VERIFY を最速順に走らせ、最初の red か最弱 criterion を1つだけ選ぶ。
3. Fact と Hypothesis を分け、一次ソースで原因を確定する。推測のまま修正しない。
4. Task Intent を1文で固定し、その criterion へ直結する最小変更だけを行う。
5. 外から観測できるバグまたは未保護の契約にだけ、既存テストの更新か最小 regression test を1つ加える。中間 patch ごとにテストを増やさない。
6. focused gate を実行する。ブラウザを drive した場合は、対象 Suno page、フォーム可視性、入力 readback を確認し、blank/別 profile/別 window を成功扱いしない。
7. FINAL 候補になった時だけ full gate を1回実行する。runtime/browser を変えた場合のみ、直接許可を確認して LIVE ACCEPTANCE を1回行う。
8. state を更新し、動く論理単位だけ conventional commit して push。`HEAD == origin/main` を確認する。
9. 全 criteria が証拠付きで満たされたら `FINAL`。未達なら次の最小stepを記録して `ITERATING`。

STOP WHEN（state に `stop_reason` を記録）:
- `success`: 全 criteria と必要な gate が通過。
- `no-progress`: 新しい証拠なしが2 iteration、または同じ action を3回。
- `oscillation`: 同じ problem/fix pair を3回。
- `failure`: 1 failure class が3回で直らない、または repo 外の必須 gate が回復しない。
- `budget`: iteration cap 6。
- `regression`: post-fix gate が既存 pass を落とした。commit/push せず freeze。
- `unrecoverable-harness`: Suno page/form/receipt の観測が空・別 context・判定不能。
- `scope-boundary`: CAPTCHA/login/payment 自動化、ledger rewrite、無関係な public API/schema 変更が必要。

RULES:
- ユーザーに内部を必要以上に意識させない。通常通知は「必要な操作」「現在の結果」「回復不能な外部 gate」だけ。
- 小さな曲固有エラーを全体 pause/hard stop に昇格しない。failure domain は song 単位を基本とする。
- Create を押すかどうかは persisted config の契約。manual で勝手に押さず、live を勝手に manual にしない。
- ledger は append-only。既存行を書き換えない。認証情報・cookie・token・個人画面を出力しない。
- test を削除・skip・弱化して green にしない。mock URL や空ファイルを live 成功に数えない。
- maker != checker: risky diff は fresh diff review と一次証拠を使い、自己申告だけで FINAL にしない。
- surgical changes only。変更行は1つの SUCCESS CRITERIONへ追跡できること。
- 質問は high-impact な仕様判断か物理操作だけ。調査・修復・再起動・確認をユーザーへ投げない。
- 報告は簡潔にし、PASS は1行、FAIL は expected / actual / next fix だけを書く。


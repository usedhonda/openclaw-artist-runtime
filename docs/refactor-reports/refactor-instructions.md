# refactor-instructions.md — artist-runtime リファクタリング指示書

> 実装担当モデルへ: この文書は 2026-06-11 時点のコードベース全体調査（証拠付き）に基づく。
> あなたの仕事は **既存仕様を一切壊さず**、ここに列挙された負債を小さく安全な順で減らすこと。
> 見た目の綺麗さは目的ではない。証拠なく大きな削除・全面書き換えをしてはならない。

---

## 1. Objective

`@yzhonda/openclaw-artist-runtime`（OpenClaw ネイティブプラグイン、ClawHub/npm 配布物）の保守性を上げる。具体的には:

1. 巨大ファイル（routes/index.ts 2,393行、autopilotService.ts 1,493行、telegramNotifier.ts 1,421行）の責務分離
2. 重複コードの統合（voice 合成、payload 抽出、型定義）
3. エラーハンドリングの可視化（82箇所の `.catch(() => undefined)` の選別的改善）
4. env var アクセスの一元化
5. ドキュメントと実装のドリフト解消

**変更後も全 623 テストファイル・CI 全ジョブ・pack:verify が green であること。外部から観測できる振る舞い（HTTP レスポンス形状、Telegram メッセージ書式、ledger 形式、tarball 内容）は 1 bit も変えない。**

---

## 2. Project Understanding

### 2.1 これは何か

OpenClaw Gateway 上で動く「公開自律 AI ミュージシャン」プラグイン。エージェントがアーティストとして:
X/ニュース観察 → 曲アイデア提案 → 歌詞生成 → Suno（ブラウザ自動化）で楽曲生成 → プロデューサー（人間）が Telegram から採用/破棄 → SNS 発信、を自律ループする。
ユーザー＝プロデューサーの日常 UI は **Telegram**。Web の Producer Console（React + Vite, `ui/`）は管制塔（設定・監査・復旧）。

### 2.2 エントリーポイントと登録面

- `src/index.ts` (63行): `definePluginEntry` 形。`registerTools / registerHooks / registerServices / registerRoutes / registerCommands` + Telegram interactive handler を登録
- `src/pluginApi.ts`: OpenClaw SDK 互換 shim（`safeRegister*`）。SDK 直 import を避けるための分離層 — **この分離は意図的。維持せよ**
- HTTP: `src/routes/index.ts` が `/plugins/artist-runtime/api/*` に 24 ベースパスを登録。SSE は `src/routes/runtimeEventStream.ts`
- Telegram コマンド 12 個 (`src/commands/index.ts`) → `routeTelegramCommand` へ集約

### 2.3 データフロー（コア）

```
autopilotTicker (interval 180min + fast-chain 20s)
  → ArtistAutopilotService.runCycle()   … 1 tick = 1 stage 前進の状態機械
  → 状態: .{workspace}/runtime/autopilot-state.json
  → イベント: RuntimeEventBus (35+ 種) → telegramNotifier (購読→送信)
                                       → runtimeEventsLedger (runtime-events.jsonl 追記)
song 状態: songs/<id>/song.md の frontmatter (idea→brief→lyrics→…→published/archived/discarded)
ボタン操作: callback-actions.jsonl (登録: callbackActionRegistry / 掃除: callbackLedgerMaintenance / 再浮上: callbackPollingWatchdog)
Suno: sunoBrowserWorker → sunoPlaywrightDriver (playwright-extra + stealth) → runtime/suno/<runId>/
```

### 2.4 外部依存

- **OpenClaw Gateway** (peerDep, optional) — SDK 契約は pluginApi.ts に隔離
- **Telegram Bot API** — telegramClient.ts（retry + per-request timeout 実装済み）
- **Suno**（ブラウザ自動化。ログイン必須、CAPTCHA/支払い等は fail-closed）
- **bird CLI**（X 投稿）、Instagram/TikTok 公式 API、iTunes Search API、RSS
- **AI provider** — aiProviderClient.ts（openai-codex 等。未設定なら mock fallback）

### 2.5 検証コマンド（baseline）

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest run（623 test files。カバレッジ floor 70% lines は CI で別途）
npm run lint           # eslint src tests scripts ui/src --max-warnings 0
npm run build          # build:knowledge + tsc + ui build
npm run pack:verify    # tarball 必須ファイル + knowledge-bundle inline + .md 非リーク検査
npm run boundary-grep  # 30 禁止パターン（秘密情報・bash 非互換構文）
```

CI (`.github/workflows/ci.yml`) は Node 20/22 で typecheck / test+coverage(70%) / lint / build / audit / boundary-grep を回す。

---

## 3. Behaviors To Preserve（絶対に壊してはいけない既存挙動）

以下はテストで pin されている**契約**。リファクタはこれらのテストを変更せずに通すこと。

| # | 挙動 | pin しているテスト |
|---|------|--------------------|
| B1 | `dryRun` / `liveGoArmed` は各ステージ処理で**不変** | `tests/r10-*-untouched.test.ts`（13ファイル） |
| B2 | `dryRun=true` は authority 設定に関わらず publish を**常に**ブロック | `tests/distribution-authority-wiring.test.ts:78-122` |
| B3 | `degradedLyrics=true` の曲は明示設定なしに publish 不可 | `tests/r10-degraded-lyrics-gate.test.ts:32-38` |
| B4 | Suno 歌詞 payload の優先順位 `payloadYaml > lyrics > lyricsText` | `tests/suno-driver-payload-contract.test.ts` |
| B5 | artist voice と情報ブロックを `─────` 区切りで分離する書式 | `tests/command-voice-wrapper-contract.test.ts` |
| B6 | voice contract（禁止句、語尾反復 5 回で deny、呼称ドリフト検出） | `tests/voice-contract-validator.test.ts` ほか voice 系 4 件 |
| B7 | default は spawn 提案を自動 inject して生成へ進む。`OPENCLAW_PRE_GENERATION_APPROVAL=on` の検証運用だけ `spawn_proposal_ready` で停止する | `tests/spawn-proposal-gate.test.ts` |
| B8 | tarball: `dist/index.js` + `dist/suno-production/knowledge-bundle.js` + `ui/dist/index.html` を含み、`src/suno-production/knowledge/*.md` を**含まない** | `tests/distribution-smoke.test.ts` + `scripts/verify-package.mjs:43-52` |
| B9 | ledger は append-only（prompt ledger / suno runs / social publish / audit / callback-actions） | 各 ledger テスト + AGENTS.md Coding rules |
| B10 | Telegram inline button label は plain JA 動詞（artist voice を入れない） | button label 系 contract テスト |
| B11 | 不明 callback は `unknown_callback_blocked` audit + JA reply で防御 | telegramInteractiveCallbackGuard 系テスト |
| B12 | line coverage ≥ 70%（CI ゲート） | `.github/workflows/ci.yml:62` |

**重要な注意 — 契約テストのハードコード文字列を「修正」するな**: テストが `"producer_review_after_take_selected"` 等のリテラルを直書きしているのは**意図的**（定数を import すると src 側の変更にテストが追従して契約が無意味になる）。「定数に置換」してはならない。

---

## 4. Non-Negotiables

1. **R10 安全装置**（dryRun / liveGoArmed / publish gate / `OPENCLAW_SUNO_LIVE` flag の評価経路）に触らない。これらの周辺コードを移動する場合も評価ロジック・順序を 1 行単位で保存する
2. **HTTP レスポンス形状を変えない**。`ui/` と Telegram が依存している。形状の不統一（§6 D-7）は「現状の不統一のまま」維持し、統一は提案に留める
3. **新規 npm 依存を追加しない**。依存変更の唯一の例外は **zod の削除（D-9、所有者承認済み）**
4. **`.local/`、リポジトリ root の workspace 生成物（ARTIST.md / SOUL.md / HEARTBEAT.md / artist/ / songs/ / logs/ / observations/ / runtime/）に触らない**。untracked の ad-hoc スクリプトは **D-14 のアーカイブ移動のみ可**（削除・編集・commit は禁止）
5. **OpenClaw SDK の深い import をしない**（AGENTS.md「Do not」セクション）。SDK 接点は pluginApi.ts 経由のまま
6. **boundary-grep の 30 禁止パターンに抵触するコードを書かない**（秘密情報 echo、`mapfile` 等の bash 構文、絶対 /Users/ パス）
7. コミットメッセージは英語 conventional commits。**Co-Authored-By 署名を入れない**
8. ペルソナ/voice 関連の Markdown（SOUL.md 等のテンプレート、`workspace-template/`）の文面を変えない

---

## 5. Stop And Ask Conditions（即停止して質問せよ）

- 変更しようとした行が **R10 / publish gate / dryRun の評価**に関与していると判明したとき
- テストが変更後に fail し、その**テストの期待値の方が間違っている**ように見えるとき（期待値を書き換えるな。止めて報告）
- 公開 API（HTTP ルート、Telegram コマンド、tool 名）、保存データ形式（song.md frontmatter、*.jsonl スキーマ、runtime/*.json）に**互換性影響**が出る変更が必要になったとき
- 削除候補のコードが「本当に未使用」とコールグラフで証明できないとき
- このファイルに列挙されていないファイルへの変更が必要になったとき（対象・理由・影響を報告して承認を待つ）
- 同一の検証 fail が 2 回続いたとき（場当たり修正を続けず原因を報告）

---

## 6. Debt Map（証拠付き負債一覧）

凡例: **[実装可]** = この指示書の範囲で今実装してよい / **[提案のみ]** = 設計案を文書化して提示、承認まで実装禁止

### D-1. routes/index.ts が 2,393 行の god-file **[実装可・段階的]**
- **根拠**: `src/routes/index.ts` — utility (72-230) / builders (251-1630) / registerRoutes (1632-2229) / UI HTML fallback (2233-2392) が同居。`buildStatusResponse` は 114 行で 20+ の呼び出しを束ねる (992-1105)
- **なぜ負債か**: 1 ルート追加のたびに巨大ファイルを編集。payload 抽出 3 行パターン（payloadRecord → payloadRequestMethod → resolveRuntimeConfig）が 6 ファミリーハンドラに copy-paste
- **影響範囲**: 全 HTTP API。**変更リスク: 中**（機械的な移動なら低い。レスポンス形状を変えたら高い）
- **改善案**: 純粋な**移動のみ**で分割する — `routes/payloadHelpers.ts`（72-230 の utility）、`routes/responseBuilders/*.ts`（builder 群をドメイン別に）、`routes/uiFallback.ts`（2233-2392）。`registerRoutes` 本体と各ハンドラのディスパッチ構造・レスポンス値は不変
- **検証**: `npm test`（route 系テストは in-process gateway harness `tests/harness/inProcessGateway.ts` 経由で全ルートを叩く）+ `npm run build` + UI が `/api/status` を読めること

### D-2. telegram 層の voice 合成・送信パスの重複 **[実装可・限定]**
- **根拠**: `composeVoiceTopOnly` が telegramNotifier.ts / autopilotService.ts(~205) / xObservationCollector.ts(~380) / songSpawnProposer.ts(~800) など 5+ 箇所から呼ばれ、cascadeTrace 整形・buttonVoiceLabels も複数ファイルに分散。notifier はイベント 35+ 種を 1 つの巨大分岐で処理（telegramNotifier.ts、1,421行）
- **なぜ負債か**: メッセージ書式変更のたびに多ファイル編集。新イベント追加が notifier 直編集を強制
- **影響範囲**: 御大の Telegram 体験全部。**変更リスク: 高**（書式は B5/B6/B10 で contract pin）
- **改善案（今回やる範囲）**: 共有整形ヘルパー（divider、cascade trace、URL 整形）を `services/telegramFormatting.ts` に**移動のみ**で抽出。イベント分岐の registry 化は **[提案のみ]**（D-10）
- **検証**: voice/contract 系テスト全 pass + 文字列出力が前後で byte 一致すること（代表イベントで before/after を fixture 比較）

### D-3. callback ライフサイクルの所有権分散 **[提案のみ]**
- **根拠**: TTL 定義は `callbackActionRegistry.ts:109`(カテゴリ 30d/24h)、掃除は `callbackLedgerMaintenance.ts`、再浮上は `callbackPollingWatchdog.ts` の 3 ファイルが同一 `callback-actions.jsonl` を読み書き。登録規約も不統一: `xPublishActionRegistry` は自分で registerCallbackAction を呼ぶが `songPublishActionRegistry` は呼ばず caller（telegramCallbackHandler）任せ
- **なぜ負債か**: 過去に実害が出ている系（stale-queue が proposal callback を誤 expire した事故、v10.36↔v10.53 contract gap）。TTL 意味論が 3 箇所で別々に進化するリスク
- **影響範囲**: ボタン操作全部。**変更リスク: 高**（30 日 TTL、resurface allowlist、watchdog 動作が運用に直結）
- **改善案**: 「callback lifecycle service」1 モジュールに登録/掃除/再浮上の規約を集約する設計文書を書き、承認後に別タスクで実施
- **検証（実施時）**: callback 系テスト + watchdog テスト + 30d TTL regression テスト

### D-4. autopilotService.runCycle が 715 行 **[提案のみ（準備のみ実装可）]**
- **根拠**: `src/services/autopilotService.ts:778-1493`。lane 判定・pulse・producer review 解放・spawn approval・ideaQueue・stale 掃除・各 stage が 1 メソッドに直列
- **なぜ負債か**: 状態機械の 1 tick の意味（「1 tick = 1 stage 前進」「producer_review 中も ideaQueue lane だけ回る」等、過去 plan v10.53-55 の苦労の結晶）が読み取りにくく、テストが粗くなる
- **影響範囲**: 自律ループ全部。**変更リスク: 最高**。ここの順序 1 つで「曲が二重生成」「GO なし発火」事故になる（v10.30 で実例）
- **準備として実装可**: 既存の private 関数（runIdeaQueueLane 等）の**同一ファイル内での並べ替え・コメント追加はしない**。やってよいのは「runCycle を変更せず、その分岐を網羅する characterization test の追加」のみ
- **本体分割**: lane ごとのモジュール分割案を文書化して承認待ち

### D-5. 82 箇所の `.catch(() => undefined)` / fire-and-forget **[実装可・選別制]**
- **根拠**: grep で 82 件（+ `.catch(() => {})` 6 件）。例: `telegramBotWorker.ts:99` startup 通知失敗が無音、`artistVoiceResponder.ts` の readFile 失敗が undefined 化
- **なぜ負債か**: 過去の障害調査（silent swallow audit 2026-05-23, commit 1e2d148）で「sporadic fetch failed が invisible」だった実績。一方で**意図的なものも多い**（任意ファイルの存在チェック、cleanup の unlink 等）
- **影響範囲**: 全域。**変更リスク: 低〜中**（ログ追加のみなら挙動不変。ただし throw に変えたら高）
- **改善案**: 3 分類で triage —
  (a) **副作用系の失敗が無音**（通知送信、ledger 書込、状態書込）→ `console.error("[artist-runtime] <context> failed: ...")` を追加（**throw にはしない**）
  (b) **存在チェック・cleanup** → そのまま。`// optional read` 等の 1 行コメントだけ付けてよい
  (c) 判断つかないもの → リストにして報告
- **検証**: typecheck + 全テスト（ログ追加で fail するテストがあれば、それは console を assert しているテスト — その場合は変更を revert して報告）

### D-6. env var アクセスの二重構造 **[実装可]**
- **根拠**: `runtimeConfig.ts:77-230` に accessor 関数群（~25 flag、`env` 引数を取る統一パターン）が**既にある**一方、16 変数が 9 ファイルに直 `process.env.X` で散在（実測: telegramClient.ts, autopilotTicker.ts, aiProviderClient.ts, newsObservationCollector.ts, sunoDoctor.ts, telegramBotWorker.ts, telegramNotifier.ts, routes/index.ts, songDistributionPoller.ts, promptPackValidator.ts）
- **なぜ負債か**: 新しいシステムを作る話ではなく、**既存の正パターン（runtimeConfig accessor）に未収容の残りがある**だけ。テストでの env mock が散らばる
- **影響範囲**: 設定読み取り。**変更リスク: 低**（accessor 化は機械的）
- **改善案**: 散在 16 変数を runtimeConfig.ts（または `services/envAccess.ts` 新設、どちらでも可・新設なら runtimeConfig から re-export しない）に accessor 追加して呼び替え。デフォルト値・parse 挙動（`Number.parseInt`、`?.trim().toLowerCase()` 等）は**現状を byte 単位で保存**
- **検証**: 各変数を使うテスト（telegram-client-retry, autopilot-ticker 等）+ 全テスト

### D-7. HTTP レスポンス形状の不統一 **[提案のみ — ただし統一は所有者の確定方針]**
- **根拠**: 成功が `{dispatched}` / `{notified}` / `{replayed}` / 裸オブジェクト、エラーが `{error,statusCode}` / `{error,message,statusCode}` / `{errors:[]}` と混在（routes/index.ts 全域）
- **なぜ負債か**: クライアント（ui/）のエラー処理が場当たりになる
- **変更リスク: 高**（ui/ と外部利用者を同時に壊す）
- **所有者決定（2026-06-11）**: 統一は**やる**方針。ただし本リファクタ内では実装せず、Phase 7 で「envelope 型の設計 + endpoint 別マッピング表 + ui/ 同期変更計画 + 移行手順」を含む具体的な提案書を書く。承認後に別タスクで実施

### D-8. 型の重複と types.ts の肥大 **[実装可・最小]**
- **根拠**: `interface BriefSlots` が `songPitchContext.ts:163` と `planningSkeletonVoiceComposer.ts:17` に重複定義（実測確認済）。`src/types.ts` は 1,202 行・154 export
- **改善案**: BriefSlots を 1 箇所（両者から import 可能な位置。types.ts でよい）に統合。**2 つの定義が field 単位で完全一致する場合のみ**実施。不一致なら質問に回す。types.ts の分割は **[提案のみ]**（import 網が広すぎるため）
- **検証**: typecheck + 関連テスト

### D-9. zod が dependency なのに 0 import **[実装可 — 削除で確定]**
- **根拠**: package.json:80 `"zod": "^4.3.6"`、src/ tests/ scripts/ ui/src/ openclaw.plugin.json **全てで import/参照 0 件**（実測）。config 検証は `src/config/schema.ts` 538 行の手書き
- **なぜ負債か**: 使わない依存は配布物の install 面積と監査面積を増やす
- **所有者決定（2026-06-11）**: **zod を dependencies から削除する**。schema.ts の zod 移行は**明示的に却下** — schema のエラー文言はテストで pin されており（例: `tests/threat-model-validation.test.ts:103`、`tests/config-migrations.test.ts:42`）、移行は契約テストを壊すだけで価値がない。手書き検証は十分テストされた現行資産として維持
- **手順**: package.json から削除 → `npm install` で lockfile 再生成 → 参照ゼロを grep で最終確認
- **検証**: typecheck + 全テスト + `npm run build` + `npm run pack:verify` + `npm audit --audit-level=moderate --omit=dev`（CI と同条件）

### D-10. telegramNotifier のイベント分岐 35+ **[提案のみ]**
- **根拠**: telegramNotifier.ts の notify() が event.type で 35+ 分岐（D-2 と同根）
- **改善案**: event-type → formatter の registry 化設計を文書化。書式 byte 一致の検証戦略（fixture 比較）込みで提案

### D-11. docs/API_ROUTES.md と実装のドリフト **[実装可]**
- **根拠**: 実装済み・未文書: `/api/autopilot/safe-tick-trigger`, `/api/callback-actions`, `/api/config/overrides`, `/api/proposals`, `/api/songbook/lookup`, `/api/songs/:id/events`, `/api/songs/:id/notify-review`(debug-gated), `/api/telegram/callback-dispatch`(debug-gated)
- **改善案**: API_ROUTES.md に追記。debug-gated（`OPENCLAW_DEBUG_*` / token 必須）のものは「internal / debug」明記。**コードは変更しない**（docs only）
- **検証**: 反映不要（docs only）。ただし記載内容を routes/index.ts の該当行と突き合わせ

### D-12. .gitignore の小穴 **[実装可]**
- **根拠**: `coverage/` が git 未追跡だが .gitignore 未記載（再生成時の混入リスク）
- **改善案**: `.gitignore` に `coverage/` を 1 行追加
- **検証**: `git status` で coverage/ が無視されること

### D-13. テストヘルパーの copy-paste **[実装可・低優先]**
- **根拠**: `makeWorkspace()` / `seedWorkspace()` 相当が spawn-proposal-gate / r10-commission / command-voice-wrapper / distribution-authority 等に重複。共有 `tests/helpers/` なし
- **改善案**: `tests/helpers/workspace.ts` を新設し、**新規テストから使い始める**。既存テストの一括書き換えは**しない**（テストは契約の pin。広く触ると安全網自体を毀損する）。今回のリファクタで追加するテスト（D-4 characterization、D-5 検証等）でのみ使用
- **検証**: 追加テストが green

### D-14. scripts/ の ad-hoc スクリプト 41 個（untracked） **[実装可 — アーカイブ移動で確定]**
- **根拠**: recover-*/test-*/inspect-*/inject-*/rewind-*.mjs に本番 song ID・Suno URL・絶対パスがハードコード（例: `recover-spawn-f3820d.mjs:18-21`）。git 未追跡。boundary-grep は scripts/ を走査対象にしている（`scripts/boundary-grep.mjs:33`）ため、これらを commit する選択肢は構造的に存在しない（絶対 /Users/ パス検査で fail する）
- **所有者決定（2026-06-11）**: **`.local/incident-scripts/` へ移動してアーカイブ**（`.local/` は gitignored 済み。ローカルに保全され、リポジトリと配布物からは消える）
- **手順と制約**:
  - 対象は **git 未追跡** の ad-hoc 系のみ（recover-* / test-* / inspect-* / inject-* / rewind-* / watch-* / manual-* / delete-tweet / verify-create-card-extraction / import-take / openclaw-suno-clone-chrome.sh）。`git ls-files --error-unmatch <path>` が fail するものだけ動かす
  - package.json の scripts から参照されるもの・運用 runbook（openclaw-local* / supervisor / suno-doctor / cleanup-runtime 等の **tracked** ファイル）は**絶対に動かさない**
  - **移動のみ。削除・編集・commit 禁止**。移動したファイル一覧を報告書に記録
- **検証**: `git status --short` で scripts/ 配下の untracked が消えたこと + `npm test`（scripts 参照のテストが fail しないこと）+ `npm run boundary-grep`

---

## 7. Baseline Commands

実装開始前に必ず以下を実行し、結果を記録せよ:

```bash
git status --short           # 既存 dirty: scripts/openclaw-local-env.sh (M) は触るな。untracked の ad-hoc scripts は D-14（Phase 2）でのみ移動可
npm run typecheck
npm test                     # 全件 green が前提。fail があれば停止して報告
npm run lint
npm run pack:verify
npm run boundary-grep
```

> 注意: このリポジトリには**既存の未コミット変更**（`scripts/openclaw-local-env.sh` 修正 + untracked スクリプト群）がある。これらをあなたのコミットに**混ぜるな**。`git add` は常に明示パス指定。

---

## 8. Implementation Phases

各フェーズは独立コミット（複数可）。フェーズ末に検証し、green を確認してから次へ。

### Phase 0 — 現状確認（変更なし）
1. §7 の baseline を実行・記録
2. dirty file 一覧を記録し、自分のスコープ外と宣言

### Phase 1 — 安全網の追加（テストのみ追加、src 変更なし）
1. **D-4 準備**: `autopilotService.runCycle` の characterization tests を追加 — 最低限: (a) producer_review 中の tick が release だけして completed で終わる、(b) ideaQueue lane が producer_review 中も回る、(c) paused(operator) は skip、(d) hardStopReason は failed_closed。既存テスト（idea-queue-lane-separation 等）と重複しない差分のみ
2. D-5 で触る予定の通知系 silent-catch 経路に、失敗がログに出ることを assert する**にはまだしない**（Phase 4 で同時に）
3. 検証: `npm test` 全 green

### Phase 2 — 明白に安全な整理
1. D-12: `.gitignore` に `coverage/` 追加
2. D-8: BriefSlots 統合（完全一致の場合のみ）
3. D-11: docs/API_ROUTES.md 追記（docs only）
4. D-14: untracked ad-hoc スクリプトを `.local/incident-scripts/` へ移動（移動一覧を記録。tracked ファイルは動かさない）
5. D-9: zod を dependencies から削除し lockfile 再生成
6. 検証: typecheck + 全テスト + lint + build + pack:verify + boundary-grep + `npm audit --audit-level=moderate --omit=dev`

### Phase 3 — env accessor 収容（D-6）
1. 散在 16 変数を accessor 化。1 コミット = 1〜3 ファイルの小さい単位
2. parse 挙動・デフォルト値は現状維持（diff レビューで 1 変数ずつ突き合わせ）
3. 検証: 該当ユニットテスト + 全テスト

### Phase 4 — silent catch triage（D-5）
1. 82 件を (a)副作用系 / (b)意図的 / (c)不明 に分類した表を作る（file:line 付き）
2. (a) のみ console.error 追加。throw への変更禁止
3. (c) は実装せず報告書に列挙
4. 検証: 全テスト（console を assert するテストとの衝突に注意）

### Phase 5 — routes/index.ts の移動分割（D-1）
1. 順序: payloadHelpers → uiFallback → responseBuilders の 3 コミット以上に分ける
2. **純粋移動のみ**。関数本体の 1 文字も変えない（import 文以外）
3. 検証: 各コミットごとに typecheck + route 系テスト、最後に全テスト + build + pack:verify

### Phase 6 — telegram 整形ヘルパー抽出（D-2 の限定範囲）
1. divider / cascade trace / URL 整形の共有ヘルパーを移動抽出
2. 代表イベント 3 種（song_take_completed / song_spawn_proposed / prompt_pack_ready）の出力文字列を before/after で fixture 比較するテストを足してから移す
3. 検証: voice/contract 系テスト + fixture 比較 green

### Phase 7 — 提案書の作成（実装禁止）
D-3（callback lifecycle 統合）、D-4 本体（runCycle 分割）、D-7（レスポンス形状統一 — 所有者は統一実施の方針。envelope 設計 + ui/ 同期計画 + 移行手順まで具体化すること）、D-10（notifier registry 化）について、それぞれ 1 ページの設計提案（現状 → 案 → 影響 → 検証計画）を `docs/refactor-proposals/` に書く。**コード変更はしない**

---

## 9. Verification Requirements

- 各フェーズ末: `npm run typecheck && npm test && npm run lint`
- Phase 5 以降は加えて: `npm run build && npm run pack:verify && npm run boundary-grep`
- 移動リファクタ（Phase 5/6）は「出力 byte 一致」を fixture またはテストで示す
- カバレッジを下げない（CI floor 70%。テスト追加フェーズがあるので上がるはず）
- 最終確認: `npm run prepublish:local` 相当（typecheck + test + build + pack:verify + pack:dry-run）

---

## 10. Reporting Format

各フェーズ完了時に以下を報告:

```
Phase N: <名前>
Task Intent: <このフェーズの1文>
変更ファイル: <一覧>
反映操作: <コミット SHA 一覧>
確認コマンド: <実行したコマンド>
確認結果: <pass/fail と件数。fail 時は全文>
未実施 / スコープ外として残したもの: <あれば>
質問: <あれば（§5 該当時は即時報告）>
```

最終報告には: 全コミット一覧、baseline との差分サマリ、(c)分類リスト（D-5）、Phase 7 の提案書パス一覧、を含めること。

---

## 11. Out-of-scope Items（このリファクタでやらないこと）

1. **挙動変更全般** — 特に「採用/破棄ボタン押下で即 tick を蹴る」改善（producer 決定後に次提案まで最長 ~2 interval かかる既知の体験課題）は**機能変更**であり別プラン。本指示書のリファクタに混ぜない
2. Suno driver（sunoPlaywrightDriver.ts）の書き換え — ブラウザ自動化はセレクタ依存で実機検証なしに触れない
3. ui/ の再設計・デザイン変更
4. 依存パッケージの追加・更新（例外: D-9 の zod **削除**のみ承認済み）
5. `.local/` 配下、repo root の workspace 生成物、logs/ の**削除**（untracked ad-hoc scripts は D-14 のアーカイブ**移動**のみ可、削除は不可）
6. bundled OpenClaw（`.local/openclaw/.../dist/*.js`）への patch
7. config schema の構造変更（keys 追加/削除/rename）
8. テスト期待値の書き換え（契約 pin の変更は禁止）
9. CHANGELOG / バージョン操作 / publish 作業

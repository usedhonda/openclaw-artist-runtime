# LOOP: 配布プラグイン readiness を緑に (ClosedLoop, 2026-06-26 改訂)

GOAL: artist-runtime を、第三者 operator が御大のマシン・アカウント・手助けなしに、install → アーティスト人格設定 → 曲作り (観察→提案→GO→生成→採用) まで Telegram と docs だけで完結できる配布プラグインにする。done-ledger: .loop/distribution-readiness.done.json。

DONE: 全 SUCCESS CRITERIA の done-ledger status が "pass" (gate 出力 verified_by 付き)。2 連続クリーン iteration で FINAL。

SUCCESS CRITERIA (done-ledger で管理、全 pass で完了):
1. 御大固有漏洩 0 (範囲拡大): grep "used::honda" / "/Users/usedhonda" / 個人アカウント (@used00honda 等) を src/ ui/ workspace-template/ scripts(files内)/ dist(bundle)/ docs(files内)/ NOTICE.md/ config = 配布される全面で 0。knowledge の CC BY-NC 帰属は URL/相対パス化 (絶対パスは不可)。
2. operator docs 整合: README/OPERATOR_QUICKSTART/OPERATOR_RUNBOOK/TROUBLESHOOTING が参照する scripts/files/docs が全部 package.json "files" 内、or "Contributors/repo-local" セクションへ明示隔離。
3. gateway 起動の配布正規ルート (致命): tarball install 後に operator が gateway を起動できる正規手順が docs にあり、実際に runnable (repo-local scripts/openclaw-local-gateway でなく、OpenClaw 本体の plugin 起動 or files 同梱 script)。
4. persona onboarding 機能: 新規 operator が /setup を発見でき、workspace-template の placeholder が「例」と明示され、setup gate (needsSetup) が次の一手 (/setup) を言い、IDENTITY/ARTIST/SOUL の役割と「どれを編集するか」が明確。
5. 曲作り到達: Telegram bot 接続 (BotFather/token/owner id) + Suno login lane + mock→playwright→live 順序 + playwright binary install が docs にあり、第三者が曲生成まで辿り着ける。
6. gate green: typecheck 0 + full test green + build:runtime + pack:verify pass。
7. tarball 健全: operator 必須物 (gateway 起動・suno login・doctor・必要 docs) が揃い、御大固有が入らない (pack:verify + files 突合)。
8. OS/Node 前提明記: README に対象 OS (macOS) + Node>=20 + 前提 (playwright binary 等) が operator docs 冒頭に。

VERIFY — the gate (最速→最遅、最初の赤で停止、self-grade しない):
- npm run typecheck
- grep 漏洩 (criterion 1 の全面: NOTICE/docs(files)/dist bundle/config も含む)  → 0 行
- operator docs ↔ package.json "files" 突合 (docs 参照の scripts/files/docs が files 内 or Contributors 隔離)
- npm test
- npm run build:runtime && npm run pack:verify
- sub-agent spot-check: criterion 3/4/5 (gateway 起動・persona onboarding・曲作り到達) は「配布 operator が本当に困らないか」を fresh-eyes sub-agent に検証させてから pass。
PASS = 全 criterion の done-ledger status が "pass" (verified_by 付き)。

DONE LEDGER: .loop/distribution-readiness.done.json = [{criterion, status:"pass|fail", verified_by:"<gate output / command>"}]
- status は実際の verified_by (gate 出力) なしに "pass" にしない。全 status "pass" で完了。

STATE FILE: .loop/distribution-readiness-state.md
- 開始前に読む。resume であって restart でない。各 iteration: やったこと / pass-fail / 次の一手。

LEARNINGS FILE: .loop/learnings.md (毎 run 最初、contract より前に読む)
- 配布で再発する未熟パターンに durable rule を1つ。category 予防を優先 (配布汎用性チェックを lint/CI 化)。

BUDGET (state に書く): iteration cap 12 / no-progress streak 2。

EACH ITERATION:
1. RE-READ 契約 (GOAL + SUCCESS CRITERIA + RULES) + state + learnings + done-ledger、その後 VERIFY を走らせ現在の fail criterion を見る。
2. PLAN 最もインパクトの大きい未熟部分を 1つ (done-ledger の最弱 criterion。致命の criterion 3=gateway 起動を優先)。
3. EXECUTE その1つを緑にする最小変更。
4. VERIFY ゲートを走らせ、done-ledger の該当 criterion を verified_by 付きで更新、state に記録。
5. 独立完了チェック (maker != checker): docs 親切さ・placeholder・tarball 健全・gateway 起動・persona onboarding 等の「読み手目線」criterion は、構造判定 (grep/突合) のうえ sub-agent に「配布 operator が本当に困らないか」を spot-check させてから pass にする。
6. DECIDE: done-ledger 全 status "pass" か?
   - Yes → "FINAL" を出して停止。
   - No  → "ITERATING"、最弱 criterion を先に直す。
- No-progress circuit breaker: 各 iteration の {tool 名 + args} を hash、同一 action 3回 or プラン 85% 類似で詰まり → stop_reason=no-progress。

STOP WHEN (各停止に stop_reason ラベル):
- success        : 2 連続クリーン iteration (全 criterion pass 維持)
- no-progress    : 2 iteration 新規ゼロ、or 繰り返し action
- oscillation    : 同じ problem-fix を 3 回
- failure        : 1 criterion が 3 回試行で直らない
- budget         : iteration cap 12 到達
- scope-boundary : 御大固有を配布物に焼き込みそう / R10・identity 汎用化・配布汎用性の不変に触れそう / cross-platform (macOS 外) に出そう / 新機能 (新 API/UI/CLI) で逃げそう
ON STOP: 緑にした criterion・残る fail・accept 率をまとめる。

RULES:
- gate が実際に green になるまで完了と言わない。self-grade しない。
- maker != checker: docs 親切さ・placeholder・onboarding 等のリスク判定は sub-agent / fresh eyes で再検証。
- surgical changes only: diff の各行が GOAL に trace できること。
- 配布汎用性 (P0 不変): 御大固有 (人格/観/ネタ/ID/絶対パス) を配布物 (src/workspace-template/config/scripts/dist/docs/git tracked) に焼き込まない。御大固有は .local (gitignored) のみ。他 operator が別性格でも動くこと。
- R10 三重防護・identity 汎用化 untouched。public plugin label は plain JA。
- North Star: 複雑にするな・御大の手数を増やすな・新機能で逃げない。docs 整合・隔離・既存ルートへの書き換えで解けるなら、新 command/画面/CLI を作らない。
- scope: macOS のみ (cross-platform は御大 scope 外、手を出さない)。配信 ID 汎用化も別 scope。
- search before assuming: grep してから「無い」と言う。
- no fake done: docs を消して整合させる / placeholder・stub を完了扱い / test を弱めて gate を緑にする、禁止。
- report compactly: PASS 1行、FAIL は {期待 / 実際 / 直し方}。
- re-verify the diff, not the world: iteration 1 全部、以降は変えた criterion だけ再チェック。
- 同じ criterion が2回失敗したら最小 fragment に再 scope (retry→decompose→escalate)。
- loop 中に質問しない。妥当な仮定を state に記録して継続。

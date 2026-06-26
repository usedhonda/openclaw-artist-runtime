# Loop state — 配布プラグイン readiness を緑に (ClosedLoop)

## 設計改訂 (2026-06-26)
4-agent operator-journey 踏査で 50+ 問題が判明 → contract を criteria 6→8 に拡張 (gateway 起動・persona onboarding・曲作り到達 を新規追加、criterion 1 の grep 範囲を dist/docs/NOTICE/config に拡大)、cap 8→12。
iteration カウンタは re-baseline (設計が変わったので resume でなく仕切り直し)。

## Budget
iteration cap 12 / no-progress 2 — 消費: 3

## iter3 (criterion 2 + 7 = docs<->files 整合 / tarball 健全)
- 道具: scratchpad docs-xref.mjs (shipped doc の markdown link + inline `docs/`/`scripts/` ref を抽出、npm pack file list と突合)。root-relative vs doc-relative の解決 bug を1回直した。
- 発見: PACKAGE_CONTENTS.md が 4 operator docs (SUNO_BROWSER_DRIVER/RUNTIME_CLEANUP/INCIDENT_RESPONSE/X_LIVE_PUBLISH_DESIGN) を「ship する」と宣言済みなのに package.json files に無い = oversight。pre-existing M package.json は前 session が 13 operator scripts を files 追加した未 commit 分 (同一論理変更なので一緒に commit)。
- FIX: (a) package.json files に 4 docs + 5 scripts (cleanup-runtime/runtime-retention-enforce/suno-profile-diagnose/import-obsidian x2、全 leak clean・obsidian は --source generic) 追加。(b) RUNBOOK/CONNECTOR_AUTH/TROUBLESHOOTING に "Repo-local vs installed-plugin commands" mapping note を1つずつ (openclaw-local-* -> host openclaw gateway run の対応)。(c) QUICKSTART §1 step3 の env.sh を operator 直 export 化。(d) PACKAGE_CONTENTS の "scripts stay in repo" blanket 矛盾 + ui/index.html 誤記 + stale file count を是正、Operator scripts ship section 追加。
- VERIFY: docs-xref 残 hit は全て acceptable (README contributor / SOURCE_NOTES documented-repo-only / CHANGELOG historical)。pack:verify pass。leak-scan 236-file 0 hit。fresh-operator sub-agent VERDICT PASS (2 矛盾 flag → 即 fix)。
- commits: a269038 (files), 7f0bbc8 (labeling+PACKAGE_CONTENTS), fd7d574 (residual)。

## iter4 (criterion 8 = OS/Node prereq)
- README に '## Requirements' section 追加 (macOS / Node>=20 / host openclaw CLI / playwright chromium / bird CLI / IG-TikTok optional)、QUICKSTART top に pointer。commit f7a3a98。

## Budget update
消費: 4

## iter5 (criterion 4 + 5 = persona onboarding / song-making) — 2 sub-agent 並列調査 → 修正
- 調査発見: (4) /setup が QUICKSTART から不可視・workspace-template/ARTIST.md が御大の美学 (male vocal/78-96 BPM/夜の街) を「例」明示なく default 化・IDENTITY/INNER/PRODUCER は prompt に注入されるが /setup 未管理で TBD 残留・config displayName が override。(5) QUICKSTART に Telegram 接続が皆無 (control surface なのに)・曲生成の具体 trigger 無し (mock walkthrough は dead-end)。
- FIX: QUICKSTART に '## First-run onboarding' 8 step sequence (prereq→gateway→persona /setup→Telegram connect→mock verify→Suno login→mock→live→曲 trigger、各 detail section へ link)。workspace-template/ARTIST.md に EXAMPLE banner + gender male→TBD。RUNBOOK に 'Which identity files matter' note。CONNECTOR_AUTH telegram block に telegram.enabled=true step。step7 に Producer Console Settings 明示。
- VERIFY: gate 全 pass (typecheck rc0 / Test 1240 pass / build / pack:verify)。fresh-operator sub-agent CRITERION_4 PASS + CRITERION_5 PASS。残 confusion 4 件は minor polish (package root 位置 / spawn-commission flag が RUNBOOK 奥 / owner id 取得法) = out-of-scope candidate。
- commit 61805d0。

## FINAL (2026-06-26)
全 8 criterion done-ledger status = pass。2nd consecutive clean iteration の re-verify: leak-scan 0 全 category / xref 残 hit は acceptable のみ (contributor-labeled openclaw-local-* / README contributor / SOURCE_NOTES repo-only / CHANGELOG historical) / gate 1240 pass。**stop_reason=success**。
- Budget: iteration 5 消費 / cap 12。no-progress streak 0。
- commits: 65ba09c (gateway docs) / 513a76a (de-identify) / a269038 (files expand) / 7f0bbc8 (repo-local label + PACKAGE_CONTENTS) / fd7d574 (residual) / f7a3a98 (prereq) / 61805d0 (onboarding)。
- 緑にした criterion: 8/8 (1 漏洩 / 2 docs整合 / 3 gateway起動[致命・新機能不要と確定] / 4 persona onboarding / 5 song-making / 6 gate / 7 tarball / 8 prereq)。
- 残 fail: 0。
- out-of-scope candidates (御大 judgment / 別 plan): (a) persona/abs-path の durable leak lint (boundary-grep 拡張)。(b) Producer Console setup-gate raw code → guidance 化 (code 変更)。(c) NOTICE の "usedhonda private non-commercial" framing と配布 licensing の整合。(d) RUNBOOK の Plan-vX changelog 体 → operator runbook 整理。(e) minor onboarding polish 4 件。

## iter2 (criterion 1 = maintainer leakage)
- 既存 boundary-grep.mjs は secret 系のみ (src/tests/scripts/.github)、persona/abs-path leak は未 gate。docs/NOTICE/dist 未scan。→ scratchpad leak-scan.mjs で正確に (npm pack file list + src/ui src) scan。
- 真の leak (yzhonda=publisher は除外): OPERATOR_RUNBOOK.md 5箇所 (used::honda x4 + @used00honda x1 + 御大 iTunes id 1889924232 + firefox profile rlff0kyr.artist-x) / NOTICE.md abs path / dist 孤児 README.md。御大 IDs は src/dist code には無し (doc のみ)。
- FIX: RUNBOOK de-identify (placeholder 化)、NOTICE path 相対化、dist README 削除 (npm が README を強制同梱する挙動が原因、build は再生成しない)。
- VERIFY: leak-scan 再走で 0 hits 全 category。
- 残課題候補 (非scope, 後回し): (a) RUNBOOK は Plan-vX 内部 changelog 体で operator runbook として冗長 → criterion 2/7。(b) NOTICE の "usedhonda private non-commercial project" framing は配布 plugin と licensing 整合が要検討 (御大 judgment、loop は触らない)。(c) persona/abs-path leak の durable lint (boundary-grep 拡張) は false-positive 設計が要るので mechanical criteria 後に検討。

## Iteration log
- **iter1 (criterion 3 = gateway-start, 致命)**: keystone scope decision = NOT scope-boundary. 根拠: host `openclaw gateway run --allow-unconfigured --bind loopback --auth none --port 43134` が既存 (repo-local wrapper `scripts/openclaw-local-gateway` はそれを `.local/openclaw` sandbox 化してるだけ、env.sh L98 で確認)。配布 operator route = `openclaw plugins install` → host `openclaw gateway run` → Producer Console (plugin `activation.onStartup`)。新機能不要。
  - FIX: OPERATOR_QUICKSTART.md 2箇所 (5-min step 1 + §2) を host gateway-run に書換、repo-local script は contributor blockquote へ隔離、§2 の useful-checks を非配布 http-smoke から host curl に置換。
  - VERIFY: grep で gateway-start = host command 確認、repo-local 残存は contributor-labeled のみ (L109 は §1 connector-cred = criterion 5 scope, 別途)。fresh-operator sub-agent (tarball-only persona) VERDICT PASS / 0 blockers。
  - done-ledger: criterion 3 → pass。

## 今回の踏査で判明した各 criterion の現状 (起動後に VERIFY し直す)
- **1 漏洩 (fail)**: NOTICE.md 絶対パス / OPERATOR_RUNBOOK.md `used::honda` x4 (L214/421/606/796) / dist knowledge bundle のソース帰属に絶対パス。src だけ見てたスコープ漏れ。
- **2 docs 整合 (fail)**: QUICKSTART が `scripts/openclaw-local-gateway` + `openclaw-local-env.sh` (repo-local) を参照、`SUNO_BROWSER_DRIVER.md`/`RUNTIME_CLEANUP.md`/`INCIDENT_RESPONSE.md` が files 外。
- **3 gateway 起動 (致命・fail)**: 配布 operator が起動する正規ルートが docs に無い。OpenClaw 本体の plugin 起動メカ調査が前提 (機能追加が要ると判明したら scope-boundary stop)。
- **4 persona onboarding (fail)**: /setup 不可視、placeholder が御大趣味で要件に見える、IDENTITY.md は runtime 未使用、setup gate がガイダンスを出さない。
- **5 曲作り到達 (fail)**: Telegram (BotFather/token/owner id)・Suno login・mock→live 順序が quickstart に無い。
- **6 gate green (pass)**: full test 1240。毎 iteration 再検証。
- **7 tarball 健全 (fail)**: operator 必須 scripts/docs 欠落。
- **8 OS/Node (fail)**: Node>=20 が operator docs に無い。

## Next step (起動後の優先順)
1. **criterion 3 (gateway 起動) を最優先で調査**: OpenClaw 本体の配布 plugin 起動メカが「機能追加なしに docs 案内可能」か確定。可能 → docs 化。不可 (新 command/CLI 要) → scope-boundary stop で御大に報告。
2. **criterion 1 (漏洩剥がし)** は機械的に確実: NOTICE/RUNBOOK/bundle の御大固有を generic 化 or .local 隔離。
3. **criterion 2/7 (docs↔files 整合)**: repo-local 開発用を "Contributors" に隔離 + operator 必須 scripts を files 同梱 (機能追加ゼロ)。
4. **criterion 4/5/8** は docs 追記 (sub-agent spot-check 必須、placeholder「例」明示・/setup 導線・Telegram/Suno 接続手順・Node 前提)。

## 仮定 (loop 中は質問しない、妥当な仮定を記録して継続)
- 機能追加に逃げない (North Star)。gateway 起動が新 command/CLI を要すると判明したら scope-boundary stop し御大へ報告。
- 御大固有は .local のみ、配布物は generic。他 operator が別 persona でも動くこと。
- cross-platform (macOS 外) には出ない。

# V10.5 Phase D — Suno Live Run Runbook (v10.4 Phase 6 隔離継続 + v10.5 driver fix 反映)

Plan v10.5 Phase D の operator 手順書。**実機 LIVE=on 操作は本 Plan の completion 条件外**、御大の明示 GO 後に CC が手動で orchestrate する。Plan v10.4 Phase 6 の隔離規律を継承し、v10.5 で追加された driver 構造原因 4 個 fix と CDP doctor を活用する。

## 0. 前提条件

このランブックを実行する前に、以下が全て完了していること:

### v10.4 (基盤)
- ✅ Phase 1 (tarball narrowing): commit済み、tarball ≤220,000、pack/import smoke pass
- ✅ Phase 2 (knowledge clean room reimpl): commit済み、knowledge files MIT 統一、tarball R6 内
- ✅ Phase 3 (payload/driver contract): commit済み、`lyrics` 優先 / `lyricsText` fallback、v9.27 hotfix 取り込み
- ✅ Phase 4a/4b/4c (lyrics V5.5 + builders + orchestration): 3 commit、targeted + full test pass
- ✅ Phase 5 (Telegram 観察出典 + privacy guard 三重): commit済み

### v10.5 (driver fix + 配布対応)
- ✅ Phase A (b38c51b): driver deterministic fill (`:visible` await / `bringToFront()` / React event dispatch / LYRICS extraction)
- ✅ Phase B (29d5c93): CDP doctor + `127.0.0.1` bind 強制 + 配布 README + no-submit sentinel test
- ✅ Phase C (c5a844b): distribution smoke + selector regression + fixture HTML

### 操作前
- ✅ 御大の明示 GO (例: 「v10.5 Phase D 流していい」「Suno で実機やって」)
- ✅ tarball ≤281,914 bytes (230.1 kB / R6 余裕 51.8 kB / 177 files)
- ✅ R10 三重防護: `OPENCLAW_SUNO_LIVE=off` / `liveGoArmed=false` / `driver=mock` / `paused=true`

GO 待ちの間、本ランブックを御大に提示して内容確認を取る。

## 1. Preflight (artifacts deterministic 検証 + v10.5 doctor)

実機 create に進む前に、artifact 段階で以下を全部 pass させる:

```bash
cd /Users/usedhonda/projects/openclaw/artist-runtime

# Phase 1-5 + v10.5 A/B/C の test 全 pass (216 files / 751 tests 想定)
npm test -- --run

# tarball サイズ R6 内 (v10.5 完走時点 230.1 kB / 177 files)
npm pack --dry-run | grep "package size"
# 期待: ≤281,914 bytes

# R10 三重防護確認
grep -E "OPENCLAW_SUNO_LIVE|liveGoArmed|driver:.*mock" .local/social-credentials.env src/*.ts 2>/dev/null
# 期待: LIVE=off / liveGoArmed=false / driver=mock
```

### v10.5 追加: CDP doctor 通過必須

Section 2 (Live Run) に進む前に、Chrome を CDP port 9222 で起動した上で **doctor を必ず通す** (v10.5 Phase B):

```bash
# 1. Chrome を CDP attach 起動 (127.0.0.1:9222 強制)
bash scripts/start-chrome-cdp.sh

# 2. doctor で機械判定: CDP reachable / Suno tab / create form writable
bash scripts/suno-doctor.sh
# 期待: exit 0、stdout に "doctor passed" 等
# 失敗時: exit 1 + 原因 stdout、live run 中止
```

doctor は **submit / create を絶対押さない** (no-submit sentinel test で固定済)。doctor 通過しない限り Section 2 へ進まない。

artifacts + doctor 全 pass すれば、(後述の制約付き) live run へ進める。

### ⚠️ 重要: artifacts では duration > 180 sec を保証不能

artifacts (lyrics 9 section / Style ≤400 / Exclude ≤200 / YAML ≤4000) は **deterministic 検証可能** だが、Suno の **実生成挙動 (duration / quality)** は検証不能。Suno V5.5 の生成エンジンに依存する。

つまり:
- ✅ 確実に検証できる: lyrics 構造、prompt pack 文字数、payload contract、Telegram formatter
- ❌ 検証できない: 生成された曲が 27 秒で終わるかどうか、watapp loop になるかどうか

**この前提を御大と共有してから live run 着手すること。**

## 2. Live Run 操作 (CC 手動)

### 2-1. Env 切替 (LIVE=on)

```bash
# .local/social-credentials.env を一時的に編集
# 編集前にバックアップ
cp .local/social-credentials.env .local/social-credentials.env.bak

# LIVE=on / DRYRUN_OVERRIDE 解除
sed -i '' 's/^OPENCLAW_SUNO_LIVE=.*/OPENCLAW_SUNO_LIVE=on/' .local/social-credentials.env
sed -i '' 's/^OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE=.*/OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE=/' .local/social-credentials.env

# 確認
grep -E "OPENCLAW_SUNO_LIVE|DRYRUN" .local/social-credentials.env
```

### 2-2. Operator Chrome CDP attach 起動 (Section 1 doctor 既に通過済前提)

Section 1 で `start-chrome-cdp.sh` + `suno-doctor.sh` を既に通過済の場合は、本ステップは確認のみ:

```bash
# CDP port 9222 が 127.0.0.1 bind で生きているか
curl -sS http://127.0.0.1:9222/json/version | jq -r '.Browser // "unreachable"'
# 期待: Chrome/<version>

# Suno がログイン済みか視認 (Chrome window で https://suno.com/create を開いた状態)
```

CDP が落ちていたら Section 1 から再実行。doctor 未通過のまま 2-3 へ進むのは禁止。

### 2-3. Autopilot resume + run-cycle

```bash
# autopilot state を resume (paused フラグ解除)
node -e '
  const fs = require("fs");
  const path = ".local/openclaw/workspace/runtime/autopilot-state.json";
  const state = JSON.parse(fs.readFileSync(path, "utf-8"));
  state.paused = false;
  state.blockedReason = null;
  state.retryCount = 0;
  fs.writeFileSync(path, JSON.stringify(state, null, 2));
  console.log("autopilot resumed");
'

# run-cycle 1 回
curl -X POST http://localhost:3000/api/run-cycle
```

## 3. 成功条件 (確認項目)

run-cycle 1 周完走後、以下を全て確認:

| # | 確認項目 | 期待 |
|---|---------|------|
| 1 | `.local/openclaw/workspace/observations/<jst-date>.md` | cycle 冒頭で更新 |
| 2 | `songs/song-NNN/brief.md` | `## Observation source` 構造化 (author/url/quote/motivation) |
| 3 | `songs/song-NNN/lyrics.v1.md` (人間用、漢字あり) | 9 セクション + frontmatter |
| 4 | `songs/song-NNN/lyrics-suno.v1.md` (Suno 投入用、ひらがな + メタタグ) | 9 セクション + annotation tag |
| 5 | `songs/song-NNN/suno/style.md` | core ≤120 字、total ≤400 字 (V5.5 current canon) |
| 6 | `songs/song-NNN/suno/exclude.md` | ≤200 字、2-5 項目、copyright source-name なし |
| 7 | `songs/song-NNN/suno/yaml-suno.md` | ≤4000 字、META + vocals + production_notes 完備 |
| 8 | `songs/song-NNN/suno/payload.json` (v10.5 contract) | `lyrics` ← **LYRICS body のみ** (`extractLyricsBody` 通過済、UI textarea 投入用)、`payloadYaml` ← YAML 全体 (ledger / 永続化用)、`lyricsText` ← lyrics-suno (driver fallback) |
| 9 | Suno で 2 takes 生成 | **duration > 180 sec (3 分以上)** |
| 10 | Telegram message | 5 ブロック (🌐観察元 / 💬抜粋 / 🎯動機 / 🎵タイトル / 🔗 1.URL / 2.URL) + privacy guard 三重 (URL allowlist / quote ≤140 / handle redaction) |

## 4. 失敗時の追加 create 禁止条件

**「もう 1 回」暴走防止のため、以下を厳守**:

- run-cycle 1 回失敗 → **直ちに rollback** (Section 5)
- 失敗原因を 1 つ特定するまで **追加 create 禁止**
- 御大判断なしに **自動 retry 禁止**
- 「次の cycle で treat する」も禁止 (autopilot を pause で固定)
- Suno credit 損失防止: 1 回失敗 = 御大の明示判断を仰ぐまで stop

失敗例:
- duration < 180 sec (Suno 側挙動、artifacts は OK でも発生し得る) → 27 秒駄作の再発と同じ
- driver timeout (CDP attach 切れ / textarea state await 失敗 / `bringToFront()` 効かず) — v10.5 Phase A で軽減済だが完全防止ではない
- React controlled input value reflection assertion fail (v10.5 Phase A で 1 回 retry 後 fail)
- payload validation fail (lyrics の構造が壊れる、`extractLyricsBody` で空 body)
- Telegram formatter exception

いずれも rollback → 御大に状況報告 → 御大判断。

## 5. Rollback (Immediate)

成功・失敗・途中停止に関わらず、**Phase 6 完了直後に必ず実行**:

```bash
# 1. env LIVE=off 復帰
cp .local/social-credentials.env.bak .local/social-credentials.env
grep -E "OPENCLAW_SUNO_LIVE|DRYRUN" .local/social-credentials.env
# 期待: LIVE=off (元の値)

# 2. autopilot pause
node -e '
  const fs = require("fs");
  const path = ".local/openclaw/workspace/runtime/autopilot-state.json";
  const state = JSON.parse(fs.readFileSync(path, "utf-8"));
  state.paused = true;
  state.blockedReason = "phase_6_completed";
  fs.writeFileSync(path, JSON.stringify(state, null, 2));
  console.log("autopilot paused");
'

# 3. R10 三重防護復帰確認
grep -E "OPENCLAW_SUNO_LIVE|liveGoArmed|driver:.*mock" .local/social-credentials.env src/*.ts 2>/dev/null
# 期待: LIVE=off / liveGoArmed=false / driver=mock 復帰

# 4. backup ファイル削除
rm .local/social-credentials.env.bak
```

## 6. 完了報告

御大に以下を報告:

- 実行日時 (JST)
- doctor 通過確認 (v10.5 Phase B)
- run-cycle 結果 (success / fail)
- artifact path (song-NNN)
- Suno take URLs (2 つ)
- duration (sec)、quality 御大判定
- Telegram message スクショ
- env rollback 完了確認
- R10 三重防護復帰確認
- Plan v10.5 Phase D 完了宣言

## Out of Scope (本ランブック対象外)

- 連続 cycle 自動実行 (1 回 only)
- duration < 180 sec 時の自動 retry (禁止、御大判断必須)
- Phase 1-5 + v10.5 Phase A/B/C のコード変更 (本ランブックは実行のみ)
- 公開 path (御大の take 選択 → 配信) — 別 runbook
- 専用 headed Chrome profile fallback (v10.5 で混ぜず、別 Plan で評価)
- Tampermonkey / userscript / clipboard inject 等の外部依存 (v10.5 で完全廃止)

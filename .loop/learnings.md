# Loop learnings — 配布プラグイン readiness

毎 run、契約より前に読む。配布で再発する未熟パターンに durable rule を足す。

## durable rules

1. **operator docs は tarball (package.json "files") 内のものだけを手順参照する。**
   新しい運用スクリプト/ファイルを docs の operator 手順に書くなら、必ず "files" に含める、
   または「repo-local / Contributors」セクションへ明示隔離する。
   - 予防 (category): docs の `scripts/` 等の参照を pack:verify / CI で grep し、
     "files" 外参照を検出したら fail にする lint を将来追加する価値がある。
   - 由来 (iteration 1, 2026-06-25): README / OPERATOR_QUICKSTART / OPERATOR_RUNBOOK が
     tarball 外 `scripts/` を operator 手順参照。repo-local 開発用 (openclaw-local-*) と
     operator 運用用 (openclaw-doctor.sh 等、--root 対応で配布可能設計) が docs 上で混在。

2. **repo-local 開発手順を operator quickstart の必須ステップに混入させない。**
   `.local/` 依存・repo clone 前提のスクリプト (openclaw-local-gateway, openclaw-local-env.sh) は
   「Contributors / repo-local」セクションに隔離。operator が tarball install 後に実行できない
   手順を quickstart の冒頭ステップにしない。
   - 配布 operator の「gateway 起動の正規ルート」が docs に欠けていないか毎回確認する。

3. **「未熟を緑にする」修正で機能追加 (新 API route / UI button / 新 CLI) に逃げない。**
   North Star (複雑にするな・御大の手数を増やすな) を loop でも守る。
   docs 整合は「既存 operator スクリプトの同梱 + repo-local 手順の隔離 + 既存ルートへの書き換え」
   で解けるなら、新機能を作らない。新機能が要ると判明したら scope-boundary で停止し報告する。

4. **fake done 禁止。** docs を消して整合させる/placeholder を完了扱い/test を弱める、は不可。
   構造 (grep/突合) で緑にしたうえ、読み手目線 criterion は sub-agent spot-check してから pass。

5. **leak scan は `npm pack --dry-run` の実ファイル一覧で行う (src grep だけでは漏れる)。**
   npm は README* を `files` allowlist の glob (`dist/**/*.js` 等) に関係なく強制同梱する。
   そのため `dist/suno-production/knowledge/README.md` の絶対パスが tarball に漏れていた
   (source は clean なのに stale dist が残存)。
   - 予防 (category): 漏洩 grep を src だけでなく `npm pack --dry-run --json` の files に当てる。
   - 由来 (iteration 2, 2026-06-26)。

6. **配布汎用性チェックは identifier grep だけでなく「美学/persona」も見る。**
   workspace-template/ARTIST.md は御大の signature (male vocal / 78-96 BPM / 夜の街 obsession) を
   「例」明示なく default artist として焼き込んでいた (識別子 string は 0 だが persona leak)。
   sample 内容は EXAMPLE banner で「置き換え対象」と明示し、prescriptive な既定 (gender 等) は中立化。
   - 由来 (iteration 5, 2026-06-26)。

7. **package.json `files` と docs/PACKAGE_CONTENTS.md の宣言を同期させる。**
   PACKAGE_CONTENTS が「ship する」と書いた operator docs 4 本が files に無かった (oversight)。
   宣言 doc が source-of-truth、files が実体 — 乖離は operator の broken link になる。
   - 予防 (category): verify-package に「PACKAGE_CONTENTS が列挙する docs/scripts が files にあるか」
     の突合を将来追加する価値がある。
   - 由来 (iteration 3, 2026-06-26)。

---
name: verify
description: このプロジェクトの検証一式（lint、型検査、単体テスト、build、任意でe2e）を実行し、結果を非エンジニアにも分かる形で報告する。変更後の確認や「テストして」と言われたときに使う。
allowed-tools: Bash(npm run *) Bash(git status *) Bash(git diff *)
arguments: [scope]
---

# 検証の実行

`$scope` が `e2e` なら e2e まで、それ以外は単体検証までを実行する。

1. `git status --short` で変更ファイルを確認する。
2. 次を順に実行する。途中で失敗しても残りを実行し、全部の結果を集める。
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test`
   - `npm run build`（`assets:verify` を含む。MediaPipe資産のハッシュ不一致なら `public/mediapipe/` が壊れている）
   - `$scope` が `e2e` のとき: `npm run test:e2e`
3. 報告は次の形にする。
   - 各項目を「通った / 失敗 / 未実施」で1行ずつ。テスト件数は実際の出力から取る。
   - 失敗があれば、エラー文を原文のまま引用し、何が問題かを日本語で一言添える。
   - 実機（Android Chrome、iPhone Safari）での確認は自動化できないので、必要なら「未実施」と明記する。

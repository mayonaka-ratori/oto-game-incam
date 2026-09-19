@AGENTS.md

# Claude Code 向けの補足

- 上の `AGENTS.md` の「Codex」はClaude Codeにもそのまま当てはまる。特に「commit / push / 公開は依頼があった時だけ」を守る。
- 現在地と「文書の正本」表は、セッション開始時のhookが `docs/README.md` から毎回渡す。作業開始時に `docs/README.md` を読み直さない。作業記録の一覧や用語集が要るときだけ開く。
- 分野ごとの決まりは `.claude/rules/` にあり、`docs/` `src/` `tests/` `.claude/` のファイルを触ったときに自動で入る。ここと `AGENTS.md` へ複製しない。

## よく使うコマンド

| 目的 | コマンド | 備考 |
|---|---|---|
| 依存関係の導入 | `npm ci` | `package-lock.json` に固定済み |
| 開発サーバー | `npm run dev` | `127.0.0.1:5173`。ブラウザ確認は `launch.json` の `vite-dev` を使う |
| lint / 型検査 / 単体テスト | `npm run lint` / `npm run typecheck` / `npm run test` | 単体テストはNode環境で約1秒 |
| まとめて検証 | `npm run verify` | lint → test → build。buildは `typecheck` と `assets:verify` を含む |
| ブラウザ自動試験 | `npm run test:e2e` | Playwright。先にbuildし、`vite preview`（4173）を偽カメラで起動する |
| MediaPipe資産の再配置 | `npm run assets:prepare` | ネットワーク取得を伴う。通常は実行しない |

型検査と単体テストは、未コミットの変更があれば応答終了時のhookが自動で走らせる。UIを変えたときの `npm run test:e2e` は自動では走らない。

## コードの置き場所

- `src/camera/` カメラ取得、latest-frame-onlyスケジューラ、取得経路のURL指定
- `src/worker/` MediaPipeを動かす専用Workerと、合成fixtureのmock Worker
- `src/tracking/` 安定trackIdと派生特徴量、`src/gestures/` ジェスチャー状態機械と調停（Liftとななめリフトは `parallel-lift-state-machine.ts` を共有）
- `src/time/` Web Audioクロック、拍タイムライン、メトロノーム
- `src/experiments/` 追跡の実験profile（解像度・fps・GPU/CPUの組。既定は `gpu-640x480-30`）と、速度チェックで測る設定の並び（`speed-check-plan.ts`）
- `src/metrics/` 計測値、統計、セッション全体とブロック別の性能集計、端末情報の自動収集
- `src/poc/` P1-Controlled制御試験。`phase1-protocol.ts` が試験手順（選択・試行数・時間切れ・準備完了）の正本、`phase1-session.ts` が結果JSONのschemaと旧versionの移行
- `src/testing/` 実機確認レポート（device checklist）とP1セッション比較
- `src/replay/` 診断リプレイ、`src/rendering/` 重ね表示、なぞる案内、カウントと成功表示、手のひらカーソル、座標変換
- `src/ui/` 画面と横向きモード、`src/app/` 画面状態、コントローラ、Screen Wake Lock、build ID
- `build/` Viteプラグイン（静的Sites配信用の出力とbuild ID。配信先URLはリポジトリに置かない）

URL指定: `?protocol=five`（5動作・50試行。既定は残る2動作・20試行）、`?protocol=regression`（回帰確認）、`?view=analysis`（分析用の詳細画面）、`?tracking=mock`、`?profile=`、`?frameSource=`、`?pending=`

## ハーネス（`.claude/`）

- `settings.json`: 権限とhooks。セッション開始時に現在地と正本の表を渡す。編集後にESLint、応答終了時に型検査と単体テストが走る（前回通ったときから変更がなければ省く）。`git push` は拒否、`git commit` と `assets:prepare` は確認付き。
- `rules/`: `docs.md` `src.md` `tests.md` `harness.md`。対象のファイルを触るときだけ読み込まれる。
- `skills/verify`: `/verify` で検証一式、`/verify e2e` でブラウザ自動試験まで実行して報告する。
- `skills/handoff`: `/handoff` で作業の締め。現在地と文書のステータスを更新し、整合を点検し、差分と検証結果を報告する。commitはしない。
- `agents/doc-consistency-checker`: 正本文書同士と、文書とコードの試験条件の矛盾を読み取り専用で点検する。
- `launch.json`: ブラウザ確認用の起動定義（`vite-dev` は5173、`vite-preview` は4173。previewは先に `npm run build` が要る）。

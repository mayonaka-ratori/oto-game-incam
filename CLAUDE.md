# 最初に守ること

ユーザーへの報告、確認、判断を求める文章は、すべて非エンジニアにも分かる自然な日本語で書く。
主語を省かず、「何が」「どうなった」「どうしたいか」を毎回はっきり書く。専門用語には短い説明を添える。

@AGENTS.md

# Claude Code 向けの補足

上の `AGENTS.md` はCodex向けに書かれているが、そこでの「Codex」はClaude Codeにもそのまま当てはまる。
特に「commit / push / 公開は依頼があった時だけ」「作業開始時に `docs/README.md` で現在地を確認する」を守る。

## よく使うコマンド

| 目的 | コマンド | 備考 |
|---|---|---|
| 依存関係の導入 | `npm ci` | `package-lock.json` に固定済み。`@latest` を使わない |
| 開発サーバー | `npm run dev` | `127.0.0.1:5173`。カメラはlocalhostならsecure context扱い |
| lint / 型検査 / 単体テスト | `npm run lint` / `npm run typecheck` / `npm run test` | 単体テストは `tests/**/*.test.ts`、Node環境で約1秒 |
| まとめて検証 | `npm run verify` | lint → test → build。buildは `typecheck` と `assets:verify` を含む |
| ブラウザ自動試験 | `npm run test:e2e` | Playwright。先にbuildし、`vite preview`（4173）を偽カメラで起動する |
| MediaPipe資産の再配置 | `npm run assets:prepare` | ネットワーク取得を伴う。通常は実行しない。`assets:verify` はハッシュ照合のみ |

## 変更時に守ること

- `src/` `tests/` `e2e/` `build/` を編集したら、少なくとも `npm run typecheck` と `npm run test` を通す。UIを変えたら `npm run test:e2e` も通す。
- `public/mediapipe/` 配下は編集しない。ハッシュ固定のバイナリで、不一致だとbuildが失敗する。
- `tsconfig.json` は `strict` に加えて `noUncheckedIndexedAccess` と `exactOptionalPropertyTypes` が有効。配列添字は `undefined` を扱い、optionalプロパティへ `undefined` を明示代入しない。
- UIの文言は日本語で、e2eがボタン名や見出しの文言でセレクトしている。文言を変えたら `e2e/camera.spec.ts` も直す。
- P1セッションJSONやdevice checklist JSONのschemaを変えるときは、旧versionの読込互換（移行）を残す。

## コードの置き場所

- `src/camera/` カメラ取得とlatest-frame-onlyスケジューラ、取得経路のURL指定（`?frameSource=`、`?pending=`）
- `src/worker/` MediaPipeを動かす専用Worker（`?tracking=mock` で合成fixtureのmock Workerに切替）
- `src/tracking/` 安定trackIdと派生特徴量、`src/gestures/` ジェスチャー状態機械と調停
- `src/time/` Web Audioクロック、拍タイムライン、メトロノーム
- `src/experiments/` 追跡の実験profile（解像度・fps・GPU/CPUの組。既定は `gpu-640x480-30`）
- `src/metrics/` フレーム・追跡の計測値、統計、セッション全体とブロック別の性能集計、端末情報の自動収集、端末のtechnical snapshot
- `src/poc/` P1-Controlled制御試験の定義（`phase1-protocol.ts` が試験手順の選択・試行数・時間切れ・準備完了の正本。既定は残る2動作・20試行、`?protocol=five` で5動作・50試行、`?protocol=regression` で回帰確認）、エンジン、セッション保存
- `src/testing/` 実機確認レポート（device checklist）とP1セッション比較
- `src/replay/` 診断リプレイ（ランドマークの再生）、`src/rendering/` 重ね表示、各動作のなぞる案内の座標、カウントと成功表示の時刻、手のひらカーソル、座標変換
- `src/ui/` 画面と横向きモード、`src/app/` 画面状態とコントローラ、画面を消さない仕組み（Screen Wake Lock）、build ID
- `build/` Viteプラグイン（静的Sites配信用の出力とbuild ID。配信先URLはリポジトリに置かない）

## ハーネス（`.claude/`）

- `settings.json`: 権限とhooks。セッション開始時に `docs/README.md` の現在地を読み上げ、編集後にESLint、応答終了時に（未コミット変更があるときだけ）型検査と単体テストが自動で走る。`git push` は拒否、`git commit` と `assets:prepare` は確認付き。
- `rules/`: `docs/` `src/` `tests/` `.claude/` を触るときだけ読み込まれる決まり。
- `skills/verify`: `/verify` で検証一式を実行して結果を報告する。`/verify e2e` でブラウザ自動試験まで。
- `skills/handoff`: `/handoff` で作業の締め。`docs/README.md` の現在地と文書のステータスを更新し、整合を点検し、差分と検証結果を報告する。commitはしない。
- `agents/doc-consistency-checker`: 正本文書同士と、文書とコードの試験条件の矛盾を読み取り専用で点検する。
- `launch.json`: ブラウザ確認用の起動定義（`vite-dev` は5173、`vite-preview` は4173。previewは先に `npm run build` が要る）。

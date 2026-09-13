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

- `src/camera/` カメラ取得とlatest-frame-onlyスケジューラ
- `src/worker/` MediaPipeを動かす専用Worker（`?tracking=mock` で合成fixtureのmock Workerに切替）
- `src/tracking/` 安定trackIdと派生特徴量、`src/gestures/` ジェスチャー状態機械と調停
- `src/time/` Web Audioクロック、拍タイムライン、メトロノーム
- `src/poc/` P1-Controlled制御試験のエンジンとセッション保存、`src/testing/` 実機確認レポートとセッション比較
- `src/ui/` 画面と横向きモード、`src/app/` 画面状態とコントローラ
- `build/` Viteプラグイン（Cloudflare Sites用の出力とbuild ID）

## ハーネス（`.claude/`）

- `settings.json`: 権限とhooks。編集後にESLint、応答終了時に型検査と単体テストが自動で走る。`git push` は拒否、`git commit` と `assets:prepare` は確認付き。
- `rules/`: `docs/` `src/` `tests/` を触るときだけ読み込まれる決まり。
- `skills/verify`: `/verify` で検証一式を実行して結果を報告する。
- `agents/doc-consistency-checker`: 正本文書同士の矛盾を読み取り専用で点検する。

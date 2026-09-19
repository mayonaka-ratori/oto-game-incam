---
paths:
  - "src/**/*.ts"
  - "src/**/*.css"
  - "build/**/*.ts"
  - "index.html"
---

# アプリ実装の決まり

`AGENTS.md` の「実装と検証」に加えて守ること。

- latest-frame-onlyでは、in-flightとpendingをそれぞれ1以下に保つ（`src/camera/latest-frame-scheduler.ts`）。
- 時刻の正本はWeb Audioクロックとイベント時刻。描画フレーム数や `setInterval` 回数を時刻の正本にしない。
- ジェスチャー判定（`src/gestures/`）はMediaPipe固有の型に依存しない。追跡バックエンドは `src/tracking/` と `src/worker/` に閉じる。
- 生音声も保存・送信しない。マイク権限は要求しない。
- 閾値や時間定数（150ms graceなど）は実測前の初期値。変えるときは根拠となる実機セッションを文書に残す。
- 判定・分類ロジックは純粋関数または状態機械として書き、`tests/helpers/` の合成fixtureで検証できる形にする。DOM依存は `src/ui/` と `src/app/` に閉じ込める。
- Workerとの通信は `src/worker/tracking-worker-messages.ts` の判別共用体で型付けし、`assertNever` で網羅性を保つ。
- `tsconfig.json` は `strict` に加えて `noUncheckedIndexedAccess` と `exactOptionalPropertyTypes` が有効。配列添字は `undefined` を扱い、optionalプロパティへ `undefined` を明示代入しない。
- P1セッションJSONやdevice checklist JSONのschemaを変えるときは、旧versionの読込互換（移行）を残す。
- UIの文言は日本語。e2eがボタン名や見出しの文言でセレクトしているので、文言を変えたら `e2e/` のspecも直す。
- UIを変えたら `npm run test:e2e` を通し、対象画面を実際に表示して確認する。型検査と単体テストは応答終了時のhookが走らせる。
- `public/mediapipe/` 配下はハッシュ固定のバイナリで、編集は権限で拒否される。不一致だとbuildが失敗する。

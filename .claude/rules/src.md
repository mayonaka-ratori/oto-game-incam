---
paths:
  - "src/**/*.ts"
  - "build/**/*.ts"
---

# アプリ実装の決まり

- カメラ処理はlatest-frame-only。古いフレームをキューへ溜めず、in-flightとpendingはそれぞれ1以下に保つ（`src/camera/latest-frame-scheduler.ts`）。
- ジェスチャー判定と採点時刻は音声タイムライン（Web Audioクロック）とイベント時刻を正本にする。描画フレーム数や `setInterval` 回数を時刻の正本にしない。
- 追跡バックエンド（`src/tracking/`、`src/worker/`）とジェスチャー判定（`src/gestures/`）を分離したまま保つ。判定側はMediaPipe固有の型に依存しない。
- 生カメラ映像と生音声は保存・送信・永続化しない。保存するのは派生ランドマークと計測値だけ。マイク権限は要求しない。
- tracking lossは機械側の失敗であり、プレイヤーのMISSとして扱わない。
- 閾値や時間定数（150ms graceなど）は実測前の初期値。変えるときは根拠となる実機セッションを文書に残す。
- 判定・分類ロジックは純粋関数または状態機械として書き、`tests/` の合成fixture（`tests/helpers/`）で検証できる形にする。DOM依存は `src/ui/` と `src/app/` に閉じ込める。
- Workerとの通信は `src/worker/tracking-worker-messages.ts` の判別共用体で型付けし、`assertNever` で網羅性を保つ。
- 依存関係とモデルは固定バージョン。`@latest` や動的取得を追加しない。

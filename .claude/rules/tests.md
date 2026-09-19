---
paths:
  - "tests/**/*.ts"
  - "e2e/**/*.ts"
  - "vitest.config.ts"
  - "playwright.config.ts"
---

# テストの決まり

- 単体テストはVitest、環境は `node`。`tests/**/*.test.ts` に置き、ブラウザAPIが要る部分はモックにする。
- 合成入力は `tests/helpers/tracking-fixtures.ts` と `tests/helpers/gesture-fixtures.ts` を再利用する。フレーム時刻は単調増加にする。
- `Phase1LabEngine` へ合成フレームを流すテストでは、フレーム間隔を50〜100msにする。間隔が空くと `HandFeaturePipeline` がtrackIdを振り直し、準備完了や再武装が成立しないままテストが落ちる。
- e2eはPlaywright（Chromium、偽カメラ）。`npm run test:e2e` が事前にbuildして `vite preview` を `127.0.0.1:4173` で起動する。
- e2eのセレクタは日本語のUI文言（見出し、ボタン名）に依存する。文言を変えたらspecを同時に直す。
- e2eで1秒程度しか続かない表示（結果の保持、カウントイン）は、クリックと同じ `page.evaluate` の中で読む。PCの負荷が高いと全体実行でだけ落ちることがあるので、全体を2回通して確かめる。
- 合成入力やPCブラウザのテストが通っても、P1-Controlledの合格証拠にはならない。実機結果と混同する記述をしない。
- 不具合修正は、まず失敗するテストを追加して再現してから直す。

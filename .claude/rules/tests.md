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
- e2eはPlaywright（Chromium、偽カメラ）。`npm run test:e2e` が事前にbuildして `vite preview` を `127.0.0.1:4173` で起動する。
- e2eのセレクタは日本語のUI文言（見出し、ボタン名）に依存する。文言を変えたら `e2e/camera.spec.ts` を同時に直す。
- 合成入力やPCブラウザのテストが通っても、P1-Controlledの合格証拠にはならない。実機結果と混同する記述をしない。
- 不具合修正は、まず失敗するテストを追加して再現してから直す。

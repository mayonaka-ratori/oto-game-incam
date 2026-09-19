# Oto Motion Technical Lab

Phase 1のカメラ許可・二手追跡・音声時刻・単体ジェスチャー・計測画面である。プロジェクトの現在地と仕様の正本は[docs/README.md](./docs/README.md)、実機確認前までの実装結果は[docs/10_phase1_ai_preparation_implementation.md](./docs/10_phase1_ai_preparation_implementation.md)、5動作・50試行への改訂とコードレビュー後のAndroid 2回目の分析と現行の試験画面（映像の上のなぞる案内、残る2動作・20試行）は[docs/18_android_second_test_and_next_plan.md](./docs/18_android_second_test_and_next_plan.md)、修正の記録は[docs/13_p1_five_gesture_50_trial_revision_plan.md](./docs/13_p1_five_gesture_50_trial_revision_plan.md)の14章、構造の見直しと判定条件を変えない修正（軽量化、結果JSON schema v8、Bloomの案内）は[docs/16_structure_review_and_lightweight_fixes.md](./docs/16_structure_review_and_lightweight_fixes.md)を参照する。

## 必要環境

- Node.js 22.13.0以上（開発確認: 22.17.1）
- npm 11系
- カメラへアクセスできるsecure context（`localhost`または有効なHTTPS）

依存関係は2026-07-19にnpm registryの公開情報と互換条件を確認し、`package.json`と`package-lock.json`へ固定している。

| 開発ツール | 固定バージョン | 確認先 |
|---|---:|---|
| Vite | 8.1.5 | [npm registry](https://www.npmjs.com/package/vite/v/8.1.5) |
| TypeScript | 6.0.3 | [npm registry](https://www.npmjs.com/package/typescript/v/6.0.3) |
| Vitest | 4.1.10 | [npm registry](https://www.npmjs.com/package/vitest/v/4.1.10) |
| ESLint | 10.7.0 | [npm registry](https://www.npmjs.com/package/eslint/v/10.7.0) |
| typescript-eslint | 8.64.0 | [npm registry](https://www.npmjs.com/package/typescript-eslint/v/8.64.0) |
| Playwright | 1.61.1 | [npm registry](https://www.npmjs.com/package/@playwright/test/v/1.61.1) |
| MediaPipe Tasks Vision | 0.10.35 | [npm registry](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.35) |

Hand Landmarker fullモデルとWASMは同一オリジンの`public/mediapipe/`から配信する。出典、SHA-256、ライセンス参照は[MediaPipe資産記録](./docs/09_mediapipe_assets.md)に記録している。資産を再配置する場合は明示的に`npm run assets:prepare`を実行する。buildはネットワーク取得せず、既存資産のハッシュ不一致時に失敗する。

## 起動と検証

```sh
npm ci
npm run dev
```

主要な検証は次でまとめて実行する。

```sh
npm run verify
npm run test:e2e
```

合成二手fixtureでオーバーレイだけを確認する場合は`/?tracking=mock`を使用できる。通常URLでは固定したMediaPipe実装を専用Worker内で実行する。

標準URLは、カメラ映像を画面の主役に置き、映像の中に短い指示、なぞる案内、カウント、成功表示を出す1画面のテスター用モードになる。全telemetryはバックグラウンドで記録する。Live diagnosticsは、開発者が`?view=analysis`で開いた場合だけ表示する。

`?view=analysis`で開いた画面の下部にある「実機確認レポート」では、試験条件、カメラ経路、二手追跡、停止・復帰を「未確認／問題なし／問題あり／対象外」で管理できる。P1セッションJSONから3入力（エアタップ・リボンスワイプ・Bloom）の結果と計測端末のtechnical snapshotを取り込み、PCで主観回答や判定を記入してもスマートフォン由来の自動計測値を保持する。実機確認JSONは保存・読み戻しでき、旧schema 1.0／2.0／2.1／2.2／2.3は読み込み時に2.4へ移行する。2.3からは取り込んだP1結果の版と試験手順IDを、2.4からは端末情報と処理経路の指定（`?frameSource=`／`?pending=`）も記録する。JSONにカメラ映像や音声は含めない。

「単体ジェスチャー制御試験」では、Web Audioクロックを有効にし、正本の手順を進める。既定は縦向きの3動作（ribbon-swipe、Lift、ななめリフト）の30試行で、`?protocol=remaining-two`でribbon-swipeとBloomの20試行、`?protocol=five`で5動作・50試行、`?protocol=regression`で回帰確認の9試行になる。`?mode=speedcheck`は、設定を変えながら処理の速さを自動で測る速度チェックを開く。Bloom／Liftは両手が開始位置に安定してからカウントを始める。動作の切り替わりは画面のタップで進み（必須休憩はない）、途中で中断・再開できる。派生ランドマーク、gesture eventTime、成功・拒否理由、手動分類、技術指標をP1セッションJSONとして保存できる。合成入力やPCブラウザだけではP1合格にせず、対象実機の結果を必ず記録する。

実機から確認する場合は、有効なHTTPSでproduction buildを配信する。LAN内の平文HTTPはスマートフォンのカメラAPIでsecure contextとして扱われないため、実機試験には使用しない。

スマートフォンでP1-Controlledを実行してP1セッションJSONを保存し、PCで`?view=analysis`を開き、そのJSONを「P1セッション結果を取込」へ渡すと、PCで残りのレポートを記入できる。「自動計測値の出所」がP1セッション由来と表示されていることを確認してから最終JSONを保存する。

## データ方針

この画面はカメラ映像をブラウザ内のプレビューへ直接表示するが、録画、アップロード、永続保存を行わない。マイク権限も要求しない。

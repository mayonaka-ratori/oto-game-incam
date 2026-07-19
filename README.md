# Oto Motion Technical Lab

Phase 1のカメラ許可・二手追跡・計測画面である。プロジェクトの現在地と仕様の正本は[docs/README.md](./docs/README.md)、追跡パイプラインの作業計画は[docs/08_phase1_tracking_pipeline_implementation_plan.md](./docs/08_phase1_tracking_pipeline_implementation_plan.md)を参照する。

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

実機から確認する場合は、有効なHTTPSでproduction buildを配信する。LAN内の平文HTTPはスマートフォンのカメラAPIでsecure contextとして扱われないため、実機試験には使用しない。

## データ方針

この画面はカメラ映像をブラウザ内のプレビューへ直接表示するが、録画、アップロード、永続保存を行わない。マイク権限も要求しない。

# Phase 1 / Step 1.1 実装プラン

- 作成日: 2026-07-19
- 対象: **Phase 1 — Tracking & Latency Lab / Step 1.1**
- ステータス: 実装完了（対象実機確認待ち）
- 文書種別: 作業計画。仕様の正本ではない

この文書は、[資料ガイド](./README.md)で定める現在地に対する実装順序と完了確認をまとめる。仕様やゲートを変更する文書ではなく、判断が食い違う場合は次の正本を優先する。

- 現行POCの範囲とフェーズ: [03_mvp_definition_and_roadmap.md](./03_mvp_definition_and_roadmap.md)
- 技術選定と計測方針: [02_technical_strategy_and_plan.md](./02_technical_strategy_and_plan.md)
- POCの実施条件と記録: [05_poc_test_protocol.md](./05_poc_test_protocol.md)
- Technical Labの画面と状態: [04_mvp_uiux_direction.md](./04_mvp_uiux_direction.md)

## 1. 目的

TypeScript / Viteの最小Webアプリを用意し、ユーザー操作からインカメの使用許可を取得して、後続の二手追跡・音声時刻・ジェスチャー計測を追加できるTechnical Labの画面を成立させる。

このステップで先に確かめるのは、対象ブラウザでカメラを安全に開始・停止でき、実際に取得できた映像条件と基本フレーム指標を観測できることである。90秒ゲーム、演出、採点は作らない。

## 2. 関係する文脈

- 対象端末はiPhone 15とGoogle Pixel 10 Pro XL、インカメ、横画面、座位、スタンド設置、距離70〜100cmを初期条件とする。
- Webを第一候補とするが、Web固有の遅延や熱が技術ゲートを阻害した場合だけネイティブ比較を検討する。
- 生カメラ映像・生音声は原則保存しない。Step 1.1では録画、アップロード、永続化を実装しない。
- 生映像は通常のプレイ画面では隠す方針だが、Technical Labの開発モードではカメラと計測値を確認できるようにする。
- 将来の推論処理は専用Workerとlatest-frame-only方式にする。Step 1.1のフレーム観測も、後でキュー方式へ作り替える前提を持ち込まない。
- ゲーム時刻の正本は将来Web Audioクロックに置く。Step 1.1のカメラ時刻や描画時刻をゲーム判定の正本にはしない。

## 3. このステップの範囲

### 3.1 実装するもの

1. 固定バージョンのTypeScript / Viteプロジェクトと再現可能なlockfile
2. 対応環境・secure context・カメラAPIの事前診断
3. ユーザー操作を起点とするインカメ許可、開始、停止、再試行
4. Technical Lab用の横画面レイアウトと開発用カメラプレビュー
5. 要求したカメラ条件と、`MediaStreamTrack.getSettings()`で得た実設定の表示
6. カメラフレーム、描画、画面状態を確認する最小メトリクス
7. 許可拒否、カメラなし、取得中断、非対応環境を区別する状態表示
8. 自動テスト、PC確認、iPhone / Android実機確認の手順

### 3.2 このステップでは実装しないもの

- MediaPipe Hand Landmarker、21点ランドマーク、二手ID維持
- Dedicated Workerと`VideoFrame` / `ImageBitmap`転送
- ジェスチャー状態機械と判定イベント
- Web Audioメトロノーム、beat変換、採点
- 派生ランドマークのリプレイとセッションログ保存
- PWAのオフラインキャッシュ、90秒MVP、譜面、リザルト、キャラクター、VFX

画面には将来の追跡・音声パネルを置く場合も、未計測値をゼロや成功扱いにせず「未実装」と明示する。

## 4. 実装上の前提と制約

### 4.1 採用する初期構成

- Viteのvanilla TypeScript構成を出発点とし、Step 1.1ではUIフレームワークを追加しない。
- DOMとCSSで診断UIを作り、映像は`<video playsinline muted>`へ`MediaStream`を直接接続する。
- カメラ操作はUIから分離した小さなモジュールへ集約し、後続のキャプチャ経路から交換しやすくする。
- 状態は文字列union等で明示し、例外メッセージの文字列比較だけで画面分岐しない。
- 依存関係は実装開始時に公式情報と互換性を確認して具体的なバージョンへ固定し、`@latest`や浮動的なCDN参照を使わない。

### 4.2 カメラ要求

最初の要求値は次を基準にし、成功後は要求値ではなく実設定を表示する。

```ts
{
  audio: false,
  video: {
    facingMode: { ideal: "user" },
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 60, min: 30 },
  },
}
```

端末差を吸収するため、`ideal`値どおりでないことをエラーにしない。取得失敗時に無制限な条件緩和を繰り返さず、原因を表示してユーザーが再試行できるようにする。解像度比較UIは後続ステップで追加する。

### 4.3 プライバシーとライフサイクル

- カメラを使う目的と「映像を送信・保存しない」ことを許可前に表示する。
- マイク権限は要求しない。
- 停止、ページ離脱、再取得前には全`MediaStreamTrack`へ`stop()`を呼ぶ。
- `ended`、`mute`、`unmute`を観測し、カメラがOSやブラウザ側で止まった状態を画面へ反映する。
- ログへ映像フレームや個人を識別する情報を出さない。

## 5. 画面設計

### 5.1 状態

| 状態 | 主な表示 | 利用者の操作 |
|---|---|---|
| `checking` | APIとsecure contextを確認中 | 待つ |
| `unsupported` | 不足している機能と代替案 | 対応環境を確認する |
| `permission-required` | 使用目的、非保存方針 | カメラを開始する |
| `requesting` | ブラウザの許可操作を待っている | 許可／拒否を選ぶ |
| `active` | 開発用プレビューと計測値 | 停止／再取得する |
| `permission-denied` | 拒否されたことと設定確認案内 | 設定後に再試行する |
| `no-device` | 使用可能なカメラがない | 接続を確認する |
| `interrupted` | 取得が途中で止まった理由 | 再試行する |
| `error` | 分類できるエラーコードと短い案内 | 再試行する |

許可拒否をプレイヤーの失敗として扱わず、ブラウザの原文エラーは開発詳細へ残し、主表示は日本語の行動案内にする。

### 5.2 レイアウト

- 横画面を第一仮説としつつ、狭い画面ではプレビューと診断パネルを縦に積む。
- safe-area insetを使い、ノッチ、Dynamic Island、ブラウザUIとの重なりを避ける。
- 左側または上側を映像領域、右側または下側をカメラ・フレーム・環境診断にする。
- プレビューは鏡像表示するが、元のフレーム座標や将来の追跡座標を反転済みとして保存しない。表示変換の責務を分ける。
- 開発用プレビューは表示／非表示を切り替えられるようにし、非表示中も必要なストリーム状態の観測は続ける。

### 5.3 Step 1.1で表示する計測値

**環境**

- secure context、Page Visibility、画面向き、viewport、device pixel ratio
- `requestVideoFrameCallback`等、次ステップで使う主要APIの対応有無

**カメラ**

- requested width / height / frame rate / facing mode
- actual width / height / frame rate / facing mode / device label（権限取得後のみ）
- track `readyState`、`muted`

**フレーム**

- `requestVideoFrameCallback()`から測る受信フレーム数と直近区間の実フレームレート
- フレーム間隔の直近値と簡易p50 / p95
- `requestAnimationFrame()`から測る描画FPS
- セッション開始からの経過時間

Step 1.1ではWorker待機時間、推論時間、frame age、追跡出力Hzをまだ表示しない。必要な時刻がない値を推測で算出しない。

## 6. 実装順序

### 6.1 基盤を作る

- [x] Node.jsとパッケージマネージャーの前提をREADMEへ明記する。
- [x] Vite / TypeScriptを固定バージョンで導入し、lockfileを作る。
- [x] `dev`、`build`、`preview`、`typecheck`、`lint`、`test`のスクリプトを用意する。
- [x] `src`をapp、camera、metrics、uiの責務で分ける。
- [x] strictなTypeScript設定とブラウザ対象を定める。

### 6.2 対応診断と状態モデルを作る

- [x] secure context、`navigator.mediaDevices`、`getUserMedia`の機能検出を実装する。
- [x] カメラ画面の状態と遷移を副作用から分離する。
- [x] `DOMException.name`を基準に、拒否、デバイスなし、競合、制約不一致、その他を分類する。
- [x] 状態別の日本語メッセージと再試行導線を実装する。

### 6.3 カメラのライフサイクルを作る

- [x] ボタン操作から`getUserMedia()`を呼び、インカメを要求する。
- [x] 取得したstreamを`<video>`へ接続し、再生可能になるまで状態を管理する。
- [x] 実設定と対応能力を取得する。
- [x] 停止、再取得、ページ離脱、track終了時のcleanupを実装する。
- [x] 多重開始と古い非同期結果によるstreamの上書きを防ぐ。

### 6.4 Technical Lab UIを作る

- [x] 許可前説明、開始／停止／再試行、開発用プレビューを実装する。
- [x] 横画面とsafe areaに対応したレスポンシブレイアウトを作る。
- [x] 要求設定、実設定、環境診断を表示する。
- [x] プレビューの鏡像表示と表示切り替えを実装する。
- [x] 状態を色だけでなく文言とアイコン形状でも識別できるようにする。

### 6.5 基本メトリクスを作る

- [x] カメラフレームと描画フレームを別々に観測する。
- [x] 有限長のリングバッファまたは固定窓でフレーム間隔を集計する。
- [x] p50 / p95算出を純粋関数にし、単体テスト可能にする。
- [x] 非表示タブの値を通常測定へ混ぜないよう、visibilityを表示・区別する。
- [x] 画面更新頻度を制限し、診断UI自身がフレーム処理を圧迫しないようにする。

### 6.6 検証して引き継ぐ

- [x] 型検査、lint、単体テスト、production buildを実行する。
- [x] fake cameraを使えるブラウザ自動テストで主要状態を確認する。
- [ ] PCで画面を実表示し、許可、拒否、停止、再試行、リサイズを確認する。
- [ ] HTTPSの実機確認経路を用意し、iPhone 15とGoogle Pixel 10 Pro XLで確認する。
- [ ] 実機のOS、ブラウザ完全バージョン、要求値、実設定、観察事項を記録する。
- [x] `git diff`と`git status`を確認し、無関係な変更を含めない。

## 7. 想定するファイル構成

実装時に責務が保たれる限り名前は調整してよい。

```text
.
├─ index.html
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ vite.config.ts
├─ src/
│  ├─ main.ts
│  ├─ app/
│  │  ├─ lab-controller.ts
│  │  └─ lab-state.ts
│  ├─ camera/
│  │  ├─ camera-controller.ts
│  │  ├─ camera-errors.ts
│  │  └─ camera-support.ts
│  ├─ metrics/
│  │  ├─ frame-metrics.ts
│  │  └─ statistics.ts
│  ├─ ui/
│  │  ├─ lab-view.ts
│  │  └─ styles.css
│  └─ types/
│     └─ browser.d.ts
└─ tests/
   ├─ camera-errors.test.ts
   ├─ lab-state.test.ts
   └─ statistics.test.ts
```

## 8. テスト計画

| レベル | 確認内容 | 合格条件 |
|---|---|---|
| 単体 | 状態遷移、カメラエラー分類、p50 / p95、固定窓 | 境界値と空入力を含めて期待どおり |
| ブラウザ自動 | 初期表示、fake cameraの許可・表示、停止、主要エラー表示 | 主要フローが再現可能 |
| PC手動 | 実カメラ、拒否後の案内、再取得、プレビュー切替、レスポンシブ表示 | streamが一つだけ動き、停止時にtrackが終了 |
| iPhone 15 | Safariの実設定、横画面、safe area、許可と再試行 | 映像と値が更新され、操作不能な重なりがない |
| Pixel 10 Pro XL | Chromeの実設定、横画面、許可と再試行 | 映像と値が更新され、操作不能な重なりがない |

実機ではカメラ品質を自動テストで代替しない。Step 1.1では追跡性能の合否を出さず、カメラ取得経路と計測画面が次の実測に使えるかを確認する。

## 9. 完了条件

次をすべて満たした時点でStep 1.1を完了とする。

- [x] クリーン環境で依存関係をlockfileから再現できる。
- [x] `typecheck`、`lint`、`test`、`build`が成功する。
- [x] 許可前に用途と非保存方針が表示され、ユーザー操作後にだけカメラ許可を要求する。
- [x] 許可時にインカメ映像が開発用プレビューへ表示され、要求設定と実設定を区別して確認できる。
- [x] カメラFPS、フレーム間隔p50 / p95、描画FPSが継続更新される。
- [x] 拒否、カメラなし、非対応、取得中断が区別され、再試行または代替案が表示される。
- [x] 停止またはページ離脱後にカメラtrackが残らず、多重streamが発生しない。
- [x] 映像・音声の録画、アップロード、永続保存を行わない。
- [ ] PC、iPhone 15、Google Pixel 10 Pro XLで画面を実表示し、横画面の見た目と基本操作を確認する。
- [x] 実機確認結果と未実施項目が文書化され、次ステップの実装判断に使える。

## 10. 実装開始時に確定する事項

次は仕様変更ではなく、作業開始時に調査して固定する実装詳細である。

1. Node.js、Vite、TypeScript、テスト・lintツールの具体的な固定バージョン
2. iPhone / Androidから到達できるHTTPS配信方法
3. ブラウザ自動テストで使うfake cameraと権限付与方法
4. `requestVideoFrameCallback()`非対応時のStep 1.1用フレーム観測表示

採用結果は、確認日と公式ドキュメントへの参照を実装READMEまたは技術判断記録へ残す。

## 11. 次ステップへの引き継ぎ

Step 1.1完了後は、[技術計画の優先バックログ](./02_technical_strategy_and_plan.md#18-最初に作るべきバックログ)に従い、`HandTrackingProvider`とMediaPipe Web実装、latest-frame-only Worker経路へ進む。

その際、Step 1.1で作ったカメラ取得・状態表示・基本メトリクスを維持し、次の値を追加する。

- Worker受信時刻と待機時間
- 推論p50 / p95 / max
- 推論完了時のframe age
- 追跡出力Hzと二手カバレッジ
- 21点ランドマークと左右の手カーソル

既存の「カメラFPS」と新しい「追跡出力Hz」を混同しないことを、UIとログの両方で守る。

## 12. 実装結果（2026-07-19）

- `npm run verify`: 成功。単体テスト17件を含む。
- `npm run test:e2e`: Chromiumのfake cameraで2件成功。開始、計測更新、プレビュー切り替え、停止時のstream解放、844×390の横画面を確認した。
- `npm ci` / `npm audit`: lockfileからの再構築に成功し、既知の脆弱性は0件だった。
- 実画面確認: ローカル画面を表示し、デスクトップレイアウト、主要文言、操作導線、コンソールエラーなしを確認した。
- プライバシー: マイク要求、録画、アップロード、永続保存は実装していない。
- 未実施: PC実カメラ、iPhone 15、Google Pixel 10 Pro XLでの実カメラ確認。secure contextを満たす実機配信経路と端末が必要なため、Step 1.1の最終完了判定はこの確認後に行う。

# Phase 1 AI先行実装結果

- 実施日: 2026-07-19
- 対象: **Phase 1 — Tracking & Latency Lab / Technical Stage T0**
- ステータス: **実装・合成検証・実施準備完了、対象実機確認待ち**
- 文書種別: 実装結果と引き継ぎ。仕様の正本ではない

現在地、ゲート、試験条件は[資料ガイド](./README.md)、[ロードマップ](./03_mvp_definition_and_roadmap.md)、[POCテスト手順](./05_poc_test_protocol.md)を正本とする。本書は実機確認できない期間に先行した実装を記録するもので、P1-ControlledのPassを宣言しない。

## 1. 目的・制約・完了条件

目的は、対象実機が利用可能になった時点で、二手追跡の切り分けから30回の単体ジェスチャー制御試験、派生ログ保存までを一つのTechnical Labで実施できる状態にすることである。

制約:

- 生カメラ映像・生音声を保存、アップロード、永続化しない。
- latest-frame-onlyを維持し、古いフレームを待ち行列へ溜めない。
- 音声クロックと追跡eventTimeを描画フレームから独立させる。
- 合成入力の成功を実機の精度・遅延・同期感の合格証拠にしない。
- Phase 2の統合シーケンス、90秒MVP、演出、採点へ進まない。

実機なしでの完了条件は、以下の実装が純粋ロジック試験とブラウザ自動試験を通り、P1実施結果を正本の分類で保存できることである。

## 2. 実装したもの

### 2.1 追跡基盤の合成検証

- 0手、1手、2手、周期的追跡喪失、低速推論、回復可能なframe errorを選べるmock Worker
- 10,000フレームを投入して`in-flight <= 1`、`pending <= 1`を確認する負荷試験
- coverage、frame age、追跡状態を未計測値とゼロを混同せず集計する試験

### 2.2 Web Audio時刻

- `AudioContext({ latencyHint: "interactive" })`
- `getOutputTimestamp()`を優先したaudio context timeとperformance timeの対応
- 非対応時の`currentTime`サンプル経路
- BPM、beat、audio context timeの相互変換
- 将来時刻へ予約する120 BPMメトロノーム
- `baseLatency`、`outputLatency`、mapping sourceの表示

API値は最終的な知覚遅延を保証しない。同期感と外部遅延は実機で測る。

### 2.3 安定二手IDと派生特徴量

- MediaPipeのフレーム内`detectionIndex`から独立した`trackId`
- 予測位置とhandedness evidenceによる最大二手の割り当て
- handedness一時反転を許容する位置連続性
- 150msを初期値とする一時欠落grace
- 手のひら中心、手幅、開き具合、指先位置、実時刻ベースの速度
- 交差、検出順入れ替え、handedness反転、15/30/60Hz相当の合成試験

150ms等の数値は実測前の実装初期値であり、製品閾値ではない。

### 2.4 派生ランドマークリプレイ

- schema version付きJSON
- 21点ランドマーク、フレーム時刻、provider／model識別子
- monotonic時刻検証と入力形式検証
- 同一入力を再度取り出せる決定的なcursor
- JSONを画面で検証し、現在の単体試行条件で独立評価する回帰導線（実機試行の結果には加算しない）
- `includesCameraFrames: false`、`includesAudio: false`のプライバシー宣言

### 2.5 ジェスチャー状態機械

- エアタップ: ターゲット境界通過、速度、補間eventTime、クールダウン
- リボンスワイプ: 4方向、中心通過、軌跡長、横ずれ、timeout、補間eventTime
- クラップ／ニアクラップ: 二手収束、相対速度、最小距離、順序なし二手集合
- 短い遮蔽時のクラップ時刻予測と、追跡品質の明示
- 圧縮後の二手開放を`burst`イベントとして分離
- 同時候補が同じ動作を重複消費しない`GestureArbiter`
- 成功／拒否理由コードとconfidence／qualityの分離

閾値は合成試験用の出発点であり、実機P1の結果から一度に一項目ずつ変更する。

### 2.6 P1-Controlled実施画面

[POCテスト手順](./05_poc_test_protocol.md)の順序を30試行として固定した。

- エアタップ: 左右交互に各5回
- リボンスワイプ: 左右各3回、対角各2回
- クラップ／ニアクラップ: 実接触5回、ニアクラップ5回
- ミラー表示後の画面座標を左右・方向指示とジェスチャー判定の共通基準にする
- 実接触とニアクラップは距離閾値とイベント品質の両方で区別する
- カウント音を将来のaudio時刻へ予約し、eventTimeとの差を別値で保存
- 自動successと、player miss／machine miss／tracking loss／unclassifiedの手動分類
- false triggerの独立記録
- ジェスチャー別件数、offset p50／p95、技術指標、ID conflictのJSON集計
- カメラ映像上のリング、方向線、二手収束ガイド

### 2.7 実機確認レポート

- セッション条件、カメラ経路、二手追跡、停止・復帰を25項目へ整理
- 各項目を`pending`／`pass`／`issue`／`na`で管理
- P1-Controlledの3ジェスチャー集計、主観質問、疲労、Pass／Learn／Pivotを同じHTMLフォームへ統合
- P1セッションJSONから件数とoffset要約を自動取込
- schema 2.0の実機確認JSONを保存し、同じ画面へ読み戻して再開
- 旧schema 1.0から2.0への読み込み時移行
- Live diagnosticsの追跡Hz、推論p50／p95、frame age、coverage、queue状態を自動添付

## 3. 自動検証結果

- `npm run verify`: 成功
- 単体テスト: 16ファイル、56件成功
- production build: 成功
- Chromiumブラウザ試験: 10件成功
- MediaPipe Worker smoke、mock 0／1／2手、回復可能エラー、rVFC、P1 JSON exportを確認
- MediaPipe固定資産のSHA-256検証: 成功

## 4. 対象実機が戻った時の実施順

1. PC実カメラで鏡像、左右ラベル、21点位置、開始／停止／再開を確認する。
2. iPhone 15 / SafariとGoogle Pixel 10 Pro XL / Chromeで、端末、OS、ブラウザ完全版、frame source、delegateを記録する。
3. 各端末で60秒動かし、camera FPS、tracking Hz、in-flight／pending、replaced、推論p50／p95、frame age p95、二手coverageを保存する。
4. [POCテスト手順](./05_poc_test_protocol.md)どおりP1-Controlledを30試行実施する。
5. 結果をsuccess、player miss、machine miss、false trigger、tracking loss、unclassifiedへ分類する。
6. 両端末で各ジェスチャー8/10以上を出発点としてPass／Learn／Pivotを記録する。
7. Learnの場合は、画角、取得経路、安定ID、ジェスチャー閾値のうち次に変えるものを一つだけ選ぶ。

## 5. 実機まで保留する判断

- Safari／Chromeで実際に選ばれるframe sourceとGPU／CPU delegate
- 画面鏡像と解剖学的左右の実カメラ整合
- 解像度、30／60fps、delegateの比較
- 二手coverage、追跡Hz、frame age、熱・電力・長時間劣化
- ジェスチャー閾値とcontrolled recall
- 音との主観的な一体感
- P1-ControlledのPass／Learn／Pivot
- Phase 2移行、Web継続、OS限定、ネイティブ比較

これらを確認するまで、`docs/README.md`の現在地はPhase 1 / Step 1.1のまま維持する。

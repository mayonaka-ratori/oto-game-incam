# Phase 1 AI先行実装結果

- 実施日: 2026-07-19〜2026-07-24
- 最終更新日: 2026-09-19
- 対象: **Phase 1 — Tracking & Latency Lab / Technical Stage T0**
- ステータス: **履歴。3入力・30試行（旧clap）時点の先行実装記録。現行の試験条件（5動作・50試行、schema v6）と現在地は[資料ガイド](./README.md)と[POCテスト手順](./05_poc_test_protocol.md)の5章を見る**
- 文書種別: 実装結果と引き継ぎ。仕様の正本ではない
- 注記: 本文の「30試行」「クラップ」「schema version 2／3」「実機確認JSON schema 2.1」は2026-07時点の値である。現行は5動作・50試行、Bloom、P1結果schema v6、診断リプレイschema v3、実機確認JSON schema 2.3（[13](./13_p1_five_gesture_50_trial_revision_plan.md)の14章）

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

- 新規出力はschema version 2、旧version 1は読込互換を維持
- 21点2Dランドマーク、フレーム時刻、provider／model識別子を保存し、未使用のworld landmarkを新規出力から除外
- 試行前500msのring buffer、active trial、解決後500msをtrial windowとして記録し、セッション全時間を複製し続けない
- trialId、frame index範囲、timing、resolutionをwindow metadataへ保存
- monotonic時刻検証と入力形式検証
- 同一入力を再度取り出せる決定的なcursor
- JSONを画面で検証し、現在の単体試行条件で独立評価する回帰導線（実機試行の結果には加算しない）
- `includesCameraFrames: false`、`includesAudio: false`のプライバシー宣言

### 2.5 ジェスチャー状態機械

- エアタップ: ターゲット境界通過、速度、補間eventTime、クールダウン
- リボンスワイプ: 4方向、中心通過、軌跡長、横ずれ、補間eventTimeに加え、`armed`／`traversing`／`gap`を分離
- リボンスワイプの850ms timeoutは移動開始後だけ計測し、開始位置での待機中は進めない
- 150ms以内の一時追跡欠落は候補を維持し、超過時だけ`tracking-lost`を一度記録してrearmする
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
- 音声targetの500ms前からrecognition windowを開き、準備期間のevent／rejectionを試行結果へ混入させない
- 準備期間はリボンスワイプの開始位置armingだけを許可し、エアタップのcooldownやクラップの圧縮状態を判定期間へ持ち越さない
- window境界を跨いで補間されたeventも`eventTime`で再検証し、window外なら件数・JSONへ保存しない
- 当初はtargetまたは試行開始から30秒のdeadlineを追加した。2026-08-01のAndroid実測後、現行値は10秒へ短縮した。絶対時刻差による残り秒数と手動「未成立として次へ」は維持する
- timeoutと手動skipは`unclassified`の分母へ含め、`trial-timeout`／`manual-skip`のresolutionを保存
- success、手動分類、skip、timeoutを冪等にし、最初に確定した一件だけを保存
- 解決後は約1秒の結果表示を挟んで次のtargetを新規予約し、非表示中は連続消化しない
- 自動successと、player miss／machine miss／tracking loss／unclassifiedの手動分類
- false triggerの独立記録
- ジェスチャー別件数、offset p50／p95、resolution、試行別拒否理由、技術指標、ID conflictのJSON集計
- カメラ映像上のリング、方向線、二手収束ガイド
- 状態、残り時間、直近の拒否理由、PERFORMANCE LOWの短い注意をスマートフォン横画面へ表示

### 2.7 実機確認レポート

- セッション条件、カメラ経路、二手追跡、停止・復帰を25項目へ整理
- 各項目を`pending`／`pass`／`issue`／`na`で管理
- P1-Controlledの3ジェスチャー集計、主観質問、疲労、Pass／Learn／Pivotを同じHTMLフォームへ統合
- P1 schema version 2／3のセッションJSONから件数とoffset要約を自動取込
- P1セッションJSONへ計測端末のtechnical snapshotを同梱し、PCで記入・再出力してもスマートフォン値を保持
- 自動計測値の出所を画面表示し、必要な場合だけ現在の端末値へ明示的に戻す操作
- schema 2.1の実機確認JSONを保存し、旧schema 1.0／2.0から読み込み時移行
- Live diagnosticsの追跡Hz、推論p50／p95、frame age、coverage、queue状態を自動添付

### 2.8 スマートフォン横画面の計測作業モード

- カメラを4:3で保持し、極端な横長トリミングを回避
- カメラとP1-Controlled操作を最初の1画面へ二列配置
- 追跡状態、開始／停止、試行状態、残り時間、試行指示、直近理由、skip、手動分類、JSON保存を優先表示
- Developer overlay、全telemetry、実機確認レポートは初期画面から外し、必要時にスクロール／展開
- Live diagnosticsは折りたたんでも計測とJSON記録を継続

2026-09-14のテスター画面整理で、記入式の実機確認レポートとP1セッション比較は標準URLから完全に外した。P1結果JSONへ自動計測値を含める方針は維持し、旧レポート／比較UIは開発者向け`?view=analysis`でのみ表示する。

### 2.9 P1結果と診断リプレイの分離

- 通常のP1結果をschema version 3へ更新し、trial timing／resolution、summary、gesture event、trial diagnostic、technical snapshotをcompact JSONで保存
- 通常結果へreplay frameを埋め込まず、diagnostic replayの有無、schema、推奨ファイル名、frame数だけをmetadataとして保存
- 「診断リプレイを保存」を明示操作した場合だけ、2D landmarkのreplay v2を別ファイルで保存
- 試行解決直後の保存操作は500ms post-rollの確定を待ってから結果metadataと診断リプレイを生成する
- 通常結果のE2E上限を300KB未満として固定し、生映像・生音声・replay frame非同梱を検証

### 2.10 実験profileと複数P1セッション比較

- baselineを現行640×480、60fps ideal、30fps minimum、GPU優先として型付き定義
- 640×480 / 30fps、960×540 / 30fps、1280×720 / 30fps、640×480 / 30fps / CPU優先を未検証の比較候補として分離
- カメラ動作中はprofileを変更不可にし、P1開始後にprofileを変更した場合は新しいP1 sessionを開始するまで旧結果を保存不可
- P1結果へ、明示ID／CI commit／source hashで実装差を識別できるapp build ID、profile ID、要求した解像度／fps／delegate／model、実際の解像度／fps／facing／delegate／modelを保存
- 複数P1 JSONについて、schema、30試行、各ジェスチャー10試行、summaryとtrial resultsのoutcome／false trigger一致、重複trial、privacy、queue上限を自動検証
- build／profile混在、tracking 15Hz未満、frame age p95 140ms超、8/10未達を警告し、次に確認する一項目の候補を表示
- 2件以上が8/10を満たしても自動Passにせず、対象端末／テスター、手動分類、同期感の確認を要求

## 3. 自動検証結果

- `npm run verify`: 成功
- 単体テスト: 19ファイル、91件成功
- production build: 成功
- Chromiumブラウザ試験: 13件成功
- MediaPipe Worker smoke、mock 0／1／2手、回復可能エラー、rVFC、P1 JSON分離、skip、30件timeout完走、profile固定、複数P1比較を確認
- MediaPipe固定資産のSHA-256検証: 成功
- 844×390の実ブラウザ表示で状態、残り時間、直近理由、skipを同時表示し、skip後の一度だけ完了と約1秒後の自動進行を確認
- 実ブラウザのconsole error: なし

## 4. 対象実機が戻った時の実施順

2026-07時点の30試行の手順は現行と異なるため削除した。実機の実施順は[POCテスト手順](./05_poc_test_protocol.md)の4章と5章に従う。

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

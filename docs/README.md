# プロジェクト資料ガイド

- 更新日: 2026-09-20
- 現在のプロダクトフェーズ: **Phase 1 — Tracking & Latency Lab**
- 現在の技術ステージ: **Technical Stage T0 — Measurement Lab**
- 現在のステップ: **1.1 — TypeScript / Viteの最小Webアプリ、カメラ許可、計測画面を作る**
- 実装先行状況: **Android 4回目（縦向き、[20](./20_android_fourth_test_and_portrait_direction.md)）で、追跡の途切れの修正は実機でも効いたが、Bloomは5/10で縦向きの映像の横幅に収まらないことが分かった。これを受けて、ななめリフト、30回の新しい手順（結果JSONはschema v8）、ribbon-swipeの逆方向判定の修正、自動の速度チェックを実装した（[20](./20_android_fourth_test_and_portrait_direction.md)の6章）。処理速度は毎秒約9回のままで、実装は実機では未確認**
- テスター画面: **カメラ映像の1か所だけを見ればよい画面。映像の中に短い指示、なぞる案内、カウント、成功表示を出す。開始は「はじめる」の1ボタン、動作の切り替わりは画面のタップ、保存は「結果を保存」の1操作で2ファイル。画面の正本は[04](./04_mvp_uiux_direction.md)の3.1。分析用の画面は`?view=analysis`、速度チェックは`?mode=speedcheck`で開く**
- 次の作業: **実装後のbuildを公開し、Androidで速度チェック（`?mode=speedcheck`、約2分）と、既定の30回試行（ribbon-swipe、Lift、ななめリフト）を縦向きで行う（[20](./20_android_fourth_test_and_portrait_direction.md)の5章）。その結果からAndroidの既定の設定を決め、iPhoneでも同じ30回試行を行う**
- 旧clap分析の扱い: **[`12_p1_session_analysis_20260913144422125.md`](./12_p1_session_analysis_20260913144422125.md)の実機分析は履歴として保持する。旧clapと新Bloomを同じ第三入力の合否へ混ぜない**
- 次の判断: **2026-09-20のユーザー判断で、端末は縦向きを基本にし、横に開くBloomをやめて縦の動き（Lift）と斜めの動き（ななめリフト）を入れることにした（[20](./20_android_fourth_test_and_portrait_direction.md)の3章、正本は[03](./03_mvp_definition_and_roadmap.md)の3章と4章）。MVPの3つ目の入力は、両端末の実測を見てLiftとななめリフトから選ぶ。air-tap、Lift、Spotlightの成立確認は横向きで終えているが（[18](./18_android_second_test_and_next_plan.md)の3章）、縦向きでは未実測。タイミングと、複数動作の同時判定は、Interaction POCへ持ち越す**

Codexで作業を継続する場合、リポジトリ直下の [`AGENTS.md`](../AGENTS.md) が自動引き継ぎの入口となる。Claude Codeでは [`CLAUDE.md`](../CLAUDE.md) が入口で、そこから `AGENTS.md` を取り込む。どちらも本書を読み、現在地と依頼に関係する正本だけを確認して作業を始める。

## 今取り組むもの

計測用の最小Webアプリを作る。現時点では90秒の完成ゲームやキャラクターを作り込まない。

現在フェーズで作る成果物:

- 二手カーソルと開発用ランドマーク表示
- latest-frame-onlyのカメラ／Worker経路
- Web Audioクロックと追跡フレーム時刻の対応
- エアタップ、リボンスワイプ、Bloomの単体試験（旧クラップ実装は互換読込・履歴用）と、候補動作Lift／Spotlightの単体試験
- 端末・環境・誤認識・遅延感を残せる計測ログ

### 作業記録の一覧（仕様の正本ではない）

`07`以降は作業計画と実装記録である。仕様や合否が食い違う場合は、これらではなく「文書の正本」表の文書を優先する。新しい作業計画や分析は次の番号で追加し、済んだ文書のステータス行を「履歴」へ更新する。

| 文書 | 内容 | 状態（2026-09-19時点） |
|---|---|---|
| [17 Android実測と1画面の試験画面](./17_android_test_and_single_screen.md) | Android結果、1画面表示、自動進行、診断保存 | 履歴。Android 1回目の実測と、1画面表示（自動進行）の実装記録。画面は18で置き換えた |
| [18 Android 2回目の実測と次の修正計画](./18_android_second_test_and_next_plan.md) | Android 2回目の分析（処理速度、ribbon-swipe、Bloom）、成立確認を終えた3動作の記録、試験画面・保存・試行対象・処理速度・判定の修正計画 | **現行の作業計画と実装記録**。段階1と段階2のURL指定を実装済み、実機は未確認 |
| [19 Android 3回目の実測と認識の途切れの修正](./19_android_third_test_and_recognition_fixes.md) | Android 3回目の分析（診断リプレイで特定した追跡の途切れ、腕の疲れ）、追跡の途切れの許容・ribbon-swipeの逆方向判定・案内の修正と、実機リプレイでの再評価 | 履歴。修正は4回目の実測で確認した（20） |
| [20 Android 4回目の実測と縦向き基本への転換](./20_android_fourth_test_and_portrait_direction.md) | Android 4回目の分析（Bloomが縦向きに収まらない、ribbon-swipeの時間切れ）、縦向き基本とBloomをやめる判断、ななめリフト・新しい手順・速度チェックの計画 | **現行の実測記録と実装記録**。実機は未確認 |
| [07 Step 1.1 実装プラン](./07_step_1_1_implementation_plan.md) | 最小Webアプリ、カメラ許可、計測画面の初回実装 | 履歴。実装完了 |
| [08 追跡パイプライン実装プラン](./08_phase1_tracking_pipeline_implementation_plan.md) | HandTrackingProvider、latest-frame-only Worker、二手カーソル | 履歴。自動検証完了 |
| [09 MediaPipe資産記録](./09_mediapipe_assets.md) | モデルとWASMの出典、ハッシュ、ライセンス参照 | 現行。資産を変えたら更新 |
| [10 Phase 1 AI先行実装結果](./10_phase1_ai_preparation_implementation.md) | 実機確認前に先行した実装と未実施の実機項目。実装済みという事実だけでP1-ControlledをPassにしない | 履歴。3入力・30試行時点の記録 |
| [11 試行進行・リボンスワイプ信頼性改善](./11_phase1_trial_progression_and_swipe_reliability_plan.md) | 試行進行の不具合分析、リボンスワイプ改善、clapからBloomへの切替、Android／iPhoneの再試験記録 | 履歴。schema v4時点の記録 |
| [12 実機セッション分析 20260913144422125](./12_p1_session_analysis_20260913144422125.md) | iPhone Safariの旧clap実機セッションの分析 | 履歴。旧clapの結果を現行Bloomの合否へ混ぜない |
| [13 5動作・50試行 改訂計画](./13_p1_five_gesture_50_trial_revision_plan.md) | Bloom 10/10成立後の改訂計画と、14章の実装記録・コードレビュー後の修正 | 履歴。現在の画面は18へ |
| [14 実機セッション分析 20260916063846360](./14_p1_session_analysis_20260916063846360.md) | iPhone Safariの5動作・50試行の分析 | iPhoneの実測記録。最新のAndroid実測は18。Bloom 6/10、他4動作10/10。Phase 1は保留 |
| [15 確信度3段階フィードバック・自由記述仕分け 実装計画](./15_confidence_tier_feedback_and_comment_classification_plan.md) | typesafe.aiの調査から採用した2件（成立の余裕で演出を3段階にする、テスターの自由記述を外部AIで仕分ける）の計画と、採用しなかった候補の記録 | 計画。両端末の20回試行の比較の後にPhase 2の一部として着手。P1の合否判定と結果JSON（schema v7）は変えず、実機確認レポートには同意欄を足す |
| [16 構造の見直しと判定に触れない修正](./16_structure_review_and_lightweight_fixes.md) | 構造レビューの結論、判定側で確認した未修正の問題、判定条件を変えずに入れた修正（軽量化、schema v6の記録、Screen Wake Lock、Bloomの案内、映像枠） | **現行の実装記録**。自動検証済み、実機は未確認 |

試験手順の正本は[POCテスト手順](./05_poc_test_protocol.md)の5章であり、`13`は5動作すべてのMVP採用を確定するものではない。

現在の出口条件:

- [POCテスト手順](./05_poc_test_protocol.md)に従い、両端末で制御試験を実施できる。
- 二手追跡と各ジェスチャーの成功・拒否理由をログで説明できる。
- POC技術ゲートを通過するか、PC／ネイティブ比較等の方向転換先を決められる。

## 用語と成果物の境界

| 用語 | このプロジェクトでの意味 | 完了地点 |
|---|---|---|
| Technical Lab | カメラ、追跡、時刻、ジェスチャーを個別に測る開発画面 | Phase 1 |
| Interaction POC | 3ジェスチャーと効果音を短いシーケンスで統合し、「操作として成立するか」を見るもの | Phase 2 |
| MVP | 約90秒・1曲・Easy・セットアップからリザルトまでを備え、「体験として成立するか」を見る垂直スライス | Phase 3 |
| MVP後 | 5人以上の検証、端末拡張、追加ジェスチャー、キャラクター、配信演出等 | Phase 4以降 |

POCは技術と入力の不確実性を潰すためのもの、MVPはターゲットに新しい楽しさが伝わるかを検証するものとする。

## 文書の正本

| 判断したいこと | 正本 |
|---|---|
| 現在地、読む順序 | 本書 |
| 現行POC / MVPの範囲、ゲート、方向転換 | [03_mvp_definition_and_roadmap.md](./03_mvp_definition_and_roadmap.md) |
| POCの実施条件、記録、合否 | [05_poc_test_protocol.md](./05_poc_test_protocol.md) |
| MVPの譜面、採点、リザルト | [06_mvp_chart_scoring_spec.md](./06_mvp_chart_scoring_spec.md) |
| 技術選定、アーキテクチャ、計測 | [02_technical_strategy_and_plan.md](./02_technical_strategy_and_plan.md) |
| POC / MVPの画面、状態、フィードバック | [04_mvp_uiux_direction.md](./04_mvp_uiux_direction.md) |
| 長期的なゲームデザインとジェスチャー語彙 | [01_game_design_policy.md](./01_game_design_policy.md) |

正本同士が食い違う場合、現在のPOC / MVPについては番号の大きい補助仕様ではなく、上表でその判断を担当する文書を優先する。長期構想を理由に現行MVPのスコープを広げない。

## 推奨する読む順序

### 新しく参加するエンジニア

1. 本書
2. `03_mvp_definition_and_roadmap.md`
3. `05_poc_test_protocol.md`
4. `02_technical_strategy_and_plan.md`
5. `06_mvp_chart_scoring_spec.md`
6. `04_mvp_uiux_direction.md`
7. `01_game_design_policy.md`

### 新しく参加するプロデューサー

1. 本書
2. `03_mvp_definition_and_roadmap.md`
3. `04_mvp_uiux_direction.md`
4. `06_mvp_chart_scoring_spec.md`
5. `01_game_design_policy.md`
6. `05_poc_test_protocol.md`
7. `02_technical_strategy_and_plan.md`

## 最小用語集

- **captureTime**: カメラフレームが撮影されたとみなす時刻。
- **eventTime**: 軌跡からジェスチャーが成立したと推定する時刻。
- **frame age**: 現在時刻から見て、処理中の撮影フレームがどれだけ古いか。
- **tracking loss**: 手を検出・追跡できていない状態。プレイヤーのMISSとは分ける。
- **machine miss**: 参照条件を満たす操作が記録されているのに、システムが正しいイベントを生成しなかった状態。
- **false trigger**: 参照操作をしていないのに、システムがジェスチャーイベントを生成した状態。
- **latest-frame-only**: 古いフレームをキューに溜めず、次に処理する最新フレームだけを保持する方式。
- **出口条件**: 日程ではなく、次フェーズへ移るために必要な成果物・検証結果。

## 文書更新ルール

- フェーズが変わったら、本書冒頭の現在地と出口条件を最初に更新する。
- ゲート数値を変更したら、`03`、`05`、`02`の対応表を同時に確認する。
- MVPスコープを変更したら、`03`を先に更新し、`01`、`02`、`04`、`06`を追従させる。
- 仮説、確定仕様、条件付き分岐、将来構想を同じ箇条書きに混ぜない。

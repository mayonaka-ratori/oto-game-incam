# プロジェクト資料ガイド

- 更新日: 2026-09-19
- 現在のプロダクトフェーズ: **Phase 1 — Tracking & Latency Lab**
- 現在の技術ステージ: **Technical Stage T0 — Measurement Lab**
- 現在のステップ: **1.1 — TypeScript / Viteの最小Webアプリ、カメラ許可、計測画面を作る**
- 実装先行状況: **[13_p1_five_gesture_50_trial_revision_plan.md](./13_p1_five_gesture_50_trial_revision_plan.md)に沿って、Technical Labを5動作・50試行へ改訂した。iPhone Safariの1回目の実測は完了し、air-tap、ribbon-swipe、Lift、Spotlightは各10/10、Bloomは6/10、誤反応は0件だった。詳細は[14_p1_session_analysis_20260916063846360.md](./14_p1_session_analysis_20260916063846360.md)に記録した。Android Chromeは未実施。2026-09-19に構造を見直し、判定条件を変えない修正（画面側の処理の削減、セッション全体とブロック別の性能記録、試行ごとの向きと映像の実寸の記録、画面を消さない仕組み、Bloomの案内、映像枠の縦横比）を実装した。結果JSONはschema v6になった。詳細は[16_structure_review_and_lightweight_fixes.md](./16_structure_review_and_lightweight_fixes.md)に記録した。この修正は実機では未確認**
- テスター画面: **標準URLはカメラ、テスト音、動作見本、5ブロック・50試行、ブロック間の休憩と開始、「反応しなかったので次へ」、中断と再開、結果JSON保存、誤反応の記録へ限定する。重ね表示設定、詳細計測、手動分類、リプレイ、記入式レポート、複数セッション比較は表示せず、開発者が必要な場合だけ`?view=analysis`で全機能を開く**
- 次の作業: **Android Chromeで、iPhoneと同じprofile・閾値の5動作・50試行を実測する。buildは[16](./16_structure_review_and_lightweight_fixes.md)の修正で変わったため、端末間を同じbuildで比べるにはiPhoneも現行buildで測り直す。両端末は同じ向きで実施し、結果JSONの`trialEnvironments`で確かめる。Bloomは案内を直したので、[14](./14_p1_session_analysis_20260916063846360.md)の6/10と単純比較しない。比較が終わるまでは閾値を変えない。iPhoneの試行時の向き、疲労、分かりにくかった動作を補足し、可能なら診断リプレイでBloom 1〜4を確認する**
- 旧clap分析の扱い: **[`12_p1_session_analysis_20260913144422125.md`](./12_p1_session_analysis_20260913144422125.md)の実機分析は履歴として保持する。旧clapと新Bloomを同じ第三入力の合否へ混ぜない**
- 次の判断: **両端末の実測後、各動作の成立率、誤反応、タイミング、疲労、分かりやすさを比較し、Interaction POCへ持ち込む3〜4動作を選ぶ。iPhoneではLiftが最も安定し、Spotlightも成立した。Bloomは6/10だった。見本とカメラ上の案内は[16](./16_structure_review_and_lightweight_fixes.md)の3.4で直したので、次の実測でBloomが8/10に届かない場合は、準備範囲と追跡切れのどちらを直すかを診断後に一つへ絞る。追跡喪失はプレイヤーMISSへ分類しない。判定の座標が映像の縦横比と向きに左右される問題など、判定の物差しを変える修正（[16](./16_structure_review_and_lightweight_fixes.md)の2.2）は、両端末の実測後、Interaction POCへ入る前に扱う**

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
| [07 Step 1.1 実装プラン](./07_step_1_1_implementation_plan.md) | 最小Webアプリ、カメラ許可、計測画面の初回実装 | 履歴。実装完了 |
| [08 追跡パイプライン実装プラン](./08_phase1_tracking_pipeline_implementation_plan.md) | HandTrackingProvider、latest-frame-only Worker、二手カーソル | 履歴。自動検証完了 |
| [09 MediaPipe資産記録](./09_mediapipe_assets.md) | モデルとWASMの出典、ハッシュ、ライセンス参照 | 現行。資産を変えたら更新 |
| [10 Phase 1 AI先行実装結果](./10_phase1_ai_preparation_implementation.md) | 実機確認前に先行した実装と未実施の実機項目。実装済みという事実だけでP1-ControlledをPassにしない | 履歴。3入力・30試行時点の記録 |
| [11 試行進行・リボンスワイプ信頼性改善](./11_phase1_trial_progression_and_swipe_reliability_plan.md) | 試行進行の不具合分析、リボンスワイプ改善、clapからBloomへの切替、Android／iPhoneの再試験記録 | 履歴。schema v4時点の記録 |
| [12 実機セッション分析 20260913144422125](./12_p1_session_analysis_20260913144422125.md) | iPhone Safariの旧clap実機セッションの分析 | 履歴。旧clapの結果を現行Bloomの合否へ混ぜない |
| [13 5動作・50試行 改訂計画](./13_p1_five_gesture_50_trial_revision_plan.md) | Bloom 10/10成立後の改訂計画と、14章の実装記録・コードレビュー後の修正 | **現行の作業計画**。iPhone実測済み、Android実測待ち |
| [14 実機セッション分析 20260916063846360](./14_p1_session_analysis_20260916063846360.md) | iPhone Safariの5動作・50試行の分析 | **現行の実測記録**。Bloom 6/10、他4動作10/10。Phase 1は保留 |
| [15 確信度3段階フィードバック・自由記述仕分け 実装計画](./15_confidence_tier_feedback_and_comment_classification_plan.md) | typesafe.aiの調査から採用した2件（成立の余裕で演出を3段階にする、テスターの自由記述を外部AIで仕分ける）の計画と、採用しなかった候補の記録 | 計画。Android実測後にPhase 2の一部として着手。P1の合否判定と結果JSON（schema v6）は変えず、実機確認レポートには同意欄を足す |
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

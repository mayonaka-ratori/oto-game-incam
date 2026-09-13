# プロジェクト資料ガイド

- 更新日: 2026-09-14
- 現在のプロダクトフェーズ: **Phase 1 — Tracking & Latency Lab**
- 現在の技術ステージ: **Technical Stage T0 — Measurement Lab**
- 現在のステップ: **1.1 — TypeScript / Viteの最小Webアプリ、カメラ許可、計測画面を作る**
- 実装先行状況: **air-tap／ribbon-swipeを維持し、第三入力を実接触前提の旧clapから、中央準備後に両手を左右斜め上へ開くBloomへ切り替えた。現行P1結果はschema v4で第三入力を明示し、旧v2／v3 clap結果は別語彙として読み込む**
- テスター画面: **標準URLはカメラ、テスト音、動作見本、30試行、結果JSON保存、誤反応の記録へ限定する。重ね表示設定、詳細計測、手動分類、リプレイ、記入式レポート、複数セッション比較は表示せず、開発者が必要な場合だけ`?view=analysis`で全機能を開く**
- 次の作業: **最新のBloom実機結果を受け、[13_p1_five_gesture_50_trial_revision_plan.md](./13_p1_five_gesture_50_trial_revision_plan.md)に沿ってTechnical Labを5動作・50試行へ改訂する。Bloomへ準備完了後に合図する進行を追加し、新候補Lift／Spotlightを各10回実測できるようにする。5動作すべてをMVP採用とはせず、実測後に3〜4動作へ絞る**
- 旧clap分析の扱い: **[`12_p1_session_analysis_20260913144422125.md`](./12_p1_session_analysis_20260913144422125.md)の実機分析は履歴として保持する。旧clapと新Bloomを同じ第三入力の合否へ混ぜない**
- 次の判断: **5動作・50試行の実測後、各動作8/10以上、誤発火、タイミング、疲労、分かりやすさを比較し、Interaction POCへ持ち込む3〜4動作を選ぶ。Bloomは準備状態の改訂効果を別に確認し、追跡喪失はプレイヤーMISSへ分類しない**

Codexで作業を継続する場合、リポジトリ直下の [`AGENTS.md`](../AGENTS.md) が自動引き継ぎの入口となる。Claude Codeでは [`CLAUDE.md`](../CLAUDE.md) が入口で、そこから `AGENTS.md` を取り込む。どちらも本書を読み、現在地と依頼に関係する正本だけを確認して作業を始める。

## 今取り組むもの

計測用の最小Webアプリを作る。現時点では90秒の完成ゲームやキャラクターを作り込まない。

現在フェーズで作る成果物:

- 二手カーソルと開発用ランドマーク表示
- latest-frame-onlyのカメラ／Worker経路
- Web Audioクロックと追跡フレーム時刻の対応
- エアタップ、リボンスワイプ、Bloomの単体試験（旧クラップ実装は互換読込・履歴用）
- 端末・環境・誤認識・遅延感を残せる計測ログ

実機確認できない期間に先行した実装と、未実施の実機項目は[Phase 1 AI先行実装結果](./10_phase1_ai_preparation_implementation.md)にまとめる。この実装済みという事実だけでP1-ControlledをPass扱いにはしない。

現在の最優先再試験は[Phase 1 試行進行・リボンスワイプ信頼性改善 実装計画](./11_phase1_trial_progression_and_swipe_reliability_plan.md)を正とする。実機途中結果、原因分析、実装内容、schema方針、テスト、再試験記録欄を同文書へ集約している。

最新のiPhone Safari実機セッションの分析と改善プランは、[P1-Controlled 実機セッション分析](./12_p1_session_analysis_20260913144422125.md)に記録している。

Bloom 10/10成立後の次回改訂方針は、[Phase 1 — 5動作・50試行 改訂計画](./13_p1_five_gesture_50_trial_revision_plan.md)に記録している。現行正本の3動作・30試行を実装時に改訂するための計画であり、5動作すべてのMVP採用を確定するものではない。

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

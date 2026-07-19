# MediaPipe資産記録

- 確認日: 2026-07-19
- npm package: `@mediapipe/tasks-vision@0.10.35`
- task: Hand Landmarker / full / float16 / version 1
- 公式配布元: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- model size: `7,819,105 bytes`
- model SHA-256: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`
- Model Card / license: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf

WASMは固定npm packageの`wasm/`から`public/mediapipe/wasm/`へコピーする。モデルとWASMの個別ハッシュは`scripts/prepare-mediapipe-assets.mjs`を正とし、`npm run assets:prepare`で配置、build前の`npm run assets:verify`で不足・不一致を検出する。build時のネットワーク取得は行わない。

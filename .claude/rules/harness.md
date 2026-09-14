---
paths:
  - ".claude/**"
  - "CLAUDE.md"
  - "AGENTS.md"
---

# ハーネス（`.claude/`）を編集するときの決まり

- hooks は `node` の ESM スクリプトで、依存パッケージを使わず `node:` 組み込みだけで書く。`npm ci` 前でも壊れないようにする。
- hook は問題がないときは exit 0 で何も出さない。Claude へ差し戻すときだけ exit 2 で、stderr に「何が失敗したか」と「直し方」を日本語で書く。
- Stop hook は `stop_hook_active` が true のとき（自分の差し戻しで再入したとき）は必ず exit 0 で抜ける。無限ループを防ぐため。
- SessionStart hook は `docs/README.md` 冒頭の箇条書きをそのまま出す。README の箇条書きの形（`- ` で始まる連続行）を変えるときは `hooks/session-context.mjs` も直す。
- permissions は `allow` に読み取り系と検証コマンドだけ、`ask` に依存関係の変更と `git commit`、`deny` に `git push` と履歴を壊す操作とハッシュ固定資産の編集を置く。`allow` へ書き込み系や公開系を足さない。
- skills の frontmatter は `name` `description` `allowed-tools`（スペース区切り）だけを基本にする。引数は `$ARGUMENTS` か `arguments:` の名前付きで受ける。
- agents の `model` は、判断が要る点検なら `opus`、複数文書をまたぐ照合なら `fable`。書き込みが不要なら `tools` を `Read, Grep, Glob` に限る。
- `.claude/` を変えたら `CLAUDE.md` の「ハーネス」節を同じ変更で更新する。設定の中身をそこへ複製せず、何があるかと何が自動で走るかだけ書く。
- 個人の設定は `.claude/settings.local.json` と `CLAUDE.local.md` に書く（両方とも `.gitignore` 済み）。

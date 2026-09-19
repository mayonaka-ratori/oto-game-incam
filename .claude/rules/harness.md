---
paths:
  - ".claude/**"
  - "CLAUDE.md"
  - "AGENTS.md"
---

# ハーネス（`.claude/`）を編集するときの決まり

- 毎回読み込まれるのは `CLAUDE.md`、そこから取り込む `AGENTS.md`、SessionStart hookの出力、skillsとagentsのdescriptionである。ここへ足す文は「どの作業でも要るか」で決め、特定の分野だけで要る決まりは `rules/` の該当ファイルへ置く。同じ決まりを2か所へ書かない。
- `AGENTS.md` はCodexと共用で、Codexには `rules/` もhooksもない。Codexにも要る原則は `AGENTS.md` に置き、`rules/` にはそこへ足す具体だけを書く。
- hooks は `node` の ESM スクリプトで、依存パッケージを使わず `node:` 組み込みだけで書く。`npm ci` 前でも壊れないようにする。
- hook は問題がないときは exit 0 で何も出さない。Claude へ差し戻すときだけ exit 2 で、stderr に「何が失敗したか」と「直し方」を日本語で書く。
- Stop hook は `stop_hook_active` が true のとき（自分の差し戻しで再入したとき）は必ず exit 0 で抜ける。無限ループを防ぐため。通った時点の変更ファイルの指紋を `node_modules/.cache/claude-stop-verify.json` に残し、同じ指紋なら検証を省く。
- SessionStart hook は `docs/README.md` 冒頭の箇条書きと「文書の正本」表を、リンクの行き先だけ落として出す（文脈の圧縮後にも出し直す）。README の箇条書きの形（`- ` で始まる連続行）や表の見出し（`## 文書の正本`）を変えるときは `hooks/session-context.mjs` も直す。
- permissions は `allow` に読み取り系と検証コマンドだけ、`ask` に依存関係の変更と `git commit`、`deny` に `git push` と履歴を壊す操作とハッシュ固定資産の編集を置く。`allow` へ書き込み系や公開系を足さない。
- skills の frontmatter は `name` `description` `allowed-tools`（スペース区切り）だけを基本にする。引数は `$ARGUMENTS` か `arguments:` の名前付きで受ける。
- agents の `model` は、判断が要る点検なら `opus`、複数文書をまたぐ照合で取りこぼしが出たら `fable`。書き込みが不要なら `tools` を `Read, Grep, Glob` に限る。自分の指示だけで完結する点検役は `omitClaudeMd: true` で `CLAUDE.md` の読み込みを省く。
- 文書番号や日付のように古くなる値を、skillsやagentsの手順へ直接書かない。`docs/README.md` の一覧や表を参照させる。
- `.claude/` を変えたら `CLAUDE.md` の「ハーネス」節を同じ変更で更新する。設定の中身をそこへ複製せず、何があるかと何が自動で走るかだけ書く。
- 個人の設定は `.claude/settings.local.json` と `CLAUDE.local.md` に書く（両方とも `.gitignore` 済み）。

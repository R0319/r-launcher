# R-Launcher

mc-shouchan の参加型サーバー用の Minecraft ランチャー（v2）。サーバーの管理は [mc-panel](https://github.com/R0319) が行い、
ランチャーは mc-panel が公開するサーバーの一覧と Mod 構成を読んで、同じ構成で起動する。

## できること

- **サーバーの一覧と状態**: 稼働中か、参加人数、遅延（Server List Ping）、MOTD。
- **Mod の自動同期**: サーバーの Mod のうち、クライアントに必要なもの（必須）と任意のものを自動でそろえる。サーバー専用の Mod は入れない。ダウンロードしたファイルはハッシュを確かめてから置く。
- **構成チェック**: 起動前に mods フォルダをサーバーの構成と照らし合わせ、管理者の設定に従って警告または起動禁止にする。余分な Mod はボタン 1 つで mods-disabled に退避できる（削除はしない）。
- **リソースパック・シェーダー**: Modrinth から検索して入れ、有効・無効を切り替える（シェーダーはサーバーの構成に Iris / Oculus があるときだけ）。
- **Java**: Minecraft の版に合う Java を自動で用意する（Mojang 公式の配布物）。指定した Java も使える。メモリと JVM 引数を設定できる。
- **Discord**: アカウント連携（管理画面のプレイヤー一覧に Discord 名が出る）と、遊んでいるサーバー名のステータス表示。
- **見た目**: ライト・ダーク・OS に合わせる、差し色 5 種、背景画像と暗さ。
- **ログ**: ランチャーとゲームのログを表示。共有するときはトークン・UUID・アカウント名・PC のユーザー名・IP・メールを伏せてコピー／保存する。
- **自動更新**: GitHub Releases から。

## 構成

- **launcher/** — Electron + TypeScript（main / preload / renderer は React + Vite）。ゲームの起動は [eml-lib](https://github.com/Electron-Minecraft-Launcher/EML-Lib)。
- **verification-mod/** — NeoForge 1.21.1 のクライアント Mod 検証 Mod（rverify）。v1 の EC2 用のまま（下の「未対応」参照）。

v1 の EC2 バックエンド（`server/`）は mc-panel に置き換えたので撤去した。

mc-panel との約束は mc-panel の `docs/launcher-api.md`、画面の方針は [launcher/docs/design.md](launcher/docs/design.md)。

## ダウンロード（利用者向け）

[Releases](../../releases) から `R-Launcher-Setup-x.y.z.exe` を取得してインストールしてください。

> コード署名をしていないため、初回起動時に Windows SmartScreen の警告が出ます。「詳細情報」→「実行」で起動できます。

## 開発

```bash
cd launcher
npm install
npm test              # 単体テスト・画面のテスト
npm run typecheck
npm start             # ビルドして Electron で起動（開発中は %APPDATA%\r-launcher-dev を使う）
npm run dev:renderer  # 画面だけをブラウザで確認（偽の本体で動く。?integrity=warn などで状態を変えられる）
npm run dist          # 配布用 .exe を release/ に生成
```

ローカルの mc-panel（`npx tsx scripts/dev-demo.ts`）に向けるときは、`.env` に `ALLOW_HTTP_LOCALHOST=1` を書き、設定の Panel の URL を `http://localhost:8080` にする。
`npx tsx scripts/e2e-panel.ts http://localhost:8080` で、実際の Panel と Modrinth を相手に同期・構成チェック・パック導入を通しで確かめられる（ゲームは起動しない）。

## セキュリティ

- 画面（renderer）は sandbox・contextIsolation・nodeIntegration 無効。CSP で外部への通信を禁止し、外部とのやり取りはすべて main プロセスで行う。
- IPC は自分の画面からの呼び出しだけを受け付け、引数はすべて zod で検証する。
- ダウンロードは https のみ。Mod は cdn.modrinth.com・edge.forgecdn.net・mediafilez.forgecdn.net だけから取り、リダイレクトのたびに確かめる。ハッシュが合わないファイルは置かない。
- アカウントのトークンは OS の暗号化（safeStorage）を通して保存し、使えない環境ではディスクに書かない。ログに書く前にトークンを消す。
- Discord 連携では Minecraft のトークンを mc-panel に送らない（Mojang の join / hasJoined で本人確認する）。
- 利用者が自分で入れた Mod は、利用者が押したとき以外は動かさない。消すものは OS のごみ箱か退避フォルダへ。

## Microsoft ログインについて

既定では eml-lib の既定（公式 Minecraft ランチャーの Client ID）でログインしている。自前の Azure アプリでログインするには、
Mojang の審査（[aka.ms/mce-reviewappid](https://aka.ms/mce-reviewappid)）を通す必要がある（通るまでは 403 になる）。通ったら、
ビルド時の環境変数 `MSA_CLIENT_ID` に Client ID を入れて切り替える。アプリ名に「Minecraft」は使えない。

## 未対応・今後

- rverify（サーバー側の検証 Mod）は v1 の manifest（sha256）を読む。mc-panel の `launcher.json`（sha1）に合わせる改修と、rverify 自体の配布方法（mc-panel は Modrinth / CurseForge のファイルしか配らない）を決める必要がある。
- CurseForge のリソースパック・シェーダー検索（API キーをランチャーに埋め込めないため、mc-panel 経由にする必要がある）。

## ライセンス

UNLICENSED（個人プロジェクト）

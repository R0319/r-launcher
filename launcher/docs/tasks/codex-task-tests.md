# 作業指示: R-Launcher v2 のテスト（main の組み立て部分と画面）とセキュリティの確認

Claude が書いた main プロセスの組み立て部分と画面に、テストを足す。テストで不具合が見つかったら、**最小限の修正**をして最終報告に書く。

- 規約は `docs/tasks/codex-task-core-modules.md` の冒頭と同じ（TypeScript strict・`any` 禁止・Prettier・日本語コメント・ネットワークを使わない）。
- `src/renderer/styles.css` は Claude が同時に直しているので**変更しない**。それ以外のファイルの修正は不具合の修正だけにする（設計の変更はしない）。
- 画面のテストは `// @vitest-environment jsdom` を先頭に書き、`src/renderer/mockApi.ts` の `createMockApi` と `src/renderer/api.ts` の `setApi` で偽の本体を差し込む。

## テストを書く対象

main（Node 環境）:

| ファイル         | 確かめること                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.ts`       | 暗号化できるときだけトークンを書く（ファイルに平文のトークンが無いこと）、暗号化できないときはメモリだけに持つ、v1 の store.json からの引き継ぎ（設定・保存先・Discord 名。v1 のトークンは捨てる）、壊れた JSON                                                  |
| `panel.ts`       | `normalizePanelUrl`（https のみ・localhost の http・認証情報やクエリ付きの拒否）、`listPacks` が壊れた 1 件を飛ばす、`manifest` が別 ID の応答を拒否                                                                                                             |
| `addons.ts`      | 偽の Http で検索・インストール（sha512 / sha1 の照合、不一致で置かない、.zip 以外を拒否、許可ホスト）、有効化（options.txt / iris.properties）、削除が trash を呼び設定から外す、`inside` のパス外拒否                                                           |
| `background.ts`  | 形式の判定（PNG/JPEG/WebP 以外・偽の拡張子）、10MB 超、`resolveBackgroundRequest` が `..`・別ホスト・別スキーム・不正な名前を拒否                                                                                                                                |
| `discordLink.ts` | 流れ全体（start → join → verify → openExternal → status 待ち）、`isDiscordAuthorizeUrl` が他のホスト・http・別パスを拒否、join 失敗、期限切れ、Minecraft のトークンを Panel への要求に含めないこと                                                               |
| `launch.ts`      | `stripSecrets`（--accessToken・--clientId・--xuid・JWT）、`emlConfig`（auto/manual の Java、メモリの min≦max、cleaning 無効）                                                                                                                                    |
| `logs.ts`        | 行数の上限、previous.log への回転、購読と解除                                                                                                                                                                                                                    |
| `service.ts`     | 偽の Platform・Http で: state、saveSettings（不正な Panel URL を拒否・appearance/java の部分更新）、listServers の installed、setOptionalMod（required は拒否）、retireExtraMods（利用者の jar だけを mods-disabled へ。managed は動かさない）、`shaderConfigOf` |
| `play.ts`        | 偽の launch で: Mod の同期 → 起動、構成チェック warn は force なしで止まり force で進む、block は force でも止まる、JVM 引数・メモリの不正で止まる、二重起動を拒否、起動前に終了したらエラー                                                                     |
| `features.ts`    | ログのコピーが伏せ字になること（アカウント名・ホームフォルダ・トークン）、シェーダーローダーが無いとシェーダーを入れられない                                                                                                                                     |
| `ipcRoutes.ts`   | すべてのチャンネルで、信頼できない送信元を拒否、不正な引数（ID・ファイル名・projectId・設定）を拒否、例外の文からスタックや複数行が落ちること                                                                                                                    |

画面（jsdom）:

- 初回設定（保存先を選ぶまで「始める」が押せない）、サーバー一覧と選択、状態・人数・遅延の表示。
- Mod タブ（必須・任意・サーバーのみ。任意の切り替え）。
- シェーダー／リソースパックのタブ（検索・入れる・外す・有効の切り替え）。
- 遊ぶ（進み具合の表示、構成チェックの warn ダイアログで「それでも遊ぶ」、block では出ない、余分な Mod を外す）。
- 未ログインで遊ぶを押すと設定へ。
- 設定（テーマ・差し色・JVM 引数の検証エラー表示・Discord 連携）。
- ログ（伏せてコピーの結果表示、絞り込み）。

静的な確認（テストで）:

- `src/renderer/index.html` の CSP に `connect-src 'none'`・`script-src 'self'`・`object-src 'none'` があり、`unsafe-eval` が無い。
- `src/main/index.ts` の BrowserWindow 設定に `contextIsolation: true`・`nodeIntegration: false`・`sandbox: true` があり、`setWindowOpenHandler` が deny を返す（ソースの文字列で確かめてよい）。

## 完了条件

- `npm test`・`npm run typecheck`・`npx prettier --check src` が通る。
- 最終報告（日本語）: 足したテストの数、見つけた不具合と直した内容、直さなかった懸念。git commit はしない。

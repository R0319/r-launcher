# R-Launcher Verify (rverify)

参加型サーバー用のクライアントMOD検証MOD（NeoForge 1.21.1）。ランチャーを経由せず
Minecraft から直接接続してくる経路の穴埋めとして、接続時にクライアントの `mods/` 一覧と
SHA-256 をサーバー側 manifest と照合し、不一致なら接続を拒否する。

## 仕組み

1. 接続の **configuration フェーズ**でサーバーがクライアントに MOD 一覧を要求
2. クライアントが `mods/*.jar` のファイル名＋SHA-256 を返す
3. サーバーが EC2 の `/modpacks/:id/manifest` を取得し照合
   - manifest の `required_both` / `client_required` にあるのにクライアントに無い → **不足**
   - クライアントにあるが manifest のどれとも一致せず許可リストにも無い → **余分**
   - どちらかあれば configuration を切断（kick）
4. manifest 取得に失敗したときは **fail-open**（全員締め出さない。強制の本体は launcher 側）

## ローダー/バージョン移植方針

意図的に2層に分離している:

- `jp.r0319.rverify.core` … **ローダー非依存の純Java**（manifest取得・ハッシュ照合・判定）。
  Forge/Fabric/Quilt でもそのまま流用可能。
- それ以外（`network` / `client` / `server` / `RVerifyMod` / `RVerifyConfig`）… **NeoForge依存のグルー層**。
  ローダー変更時はここだけ書き直せばよい。

MCバージョン変更（例 1.21.1 → 1.21.4）は `gradle.properties` の
`minecraft_version` / `neo_version` / `parchment_*` を更新し、API破壊があれば直す。

## ビルド

**JDK 21 が必要**（MC 1.21.1 の要件）。Eclipse Temurin 21 か Microsoft OpenJDK 21 を推奨。

```bash
# verification-mod/ で
./gradlew build          # Windows は .\gradlew.bat build
# 成果物: build/libs/rverify-1.0.0.jar
```

> 注: 開発環境にJDKが無い状態でコードを書いたため、初回ビルドで NeoForge の
> ネットワークAPI（configuration タスクのイベントバス、payload codec 周り）に
> 微修正が要る可能性がある。コンパイルエラーが出たら該当箇所を合わせる。

## 導入と設定

1. ビルドした `rverify-1.0.0.jar` を **Minecraftサーバーの `mods/`** に置く
2. 同じ jar を **modpack の manifest に `required_both` として登録**（管理画面からアップロード）。
   これで launcher が全クライアントへ配布し、正規接続では常に一致する
3. サーバー初回起動後、`world/serverconfig/rverify-server.toml` を編集:
   - `manifestUrl` … 照合先（例 `http://127.0.0.1:3000/modpacks/main/manifest` / 本番は EC2 の公開URL）
   - `allowedFileNamePatterns` … 許可するクライアント専用MODの部分一致（例 `iris,sodium`。`rverify` は既定で許可）
   - `kickHeader` … kick メッセージ先頭行

## 制約

- サーバーは接続時にクライアントの MOD **ID/バージョンは見えるがファイルハッシュは受け取れない**ため、
  本MODが独自パケットでハッシュを送らせている（＝クライアントにも本MODが必須）。
- 本MODを持たない素の Minecraft クライアントは、NeoForge の必須MOD不一致判定により
  そもそも接続段階で弾かれる（required MOD の欠如）。

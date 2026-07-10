# R-Launcher

Minecraft の参加型サーバー用の独自ランチャー。Microsoft 認証で NeoForge を起動し、
サーバーの modpack と MOD を自動同期する。サーバー側にはクライアント MOD 検証（rverify）を備える。

## 構成

- **launcher/** — Electron + TypeScript のランチャー本体（Microsoft OAuth、Discord 連携、MOD 同期、NeoForge 起動、管理者 UI、シェーダー導入）
- **server/** — Fastify + TypeScript のバックエンド API（modpack / manifest 配信、MOD 配布、プレイヤー登録、管理者機能）
- **verification-mod/** — NeoForge 1.21.1 のクライアント MOD 検証 MOD（rverify）。接続クライアントの MOD 一覧と SHA-256 をサーバー側 manifest と照合し、不一致は接続を拒否する

## ダウンロード（利用者向け）

[Releases](../../releases) から `R-Launcher-Setup-x.y.z.exe` を取得してインストールしてください。

> 現在はコード署名を行っていないため、初回起動時に Windows SmartScreen の警告が出ます。
> 「詳細情報」→「実行」で起動できます。

## 開発

### ランチャー
```bash
cd launcher
npm install
npm start          # 開発起動（.env の API_BASE_URL=http://localhost:3000 で開発サーバーへ）
npm run dist       # 配布用 .exe を release/ に生成
```

### サーバー
```bash
cd server
npm install
cp .env.example .env   # 値を設定（DB_DRIVER=file でローカルは MariaDB 不要）
npm run dev
```

### 検証 MOD
```bash
cd verification-mod
./gradlew build    # JDK 21 必須。build/libs/rverify-1.0.0.jar を生成
```

## ライセンス

UNLICENSED（個人プロジェクト）

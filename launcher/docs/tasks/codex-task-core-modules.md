# 作業指示: ランチャーの部品（main プロセスの純粋なモジュール）

R-Launcher v2（Electron）の main プロセスで使う、Electron に依存しない部品を作る。Claude が同時に画面・IPC・起動まわりを書いているので、**下に挙げたファイル（と同名の .test.ts）以外は作らない・変えない**。

- 言語: TypeScript strict（`noUncheckedIndexedAccess` あり）。`any` 禁止。`electron` を import しない（Node 標準と `zod` と `src/shared/*` だけ）。
- 書き方: Prettier（`.prettierrc.json`: セミコロンなし・シングルクォート・幅 100）。コメントは日本語で、何のためにそうしているかを短く。
- 型の正は `src/shared/contract.ts`（mc-panel との契約。`docs` は mc-panel リポジトリの `docs/launcher-api.md`）と `src/shared/settings.ts`。これらは変えない。
- テスト: vitest（`npm test`）。ネットワークは使わない（偽の fetch・ローカルの net.Server を使う）。一時フォルダは `os.tmpdir()` の下に作って後始末する。

## 1. `src/main/mask.ts` — ログの個人情報を隠す

```ts
export type MaskKind = 'token' | 'uuid' | 'player' | 'path' | 'ip' | 'email' | 'discord'
export function maskLog(text: string, ctx?: { names?: string[]; homeDir?: string }): { text: string; counts: Record<MaskKind, number> }
```

隠すもの（置き換え後の文字列も固定にする）:
- トークン類 → `<token>`: `--accessToken <値>`、`"accessToken":"…"`、`accessToken=…`、`Bearer …`、JWT 形式（`eyJ…​.…​.…`）、`Session ID is token:…`、`--clientId <値>`、`--xuid <値>`、`xuid=…`、Discord のボットトークン形式。
- UUID（ハイフンあり・なしの 32 桁 16 進）→ `<uuid>`。
- `ctx.names`（プレイヤー名など、大文字小文字を区別せず単語として一致）→ `<player>`。`Setting user: 名前`、`--username 名前` も。
- ユーザーフォルダ → `C:\Users\<user>`（`ctx.homeDir` と、一般形 `C:\Users\名前\`・`/home/名前/`・`/Users/名前/`）。
- IP アドレス（IPv4・IPv6。127.0.0.1・0.0.0.0・::1 は残す）→ `<ip>`。
- メールアドレス → `<email>`。

テスト: 実際の Minecraft / NeoForge の起動ログ風の文を十数行用意し、上のすべてが消え、ほかの行（スタックトレース・Mod 名・バージョン）は変わらないこと。同じ入力に 2 回かけても変わらない（冪等）。

## 2. `src/main/serverPing.ts` — サーバーの状態（Server List Ping）

```ts
export interface PingResult { online: number; max: number; motd: string; version: string; protocol: number; latencyMs: number }
export async function pingServer(host: string, port: number, opts?: { timeoutMs?: number; resolveSrv?: (host: string) => Promise<{ name: string; port: number } | null>; connect?: typeof net.connect }): Promise<PingResult>
```

- 1.7 以降の Status プロトコル（Handshake next state 1 → Status Request → Status Response の JSON → Ping/Pong で遅延）。VarInt の読み書き、分割された受信、応答の上限 64KB、既定タイムアウト 5 秒。
- port が 25565 のときだけ `_minecraft._tcp.<host>` の SRV を引く（`resolveSrv` を注入できるように。既定は `dns.promises.resolveSrv`、失敗は無視）。
- MOTD は文字列でもチャットコンポーネント（`text`・`extra`）でも平文にし、`§` の書式コードを除く。
- テスト: ローカルの `net.createServer` で偽サーバーを立て、正常・分割受信・タイムアウト・壊れた応答・巨大な応答・コンポーネント形式の MOTD。

## 3. `src/main/discordRpc.ts` — Discord Rich Presence

```ts
export interface Activity { details?: string; state?: string; startTimestamp?: number; largeImageKey?: string; largeImageText?: string }
export class DiscordRpc {
  constructor(opts: { clientId: string; pipePath?: (index: number) => string; connect?: typeof net.connect })
  connect(): Promise<boolean>        // 0〜9 番のパイプを順に試し、ハンドシェイク（op 0, {v:1, client_id}）。失敗しても例外を投げず false
  setActivity(activity: Activity | null): Promise<boolean>  // op 1 SET_ACTIVITY（pid は process.pid、nonce は乱数）。null で消す
  close(): void
}
```

- フレームは op（int32 LE）＋長さ（int32 LE）＋JSON。既定のパイプは Windows `\\?\pipe\discord-ipc-N`、それ以外 `$XDG_RUNTIME_DIR` / `$TMPDIR` / `/tmp` の `discord-ipc-N`。
- 文字列は Discord の上限（128 文字）で切る。
- テスト: 一時パスで偽の IPC サーバーを立て、ハンドシェイク・SET_ACTIVITY の中身・Discord が無いときに false・切断後に false。

## 4. `src/main/gameOptions.ts` — リソースパックとシェーダーの有効化

```ts
export function readResourcePacks(optionsTxt: string): string[]
export function setResourcePacks(optionsTxt: string, enabled: string[]): string   // enabled は "file/xxx.zip" の形
export function readIrisShader(props: string): { enabled: boolean; pack: string | null }
export function setIrisShader(props: string, pack: string | null): string        // shaderPack= と enableShaders=
```

- options.txt の `resourcePacks:[…]` は JSON 配列。`vanilla`（と `fabric`・`mod_resources` のような既存の組み込みパック）は残し、順番は「組み込み → enabled の順」。`incompatibleResourcePacks` から enabled のものを外す。ほかの行は一字一句変えない。行が無ければ足す。改行コード（CRLF/LF）を保つ。
- パック名に `"`・改行・`..`・`/`（`file/` の後）を含むものは受け付けない（例外）。
- iris.properties（Oculus も同じ形式）は `key=value`。`shaderPack` と `enableShaders` だけを変える。
- テスト: 既存の設定の保持、CRLF、壊れた行、不正な名前の拒否。

## 5. `src/main/javaArgs.ts` — JVM 引数とメモリ

```ts
export function parseJvmArgs(input: string): { ok: true; args: string[] } | { ok: false; error: string }
export function memoryPlan(totalMb: number): { maxAllowedMb: number; recommendedMb: number }
export function validateMemory(minMb: number, maxMb: number, totalMb: number): string | null   // 問題があれば日本語の理由
```

- 空白区切り、ダブルクォートでくくれる。拒否: 改行・NUL、`-` で始まらない語、`-Xmx`/`-Xms`/`-XX:MaxRAM`（メモリは設定欄で決める）、`-jar`・`-cp`・`-classpath`・`--class-path`・`-javaagent`・`-agentlib`・`-agentpath`・`-Djava.class.path`、64 個超、1 語 500 文字超。エラー文は日本語で、どの語が駄目かを書く。
- memoryPlan: OS の総メモリのうち 2GB は残す（最大 = 総量−2048、下限 1024）。推奨は総量に応じて 4096〜8192 の範囲で決める。
- テスト。

## 6. `src/main/integrity.ts` — 構成チェック（サーバーと同じ構成か）

```ts
export interface LocalJar { fileName: string; sha1: string }
export interface IntegrityReport {
  verdict: 'ok' | 'warn' | 'block'
  missing: ManifestMod[]                          // 入っているべき required が無い
  mismatched: Array<{ mod: ManifestMod; fileName: string }>  // 名前は一致するが中身が違う
  extras: Array<{ fileName: string; allowed: boolean }>      // マニフェストに無い jar
}
export function checkIntegrity(input: { manifest: LauncherManifest; disabledOptional: ReadonlySet<string>; local: LocalJar[] }): IntegrityReport
```

- 照合はハッシュ（sha1）で行う。ファイル名が違っても中身が同じなら一致とみなす。
- optional は、入っていても入っていなくてもよい（入っているなら中身が一致すること）。利用者が外した optional が残っていれば extras ではなく mismatched でもなく「無視」。
- 余分な jar は `allowExtraMods` か `allowedExtraPatterns`（小文字のファイル名の部分一致）で allowed。
- verdict: 問題（missing・mismatched・allowed でない extras）が 1 つでもあれば mode に従い warn / block。mode が off なら常に ok（中身の報告はする）。
- テスト: 各パターンと mode ごと。

## 7. `src/main/modSync.ts` — Mod の同期（サーバーと同じ構成にそろえる）

```ts
export interface SyncPlan { download: ManifestMod[]; retire: string[]; keep: string[] }
export function planSync(input: { manifest: LauncherManifest; disabledOptional: ReadonlySet<string>; local: LocalJar[]; managed: string[] }): SyncPlan
export async function applySync(input: { modsDir: string; plan: SyncPlan; download: (url: string, maxBytes: number) => Promise<Buffer>; now?: Date; onProgress?: (p: { done: number; total: number; fileName: string }) => void }): Promise<{ installed: string[]; retired: string[] }>
export async function readLocalJars(modsDir: string): Promise<LocalJar[]>
export async function readManaged(modsDir: string): Promise<string[]>
```

- `managed` は前回このランチャーが入れたファイル名（`mods/.r-launcher-managed.json`）。**利用者が自分で入れた jar（managed に無いもの）は消さない・動かさない**（構成チェックで警告するだけ）。
- retire: managed のうち今回不要になったもの、外した optional、中身が変わったもの。retire は削除せず `mods/../.r-launcher-trash/<日時>/` へ移す。
- download: 足りないもの・中身が違うもの。ダウンロード後に sha1（あれば sha512 も）を確かめてから一時ファイル→rename で置く。合わなければ置かずに例外。size を `maxBytes` に渡す。同時に 4 本まで。
- 最後に managed.json を書き直す（一時ファイル→rename）。
- ファイル名は `JarNameSchema` を通ったものだけ使い、`path.join` の結果が modsDir の中にあることも確かめる。
- テスト: 新規・更新・optional の外し/戻し・利用者の jar を残すこと・ハッシュ不一致で置かないこと・途中失敗で managed が壊れないこと。

## 8. `src/main/http.ts` — 外部への HTTP

```ts
export interface Http {
  getJson<T>(url: string, schema: z.ZodType<T>, opts?: { timeoutMs?: number; headers?: Record<string, string> }): Promise<T>
  postJson<T>(url: string, body: unknown, schema: z.ZodType<T>, opts?: { timeoutMs?: number }): Promise<T>
  getBytes(url: string, opts: { maxBytes: number; allowedHosts?: readonly string[]; timeoutMs?: number }): Promise<Buffer>
}
export function createHttp(opts: { fetch?: typeof fetch; userAgent: string; allowHttpLocalhost?: boolean }): Http
export class HttpError extends Error { status?: number }
export const DOWNLOAD_HOSTS: readonly string[]   // cdn.modrinth.com, edge.forgecdn.net, mediafilez.forgecdn.net
```

- https のみ（`allowHttpLocalhost` のときだけ http://localhost・127.0.0.1 を許す）。
- リダイレクトは自分で追う（`redirect: 'manual'`、最大 5 回）。**毎回** プロトコルと `allowedHosts` を確かめる。
- 本文は上限を超えたら読むのをやめて失敗（Content-Length が上限超えなら読む前に失敗）。
- JSON は schema で検証し、合わなければ「応答の形が想定と違います」。
- エラーメッセージに URL のクエリ文字列を含めない（トークンが入る可能性があるため）。
- テスト: 偽の fetch で、リダイレクト先のホスト違反・http への格下げ・上限超え・タイムアウト・schema 違反。

## 9. `src/main/hash.ts`

`sha1File(path)`・`sha512File(path)`・`sha1(buf)`・`sha512(buf)`（ストリームで読む）。テスト。

## 完了条件

- `npm test`・`npx tsc -p tsconfig.json --noEmit`・`npx prettier --check src/main` が通る（他人のファイルが原因の失敗は除く。その場合は最終報告に書く）。
- 上のファイル以外を変えていないこと。git commit はしない。
- 最終報告は日本語で、作ったファイル、満たした条件、決めたこと（指示に無かった判断）を書く。

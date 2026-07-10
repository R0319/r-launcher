import type { BrowserWindow } from 'electron'
import EMLLib from 'eml-lib'
import type { Account } from 'eml-lib'

// clientId は省略可（EML-Lib 既定のMinecraft公式ランチャー共有Client IDが使われる）。
// 本番運用では独自のAzure ADアプリ登録を行い、環境変数等から渡すことを推奨。
export async function loginWithMicrosoft(mainWindow: BrowserWindow): Promise<Account> {
  const auth = new EMLLib.MicrosoftAuth(mainWindow)
  return auth.auth()
}

export async function refreshMicrosoftAccount(mainWindow: BrowserWindow, account: Account): Promise<Account> {
  const auth = new EMLLib.MicrosoftAuth(mainWindow)
  const valid = await auth.validate(account)
  if (valid) return account
  return auth.refresh(account)
}

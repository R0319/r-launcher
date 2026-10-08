import type { BrowserWindow } from 'electron'
import EMLLib from 'eml-lib'
import type { Account } from 'eml-lib'
import { config } from './config'

// Client ID が未設定なら eml-lib の既定（公式ランチャーの ID）になる。config.ts の説明を参照。
export async function loginWithMicrosoft(mainWindow: BrowserWindow): Promise<Account> {
  return new EMLLib.MicrosoftAuth(mainWindow, config.msaClientId).auth()
}

/** 有効ならそのまま、期限切れなら更新したアカウントを返す */
export async function refreshMicrosoftAccount(
  mainWindow: BrowserWindow,
  account: Account,
): Promise<Account> {
  const auth = new EMLLib.MicrosoftAuth(mainWindow, config.msaClientId)
  if (await auth.validate(account)) return account
  return auth.refresh(account)
}

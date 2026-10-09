import { safeStorage } from 'electron'
import type { Db } from './db'
import { getSetting, setSetting } from './db/repos/settings'

export type SecretName = 'geminiApiKey' | 'googleClientSecret' | 'googleRefreshToken'

const key = (name: SecretName): string => `secret.${name}`

/**
 * Secrets are encrypted with the OS keychain (DPAPI on Windows) and stored in
 * the settings table. They never leave the main process.
 */
export function getSecret(db: Db, name: SecretName): string | null {
  const stored = getSetting(db, key(name))
  if (!stored) return null
  const [scheme, payload] = stored.split(':', 2)
  const buf = Buffer.from(payload ?? '', 'base64')
  if (scheme === 'enc') return safeStorage.decryptString(buf)
  return buf.toString('utf8')
}

export function setSecret(db: Db, name: SecretName, value: string | null): void {
  if (!value) {
    setSetting(db, key(name), null)
    return
  }
  const stored = safeStorage.isEncryptionAvailable()
    ? `enc:${safeStorage.encryptString(value).toString('base64')}`
    : `raw:${Buffer.from(value, 'utf8').toString('base64')}`
  setSetting(db, key(name), stored)
}

export function hasSecret(db: Db, name: SecretName): boolean {
  return getSetting(db, key(name)) !== null
}

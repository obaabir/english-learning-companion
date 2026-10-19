import { safeStorage } from 'electron'
import type { Db } from './db'
import { getSetting, setSetting } from './db/repos/settings'

export type SecretName = 'geminiApiKey' | 'googleClientSecret' | 'googleRefreshToken' | 'googleRefreshTokenBackup'

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
  if (scheme !== 'enc') return buf.toString('utf8')
  try {
    return safeStorage.decryptString(buf)
  } catch {
    // Encrypted by another copy of the app data (a different key): treated as not set, so Settings asks again.
    return null
  }
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
  return getSecret(db, name) !== null
}

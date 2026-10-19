import { describe, expect, it, vi } from 'vitest'

// The system keychain and Google's sign-in client are replaced; GoogleService itself is real.
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(''), decryptString: () => '' } }))
vi.mock('../src/main/google/auth', () => ({
  authedClient: (_id: string, _secret: string, token: string) => ({
    request: async () => {
      if (token === 'REVOKED') throw Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } })
      return { data: { files: [{ id: 'd1', name: 'Doc' }] } }
    }
  }),
  runOAuthFlow: async () => ({ refreshToken: 'NEW' })
}))

const { openDatabase } = await import('../src/main/db')
const { setSetting } = await import('../src/main/db/repos/settings')
const { getSecret, setSecret } = await import('../src/main/secrets')
const { GoogleService } = await import('../src/main/google/GoogleService')

function service(token: string, backup: string | null) {
  const db = openDatabase(':memory:')
  setSetting(db, 'googleClientId', 'client')
  setSecret(db, 'googleClientSecret', 'secret')
  setSecret(db, 'googleRefreshToken', token)
  if (backup) setSecret(db, 'googleRefreshTokenBackup', backup)
  return { db, google: new GoogleService(db) }
}

describe('Google sign-in kept in reserve (from the other copy of the data)', () => {
  it('the current sign-in was revoked: the reserve one is used automatically and becomes the sign-in', async () => {
    const { db, google } = service('REVOKED', 'GOOD')
    expect(await google.listDocs()).toEqual([{ id: 'd1', title: 'Doc', modifiedTime: undefined }])
    expect([getSecret(db, 'googleRefreshToken'), getSecret(db, 'googleRefreshTokenBackup')]).toEqual(['GOOD', null])
  })

  it('no reserve: the clear "reconnect" message, as before', async () => {
    const { google } = service('REVOKED', null)
    await expect(google.listDocs()).rejects.toThrow(/expired or was revoked/)
  })
})

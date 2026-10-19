import type { OAuth2Client } from 'google-auth-library'
import type { GoogleDocInfo } from '@shared/types'
import type { Db } from '../db'
import { getSetting, setSetting } from '../db/repos/settings'
import { getSecret, setSecret } from '../secrets'
import { authedClient, runOAuthFlow } from './auth'
import { buildAppendRequests, endInsertIndex, type DocEntry } from './docs'

const DOCS = 'https://docs.googleapis.com/v1/documents'
const DRIVE = 'https://www.googleapis.com/drive/v3'

/**
 * A Google error in plain words. `uncertain` is set when no answer came back (connection lost or timed
 * out): the change may still have been applied, so it must be checked before trying again.
 */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly uncertain = false
  ) {
    super(message)
  }
}

function friendlyError(err: unknown): Error {
  const e = err as { response?: { status?: number; data?: { error?: { message?: string } | string } }; message?: string }
  const status = e.response?.status
  if (!e.response) return new GoogleError(`Could not reach Google Docs (${e.message ?? 'no connection'}).`, true)
  const apiMsg = typeof e.response?.data?.error === 'object' ? e.response.data.error.message : e.response?.data?.error
  if (status === 401 || /invalid_grant/i.test(String(apiMsg ?? e.message))) {
    return new Error('Google access expired or was revoked. Reconnect Google in Settings.')
  }
  if (status === 403) return new Error(`Google refused access: ${apiMsg ?? 'check that the Docs and Drive APIs are enabled.'}`)
  if (status === 404) return new Error('That Google Doc was not found. Choose another doc in Settings.')
  return new Error(apiMsg ? `Google: ${apiMsg}` : (e.message ?? String(err)))
}

export class GoogleService {
  private client: OAuth2Client | null = null

  constructor(private readonly db: Db) {}

  private credentials(): { clientId: string; clientSecret: string } {
    const clientId = getSetting(this.db, 'googleClientId')?.trim()
    const clientSecret = getSecret(this.db, 'googleClientSecret')?.trim()
    if (!clientId || !clientSecret) throw new Error('Add your Google OAuth client ID and secret in Settings first.')
    return { clientId, clientSecret }
  }

  get connected(): boolean {
    return !!getSecret(this.db, 'googleRefreshToken')
  }

  get account(): string | null {
    return getSetting(this.db, 'googleAccount')
  }

  private auth(): OAuth2Client {
    if (this.client) return this.client
    const refreshToken = getSecret(this.db, 'googleRefreshToken')
    if (!refreshToken) throw new Error('Connect your Google account in Settings first.')
    const { clientId, clientSecret } = this.credentials()
    this.client = authedClient(clientId, clientSecret, refreshToken)
    return this.client
  }

  private async request<T>(opts: { url: string; method?: 'GET' | 'POST'; params?: Record<string, string | number>; data?: unknown }): Promise<T> {
    try {
      const res = await this.auth().request<T>(opts)
      return res.data
    } catch (err) {
      const friendly = friendlyError(err)
      // A second Google sign-in kept from an earlier copy of the data: if this one was revoked, use it.
      const backup = /expired or was revoked/.test(friendly.message) ? getSecret(this.db, 'googleRefreshTokenBackup') : null
      if (backup) {
        setSecret(this.db, 'googleRefreshToken', backup)
        setSecret(this.db, 'googleRefreshTokenBackup', null)
        this.client = null
        try {
          const res = await this.auth().request<T>(opts)
          return res.data
        } catch (err2) {
          throw friendlyError(err2)
        }
      }
      throw friendly
    }
  }

  async connect(): Promise<void> {
    const { clientId, clientSecret } = this.credentials()
    const { refreshToken } = await runOAuthFlow(clientId, clientSecret)
    setSecret(this.db, 'googleRefreshToken', refreshToken)
    // A fresh sign-in: an older reserve sign-in is no longer needed.
    setSecret(this.db, 'googleRefreshTokenBackup', null)
    this.client = null
    try {
      const about = await this.request<{ user?: { emailAddress?: string } }>({ url: `${DRIVE}/about`, params: { fields: 'user(emailAddress)' } })
      setSetting(this.db, 'googleAccount', about.user?.emailAddress ?? null)
    } catch {
      setSetting(this.db, 'googleAccount', null)
    }
  }

  async disconnect(): Promise<void> {
    try {
      const token = getSecret(this.db, 'googleRefreshToken')
      if (token && this.client) await this.client.revokeToken(token)
    } catch {
      // revoking is best-effort
    }
    setSecret(this.db, 'googleRefreshToken', null)
    setSecret(this.db, 'googleRefreshTokenBackup', null)
    setSetting(this.db, 'googleAccount', null)
    this.client = null
  }

  /** Forget the cached client (e.g. after the client ID/secret changes). */
  resetClient(): void {
    this.client = null
  }

  async listDocs(query?: string): Promise<GoogleDocInfo[]> {
    let q = "mimeType='application/vnd.google-apps.document' and trashed=false"
    if (query?.trim()) q += ` and name contains '${query.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
    const res = await this.request<{ files?: { id: string; name: string; modifiedTime?: string }[] }>({
      url: `${DRIVE}/files`,
      params: { q, orderBy: 'modifiedTime desc', pageSize: 30, fields: 'files(id,name,modifiedTime)' }
    })
    return (res.files ?? []).map((f) => ({ id: f.id, title: f.name, modifiedTime: f.modifiedTime }))
  }

  async createDoc(title: string): Promise<GoogleDocInfo> {
    const res = await this.request<{ documentId: string; title: string }>({ url: DOCS, method: 'POST', data: { title } })
    return { id: res.documentId, title: res.title }
  }

  /** Whether the doc's text contains `text` (used to check an append whose result is unknown). */
  async docContains(docId: string, text: string): Promise<boolean> {
    type Para = { paragraph?: { elements?: { textRun?: { content?: string } }[] } }
    const doc = await this.request<{ body?: { content?: Para[] } }>({
      url: `${DOCS}/${encodeURIComponent(docId)}`,
      params: { fields: 'body.content.paragraph.elements.textRun.content' }
    })
    const all = (doc.body?.content ?? []).map((c) => (c.paragraph?.elements ?? []).map((e) => e.textRun?.content ?? '').join('')).join('')
    return all.includes(text)
  }

  async appendEntry(docId: string, entry: DocEntry): Promise<void> {
    const doc = await this.request<{ body?: { content?: { endIndex?: number }[] } }>({
      url: `${DOCS}/${encodeURIComponent(docId)}`,
      params: { fields: 'body.content.endIndex' }
    })
    const requests = buildAppendRequests(entry, endInsertIndex(doc.body))
    await this.request({ url: `${DOCS}/${encodeURIComponent(docId)}:batchUpdate`, method: 'POST', data: { requests } })
  }
}

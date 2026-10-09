import http from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library'

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
]

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Connected</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0">
<div style="text-align:center"><h2>Google is connected ✓</h2><p>You can close this tab and return to English Learning Companion.</p></div></body>`

/**
 * Desktop OAuth with a loopback redirect and PKCE. Opens the system browser and
 * resolves with a refresh token once the user approves.
 */
export async function runOAuthFlow(clientId: string, clientSecret: string): Promise<{ refreshToken: string }> {
  const state = randomBytes(16).toString('hex')
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res
    rejectCode = rej
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    if (!code && !error) {
      res.writeHead(404).end()
      return
    }
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400).end('State mismatch')
      rejectCode(new Error('Google sign-in failed (state mismatch). Try again.'))
      return
    }
    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Sign-in cancelled. You can close this tab.')
      rejectCode(new Error(`Google sign-in was cancelled (${error}).`))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE)
    resolveCode(code!)
  })

  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const timeout = setTimeout(() => rejectCode(new Error('Google sign-in timed out.')), 5 * 60 * 1000)

  try {
    const client = new OAuth2Client({ clientId, clientSecret, redirectUri })
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256
    })
    await shell.openExternal(authUrl)
    const code = await codePromise
    const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri })
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove the app from your Google account permissions and try again.')
    return { refreshToken: tokens.refresh_token }
  } finally {
    clearTimeout(timeout)
    server.close()
  }
}

export function authedClient(clientId: string, clientSecret: string, refreshToken: string): OAuth2Client {
  const client = new OAuth2Client({ clientId, clientSecret })
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

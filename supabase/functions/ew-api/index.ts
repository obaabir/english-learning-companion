// English World API — Supabase Edge Function "ew-api".
// Everything public (posts, comments, corrections) is written ONLY here, after a safety check:
//   1) personal details (phone, email, social handles) by pattern, 2) Gemini check of the text and photo.
// Also: the private "check my English" and the first "AI answer" for questions.
// Needs one secret: GEMINI_API_KEY (Supabase → Edge Functions → Secrets).

import { createClient } from 'npm:@supabase/supabase-js@2'

type DenoLike = { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }
const DENO = (globalThis as unknown as { Deno?: DenoLike }).Deno
const env = (name: string): string => DENO?.env.get(name) ?? ''

export const POST_TAGS = ['Daily life', 'Study', 'IELTS', 'Movies', 'Grammar', 'Speaking', 'Confidence']
export const QUESTION_TAGS = ['Listening', 'Speaking', 'IELTS', 'Grammar', 'Vocabulary', 'Confidence']
const KINDS = ['post', 'question', 'story', 'win']
const MAX_IMAGE_CHARS = 1_400_000
const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest']

/* ------------------------------ Pure helpers ------------------------------ */

/** Phone numbers, emails, social handles/links → a gentle reason, else null. (Same rules as the database.) */
export function personalInfo(text: string): string | null {
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return 'Please remove the email address. Personal details are not allowed.'
  if (/([0-9০-৯][ ().-]*){10,}/.test(text)) return 'Please remove the phone number. Personal details are not allowed.'
  if (/(^|[^a-z0-9_])@[a-z0-9_.]{3,}/i.test(text) || /(instagram\.com|facebook\.com|fb\.com|fb\.me|tiktok\.com|t\.me|wa\.me|snapchat\.com|twitter\.com|x\.com\/)/i.test(text))
    return 'Please remove social media handles or links. Personal details are not allowed.'
  return null
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export interface PostInput {
  kind: string
  text: string
  image: string | null
  bg: string | null
  tags: string[]
  correctMe: boolean
  challengeDay: string | null
}

/** Checks the shape of a new post. Returns an error message or the clean post. */
export function cleanPost(b: Record<string, unknown>): { error: string } | { post: PostInput } {
  const kind = String(b.kind ?? 'post')
  if (!KINDS.includes(kind)) return { error: 'Unknown post type.' }
  const text = str(b.text, 600)
  if (!text) return { error: 'Write something first.' }
  if (text.length > 500) return { error: 'Please keep it under 500 characters.' }
  const image = typeof b.image === 'string' && b.image ? b.image : null
  if (image && (!image.startsWith('data:image/jpeg;base64,') || image.length > MAX_IMAGE_CHARS)) return { error: 'The photo is too big. Please choose a smaller one.' }
  const allowed = kind === 'question' ? QUESTION_TAGS : POST_TAGS
  const tags = Array.isArray(b.tags) ? [...new Set(b.tags.filter((t): t is string => typeof t === 'string' && allowed.includes(t)))].slice(0, 4) : []
  const bg = typeof b.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.bg) ? b.bg : null
  const challengeDay = typeof b.challengeDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.challengeDay) ? b.challengeDay : null
  return { post: { kind, text, image, bg, tags, correctMe: b.correctMe === true, challengeDay } }
}

/** "EW_PERSONAL: Please remove…" from a database error → the friendly part. */
export function dbMessage(msg: string): string {
  const m = msg.match(/EW_[A-Z]+:\s*(.+)$/)
  return m ? m[1].trim() : 'Something went wrong while saving. Please try again.'
}

/* ------------------------------ Gemini ------------------------------ */

type Part = { text: string } | { inline_data: { mime_type: string; data: string } }

export interface Safety {
  allowed: boolean
  category: string
  reason: string
}

const SAFETY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    allowed: { type: 'BOOLEAN' },
    category: { type: 'STRING', enum: ['none', 'bullying', 'sexual', 'hate', 'threat', 'personal_info', 'self_harm', 'spam'] },
    reason: { type: 'STRING', description: 'If not allowed: one short, gentle sentence in simple English for a teenager. Else empty.' }
  },
  required: ['allowed', 'category', 'reason']
}

const SAFETY_PROMPT = `You protect an English-learning community where many users are teenagers (under 18).
Decide if the content can be published. Block ONLY real problems:
- bullying or insults aimed at a person, mocking someone's English
- sexual or adult content
- hate (race, religion, gender, disability, etc.)
- threats or violence against people
- personal data: phone numbers, home addresses, school names, social media handles, ID documents, exact locations
- self-harm encouragement
- spam or advertising
Normal feelings, mild complaints ("I hate Mondays"), mistakes in English and friendly corrections are ALLOWED.
For a photo also block: nudity, violence, visible personal documents, school names or logos, exact addresses.
If it is fine: allowed = true, category = "none", reason = "".`

const CHECK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ok: { type: 'BOOLEAN', description: 'True if there are no real mistakes' },
    corrected: { type: 'STRING', description: 'The text with only the necessary fixes (same if ok)' },
    mistakes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { wrong: { type: 'STRING' }, fix: { type: 'STRING' }, why: { type: 'STRING', description: 'Short reason in simple Bangla' } },
        required: ['wrong', 'fix', 'why']
      }
    }
  },
  required: ['ok', 'corrected', 'mistakes']
}

const CHECK_PROMPT = `A Bangla-speaking English learner wants to check their text privately before posting.
Fix only real grammar, spelling and word-choice mistakes. Keep their words and style; never rewrite for style.
List at most 5 mistakes. "wrong" must be copied exactly from their text. "why" is one short, kind reason in simple Bangla.`

const ANSWER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    bn: { type: 'STRING', description: 'A short, simple answer in Bangla (3-5 sentences)' },
    en: { type: 'STRING', description: 'The same answer in simple English (3-5 sentences)' }
  },
  required: ['bn', 'en']
}

const ANSWER_PROMPT = `You answer an English learner's question in a friendly study community (many users are teenagers).
Give a short, practical, encouraging answer in simple Bangla and the same in simple English. No links.`

export async function gemini<T>(key: string, system: string, parts: Part[], schema: unknown, fetcher: typeof fetch = fetch): Promise<T> {
  let last: unknown = null
  for (const model of MODELS) {
    try {
      const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 }
        }),
        signal: AbortSignal.timeout(20000)
      })
      const j = (await res.json()) as {
        error?: { message?: string }
        promptFeedback?: { blockReason?: string }
        candidates?: { content?: { parts?: { text?: string }[] } }[]
      }
      if (!res.ok) throw new Error(j.error?.message ?? `Gemini error ${res.status}`)
      // Gemini itself refused the content: treat as not allowed.
      if (j.promptFeedback?.blockReason) return { allowed: false, category: 'sexual', reason: 'This content is not allowed here.', ok: false, corrected: '', mistakes: [], bn: '', en: '' } as T
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
      return JSON.parse(text) as T
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new Error('Gemini did not answer.')
}

function imagePart(dataUrl: string | null): Part[] {
  if (!dataUrl) return []
  return [{ inline_data: { mime_type: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) } }]
}

/* ------------------------------ Handler ------------------------------ */

export interface Deps {
  /** The signed-in user's id from their token, or null. */
  userId(authHeader: string): Promise<string | null>
  insert(table: 'ew_posts' | 'ew_comments' | 'ew_fixes', row: Record<string, unknown>): Promise<{ id?: string; error?: string }>
  update(table: 'ew_posts', id: string, patch: Record<string, unknown>): Promise<void>
  /** A visible post (not hidden, not expired) or null. */
  post(id: string): Promise<{ id: string; author_id: string; kind: string; text: string } | null>
  hasProfile(userId: string): Promise<boolean>
  safety(text: string, image: string | null): Promise<Safety>
  check(text: string): Promise<{ ok: boolean; corrected: string; mistakes: { wrong: string; fix: string; why: string }[] }>
  answer(question: string): Promise<{ bn: string; en: string }>
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
const UNCHECKED = "We couldn't check this right now, so it wasn't posted. Please try again in a minute."

async function safe(deps: Deps, text: string, image: string | null): Promise<string | null> {
  const p = personalInfo(text)
  if (p) return p
  let s: Safety
  try {
    s = await deps.safety(text, image)
  } catch {
    throw new Error(UNCHECKED)
  }
  return s.allowed ? null : s.reason || 'This is not allowed in English World. Please change it and try again.'
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405)
  const userId = await deps.userId(req.headers.get('Authorization') ?? '')
  if (!userId) return json({ ok: false, error: 'Please open English World again to sign in.' }, 401)
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400)
  }

  try {
    switch (body.action) {
      case 'check': {
        const text = str(body.text, 600)
        if (!text) return json({ ok: false, error: 'Write something first.' })
        const result = await deps.check(text).catch(() => null)
        if (!result) return json({ ok: false, error: "The checker is busy. Please try again in a minute." })
        return json({ ok: true, result })
      }

      case 'post': {
        if (!(await deps.hasProfile(userId))) return json({ ok: false, error: 'Please create your profile first.' })
        const c = cleanPost(body)
        if ('error' in c) return json({ ok: false, error: c.error })
        const flagged = await safe(deps, c.post.text, c.post.image)
        if (flagged) return json({ ok: false, flagged: true, error: flagged })
        const now = Date.now()
        const { id, error } = await deps.insert('ew_posts', {
          author_id: userId,
          kind: c.post.kind,
          text: c.post.text,
          image: c.post.image,
          bg: c.post.kind === 'story' ? c.post.bg : null,
          tags: c.post.tags,
          correct_me: c.post.correctMe,
          challenge_day: c.post.challengeDay,
          expires_at: c.post.kind === 'story' ? new Date(now + 24 * 3600 * 1000).toISOString() : null
        })
        if (error || !id) return json({ ok: false, error: dbMessage(error ?? '') })
        // Questions get a first answer from AI (labelled "AI answer"); posting never waits on failure.
        if (c.post.kind === 'question') {
          const a = await deps.answer(c.post.text).catch(() => null)
          if (a?.bn || a?.en) await deps.update('ew_posts', id, { ai_answer: { bn: a.bn, en: a.en } }).catch(() => undefined)
        }
        return json({ ok: true, id })
      }

      case 'comment':
      case 'fix': {
        if (!(await deps.hasProfile(userId))) return json({ ok: false, error: 'Please create your profile first.' })
        const post = await deps.post(str(body.postId, 64))
        if (!post) return json({ ok: false, error: 'This post is no longer available.' })
        const text = str(body.text, 600)
        if (!text) return json({ ok: false, error: 'Write something first.' })
        if (text.length > 500) return json({ ok: false, error: 'Please keep it under 500 characters.' })
        if (body.action === 'fix') {
          if (post.author_id === userId) return json({ ok: false, error: 'You can’t correct your own post.' })
          const note = str(body.note, 200)
          const flagged = await safe(deps, `${text}\n${note}`, null)
          if (flagged) return json({ ok: false, flagged: true, error: flagged })
          const { id, error } = await deps.insert('ew_fixes', { post_id: post.id, author_id: userId, text, note })
          if (error || !id) return json({ ok: false, error: dbMessage(error ?? '') })
          return json({ ok: true, id })
        }
        const flagged = await safe(deps, text, null)
        if (flagged) return json({ ok: false, flagged: true, error: flagged })
        const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null
        const { id, error } = await deps.insert('ew_comments', { post_id: post.id, parent_id: parentId, author_id: userId, text })
        if (error || !id) return json({ ok: false, error: dbMessage(error ?? '') })
        return json({ ok: true, id })
      }

      default:
        return json({ ok: false, error: 'Unknown action.' }, 400)
    }
  } catch (err) {
    return json({ ok: false, error: err instanceof Error && err.message === UNCHECKED ? UNCHECKED : 'Something went wrong. Please try again.' })
  }
}

/* ------------------------------ Real wiring ------------------------------ */

function realDeps(): Deps {
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'), { auth: { persistSession: false } })
  const key = env('GEMINI_API_KEY')
  return {
    async userId(authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '')
      if (!token) return null
      const { data } = await admin.auth.getUser(token)
      return data.user?.id ?? null
    },
    async insert(table, row) {
      const { data, error } = await admin.from(table).insert(row).select('id').single()
      return error ? { error: error.message } : { id: (data as { id: string }).id }
    },
    async update(table, id, patch) {
      await admin.from(table).update(patch).eq('id', id)
    },
    async post(id) {
      const { data } = await admin.from('ew_posts').select('id, author_id, kind, text, expires_at').eq('id', id).eq('hidden', false).maybeSingle()
      const p = data as { id: string; author_id: string; kind: string; text: string; expires_at: string | null } | null
      if (!p || (p.expires_at && new Date(p.expires_at).getTime() < Date.now())) return null
      return p
    },
    async hasProfile(userId) {
      const { data } = await admin.from('ew_profiles').select('id').eq('id', userId).maybeSingle()
      return !!data
    },
    safety: (text, image) => gemini<Safety>(key, SAFETY_PROMPT, [{ text: `Content to check:\n${text}` }, ...imagePart(image)], SAFETY_SCHEMA),
    check: (text) => gemini(key, CHECK_PROMPT, [{ text }], CHECK_SCHEMA),
    answer: (question) => gemini(key, ANSWER_PROMPT, [{ text: question }], ANSWER_SCHEMA)
  }
}

if (DENO) {
  const deps = realDeps()
  DENO.serve((req) => handle(req, deps))
}

// English World: talks to the community's Supabase project (main process only).
// Students get an anonymous account automatically (no email or password).
import { safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { EwComment, EwFix, EwMethods, EwModItem, EwNotification, EwPost, EwProfile, EwRequest, EwStats, EwStatus } from '@shared/ew'

const PAGE = 15
const POST_COLUMNS = 'id,author_id,kind,text,has_image,bg,tags,correct_me,challenge_day,ai_answer,solved_comment_id,hidden,created_at,expires_at,author:ew_profiles!ew_posts_author_id_fkey(name,avatar,level)'
const AUTHOR_FALLBACK = { name: 'Someone', avatar: '🙂', level: 'Beginner' as const }

function protect(s: string): string {
  return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : 'raw:' + Buffer.from(s).toString('base64')
}
function unprotect(s: string): string {
  if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'))
  return Buffer.from(s.slice(4), 'base64').toString()
}

/** Encrypted JSON file used as Supabase's session storage. */
class FileStore {
  private data: Record<string, string> = {}
  constructor(private readonly file: string) {
    try {
      if (existsSync(file)) this.data = JSON.parse(unprotect(readFileSync(file, 'utf8')))
    } catch {
      this.data = {}
    }
  }
  getItem = (key: string): string | null => this.data[key] ?? null
  setItem = (key: string, value: string): void => {
    this.data[key] = value
    this.save()
  }
  removeItem = (key: string): void => {
    delete this.data[key]
    this.save()
  }
  private save(): void {
    try {
      writeFileSync(this.file, protect(JSON.stringify(this.data)))
    } catch {
      // disk full / read-only: session lasts until the app closes
    }
  }
}

/** Accepts the project URL and the PUBLIC key only (never the secret key). */
export function checkConfig(url: string, key: string): string | null {
  const u = url.trim()
  const k = key.trim()
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(u)) return 'The Project URL looks like https://abcdxyz.supabase.co'
  if (/^sb_secret_/i.test(k)) return 'That is the SECRET key. Never put it in the app. Use the "publishable" (or "anon public") key.'
  if (/^eyJ/.test(k)) {
    try {
      const payload = JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()) as { role?: string }
      if (payload.role === 'service_role') return 'That is the service_role (secret) key. Never put it in the app. Use the "anon public" key.'
    } catch {
      return 'That key looks broken. Copy it again.'
    }
    return null
  }
  if (/^sb_publishable_/i.test(k)) return null
  return 'Paste the "publishable" key (starts with sb_publishable_) or the "anon public" key (starts with eyJ).'
}

/** Database error → a friendly message. */
export function friendlyEw(err: unknown): Error {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  const ew = msg.match(/EW_[A-Z]+:\s*(.+)$/)
  if (ew) return new Error(ew[1].trim())
  if (/anonymous sign-?ins? (are )?disabled/i.test(msg)) return new Error('In Supabase, turn on: Authentication → Sign In / Providers → "Allow anonymous sign-ins".')
  if (/relation .*ew_|does not exist|schema cache/i.test(msg)) return new Error("English World's database isn't set up yet. Run english-world.sql in Supabase (setup step 3).")
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|timed? ?out/i.test(msg)) return new Error("Couldn't reach English World. Check your internet and try again.")
  if (/JWT|invalid api key|No API key/i.test(msg)) return new Error('The English World key is not valid. Check the Project URL and key in setup.')
  return new Error(msg || 'Something went wrong. Please try again.')
}

type Row = Record<string, unknown>
const author = (r: Row): EwPost['author'] => (r.author as EwPost['author'] | null) ?? AUTHOR_FALLBACK

function toPost(r: Row): EwPost {
  return {
    id: r.id as string,
    authorId: r.author_id as string,
    author: author(r),
    kind: r.kind as EwPost['kind'],
    text: r.text as string,
    hasImage: !!r.has_image,
    bg: (r.bg as string | null) ?? null,
    tags: (r.tags as string[] | null) ?? [],
    correctMe: !!r.correct_me,
    challengeDay: (r.challenge_day as string | null) ?? null,
    aiAnswer: (r.ai_answer as EwPost['aiAnswer']) ?? null,
    solvedCommentId: (r.solved_comment_id as string | null) ?? null,
    hidden: !!r.hidden,
    createdAt: r.created_at as string,
    expiresAt: (r.expires_at as string | null) ?? null
  }
}

export class EwService {
  private client: SupabaseClient | null = null
  private userId: string | null = null
  private session: Promise<string> | null = null

  constructor(private readonly dir: string) {}

  private get configFile(): string {
    return join(this.dir, 'ew-config.json')
  }
  private get sessionFile(): string {
    return join(this.dir, 'ew-session.json')
  }

  private config(): { url: string; key: string } | null {
    try {
      if (!existsSync(this.configFile)) return null
      const c = JSON.parse(readFileSync(this.configFile, 'utf8')) as { url: string; key: string }
      return { url: c.url, key: unprotect(c.key) }
    } catch {
      return null
    }
  }

  private db(): SupabaseClient {
    if (this.client) return this.client
    const c = this.config()
    if (!c) throw new Error('English World is not connected yet.')
    this.client = createClient(c.url, c.key, {
      auth: { storage: new FileStore(this.sessionFile), persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    })
    return this.client
  }

  /** Signed in (anonymously) → user id. */
  private me(): Promise<string> {
    this.session ??= (async () => {
      const db = this.db()
      const { data } = await db.auth.getSession()
      if (data.session?.user) return data.session.user.id
      const { data: signed, error } = await db.auth.signInAnonymously()
      if (error || !signed.user) throw friendlyEw(error ?? new Error('Sign-in failed.'))
      return signed.user.id
    })().catch((err) => {
      this.session = null
      throw friendlyEw(err)
    })
    return this.session.then((id) => (this.userId = id))
  }

  private async profile(id: string): Promise<EwProfile | null> {
    const { data, error } = await this.db().from('ew_profiles').select('id,name,avatar,level,goal').eq('id', id).maybeSingle()
    if (error) throw friendlyEw(error)
    return (data as EwProfile | null) ?? null
  }

  private async status(): Promise<EwStatus> {
    const c = this.config()
    if (!c) return { configured: false, url: null, userId: null, profile: null, error: null }
    try {
      const id = await this.me()
      return { configured: true, url: c.url, userId: id, profile: await this.profile(id), error: null }
    } catch (err) {
      return { configured: true, url: c.url, userId: null, profile: null, error: friendlyEw(err).message }
    }
  }

  private async invokeFn(body: Record<string, unknown>): Promise<Row> {
    await this.me()
    const { data, error } = await this.db().functions.invoke('ew-api', { body })
    if (error) {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        if (ctx.status === 404) throw new Error("English World's safety function isn't set up yet (setup step 4).")
        const j = (await ctx.json().catch(() => null)) as Row | null
        if (j && typeof j.error === 'string') return j
      }
      throw friendlyEw(error)
    }
    return data as Row
  }

  async call(req: EwRequest): Promise<unknown> {
    const m = req.method
    switch (m) {
      case 'status':
        return this.status()
      case 'configure': {
        const { url, key } = req.args
        const bad = checkConfig(url, key)
        if (bad) throw new Error(bad)
        writeFileSync(this.configFile, JSON.stringify({ url: url.trim().replace(/\/$/, ''), key: protect(key.trim()) }))
        rmSync(this.sessionFile, { force: true })
        this.client = null
        this.session = null
        return this.status()
      }
      case 'disconnect':
        rmSync(this.configFile, { force: true })
        rmSync(this.sessionFile, { force: true })
        this.client = null
        this.session = null
        this.userId = null
        return this.status()
      default:
        return this.run(req)
    }
  }

  private async run(req: EwRequest): Promise<unknown> {
    const me = await this.me()
    const db = this.db()
    const fail = (error: unknown): never => {
      throw friendlyEw(error)
    }
    switch (req.method) {
      case 'saveProfile': {
        const a = req.args
        const row = { id: me, name: a.name.trim().slice(0, 30), avatar: a.avatar.slice(0, 16) || '🙂', level: a.level, goal: a.goal.trim().slice(0, 120) }
        const { error } = await db.from('ew_profiles').upsert(row)
        if (error) fail(error)
        return row satisfies ReturnType<EwMethods['saveProfile']>
      }
      case 'feed': {
        const { tab, page, authorIds, day } = req.args
        let q = db.from('ew_posts').select(POST_COLUMNS)
        if (tab === 'stories') q = q.eq('kind', 'story').order('created_at', { ascending: false }).limit(30)
        else {
          if (tab === 'latest') q = q.neq('kind', 'story')
          if (tab === 'following') q = q.neq('kind', 'story').in('author_id', authorIds?.length ? authorIds : ['00000000-0000-0000-0000-000000000000'])
          if (tab === 'challenge') q = q.eq('challenge_day', day ?? '')
          if (tab === 'questions') q = q.eq('kind', 'question')
          if (tab === 'mine') q = q.eq('author_id', me)
          q = q.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
        }
        const { data, error } = await q
        if (error) fail(error)
        return ((data ?? []) as Row[]).map(toPost)
      }
      case 'image': {
        const { data, error } = await db.from('ew_posts').select('image').eq('id', req.args.postId).maybeSingle()
        if (error) fail(error)
        return ((data as Row | null)?.image as string | null) ?? null
      }
      case 'stats': {
        if (!req.args.ids.length) return []
        const { data, error } = await db.rpc('ew_stats', { ids: req.args.ids })
        if (error) fail(error)
        return ((data ?? []) as Row[]).map(
          (r): EwStats => ({
            postId: r.post_id as string,
            learned: r.learned as number,
            brave: r.brave as number,
            clear: r.clear as number,
            fixes: r.fixes as number,
            comments: r.comments as number,
            mine: (r.mine as EwStats['mine']) ?? []
          })
        )
      }
      case 'publish':
        return this.invokeFn({ ...req.args })
      case 'check':
        return this.invokeFn({ action: 'check', text: req.args.text })
      case 'react': {
        const { postId, type, on } = req.args
        const { error } = on
          ? await db.from('ew_reactions').upsert({ post_id: postId, user_id: me, type }, { ignoreDuplicates: true })
          : await db.from('ew_reactions').delete().match({ post_id: postId, user_id: me, type })
        if (error) fail(error)
        return true
      }
      case 'thread': {
        const id = req.args.postId
        const [f, c] = await Promise.all([
          db.from('ew_fixes').select('id,post_id,author_id,text,note,helpful,hidden,created_at,author:ew_profiles!ew_fixes_author_id_fkey(name,avatar,level)').eq('post_id', id).order('created_at'),
          db.from('ew_comments').select('id,post_id,parent_id,author_id,text,hidden,created_at,author:ew_profiles!ew_comments_author_id_fkey(name,avatar,level)').eq('post_id', id).order('created_at')
        ])
        if (f.error) fail(f.error)
        if (c.error) fail(c.error)
        const fixes = ((f.data ?? []) as Row[]).map(
          (r): EwFix => ({ id: r.id as string, postId: r.post_id as string, authorId: r.author_id as string, author: author(r), text: r.text as string, note: r.note as string, helpful: !!r.helpful, hidden: !!r.hidden, createdAt: r.created_at as string })
        )
        const comments = ((c.data ?? []) as Row[]).map(
          (r): EwComment => ({ id: r.id as string, postId: r.post_id as string, parentId: (r.parent_id as string | null) ?? null, authorId: r.author_id as string, author: author(r), text: r.text as string, hidden: !!r.hidden, createdAt: r.created_at as string })
        )
        return { fixes, comments }
      }
      case 'markHelpful': {
        const { data, error } = await db.rpc('ew_mark_helpful', { fix: req.args.fixId })
        if (error) fail(error)
        return !!data
      }
      case 'markSolved': {
        const { data, error } = await db.rpc('ew_mark_solved', { comment: req.args.commentId })
        if (error) fail(error)
        return !!data
      }
      case 'report': {
        const { targetType, targetId, reason } = req.args
        const { error } = await db.from('ew_reports').upsert({ target_type: targetType, target_id: targetId, reporter_id: me, reason }, { ignoreDuplicates: true })
        if (error && !/duplicate key/i.test(error.message)) fail(error)
        return true
      }
      case 'remove': {
        const table = req.args.target === 'post' ? 'ew_posts' : req.args.target === 'comment' ? 'ew_comments' : 'ew_fixes'
        const { error } = await db.from(table).delete().eq('id', req.args.id)
        if (error) fail(error)
        return true
      }
      case 'notifications': {
        const { data, error } = await db.rpc('ew_notifications', { since: req.args.since })
        if (error) fail(error)
        return ((data ?? []) as Row[]).map(
          (r): EwNotification => ({ kind: r.kind as EwNotification['kind'], postId: r.post_id as string, actorName: r.actor_name as string, actorAvatar: r.actor_avatar as string, detail: r.detail as string, at: r.at as string })
        )
      }
      case 'modStatus': {
        const { data, error } = await db.rpc('ew_mod_status')
        if (error) fail(error)
        return !!data
      }
      case 'modSetup': {
        const { data, error } = await db.rpc('ew_mod_setup', { passcode: req.args.passcode })
        if (error) fail(error)
        return !!data
      }
      case 'modQueue': {
        const { data, error } = await db.rpc('ew_mod_queue', { passcode: req.args.passcode })
        if (error) fail(error)
        return ((data ?? []) as Row[]).map(
          (r): EwModItem => ({
            targetType: r.target_type as EwModItem['targetType'],
            targetId: r.target_id as string,
            postId: (r.post_id as string | null) ?? null,
            text: r.text as string,
            authorName: r.author_name as string,
            hidden: !!r.hidden,
            reports: (r.reports as number) ?? 0,
            reasons: (r.reasons as string[]) ?? [],
            createdAt: r.created_at as string
          })
        )
      }
      case 'modSetHidden': {
        const a = req.args
        const { data, error } = await db.rpc('ew_mod_set_hidden', { passcode: a.passcode, target_type: a.targetType, target_id: a.targetId, hide: a.hide })
        if (error) fail(error)
        return !!data
      }
      default:
        throw new Error('Unknown English World action.')
    }
  }
}

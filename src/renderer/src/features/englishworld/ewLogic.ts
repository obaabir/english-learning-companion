// English World: pure logic (no React, no network).
import type { EwLevel, EwPost, EwStats } from '@shared/ew'

export const POST_TAGS = ['Daily life', 'Study', 'IELTS', 'Movies', 'Grammar', 'Speaking', 'Confidence']
export const QUESTION_TAGS = ['Listening', 'Speaking', 'IELTS', 'Grammar', 'Vocabulary', 'Confidence']
export const LEVELS: EwLevel[] = ['Beginner', 'Intermediate', 'IELTS']
export const AVATARS = ['🙂', '😊', '🦊', '🐼', '🐯', '🦁', '🐸', '🐧', '🦉', '🐙', '🌸', '🌻', '🌙', '⭐', '🚀', '🎧', '📚', '⚽', '🎨', '🍀']
export const STORY_COLORS = ['#781b36', '#1f5f8b', '#2e7d4f', '#8a5a10', '#5b3a8c', '#b4495f']
export const MAX_TEXT = 500
export const FEED_LIMIT = 30

/** 60 daily prompts; everyone gets the same one each day. */
export const CHALLENGES = [
  'Describe your breakfast in 3 sentences.',
  'What scares you about speaking English?',
  'Write about your favourite place at home.',
  'What did you learn yesterday?',
  'Describe your best friend without saying their name.',
  'What is a movie that made you happy? Why?',
  'Write 3 sentences about the weather today.',
  'What would you do with a free day?',
  'Describe your morning routine.',
  'Which English word do you love? Why?',
  'Write about a time you were brave.',
  'What is your dream job?',
  'Describe a food you could eat every day.',
  'What makes a good teacher?',
  'Write about your favourite season.',
  'What is one small goal for this week?',
  'Describe a song you like and how it makes you feel.',
  'What did you do last weekend?',
  'If you could visit any country, where would you go?',
  'Write about something that made you laugh.',
  'What is the hardest part of English for you?',
  'Describe your street in 3 sentences.',
  'What do you do when you feel stressed?',
  'Write about a person you admire.',
  'What is your favourite way to learn new words?',
  'Describe a festival you enjoy.',
  'What would you tell your younger self?',
  'Write 3 sentences using "used to".',
  'What is a skill you want to learn?',
  'Describe your favourite book or story.',
  'What does a perfect day look like for you?',
  'Write about a mistake that taught you something.',
  'What is your favourite app and why?',
  'Describe your city to a visitor.',
  'What are you grateful for today?',
  'Write 3 sentences with "if I were…".',
  'What do you usually do after school or work?',
  'Describe a gift you will never forget.',
  'What is something you are proud of?',
  'Write about your favourite sport or game.',
  'How do you practise speaking English?',
  'Describe a rainy day in your town.',
  'What is a habit you want to change?',
  'Write about a trip you took.',
  'What kind of music do you like?',
  'Describe your family in 3 sentences.',
  'What is the best advice you have received?',
  'Write 3 sentences using "should".',
  'What would you invent to help people?',
  'Describe a smell that reminds you of home.',
  'What is something new you tried recently?',
  'Write about your favourite teacher.',
  'What do you like about learning English?',
  'Describe your room in 3 sentences.',
  'What is a fun fact you know?',
  'Write about a time you helped someone.',
  'What makes you feel confident?',
  'Describe your favourite snack.',
  'What do you want to improve this month?',
  'Write a short message to a friend learning English.'
]

const EPOCH = Date.UTC(2026, 0, 1)

export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Today's prompt (the same for everyone on that date). */
export function challengeFor(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const n = Math.floor((Date.UTC(y, m - 1, d) - EPOCH) / 86400000)
  return CHALLENGES[((n % CHALLENGES.length) + CHALLENGES.length) % CHALLENGES.length]
}

/* ------------------------------ Safety ------------------------------ */

/** Same pattern check as the server: phone numbers, emails, social handles/links. */
export function personalInfo(text: string): string | null {
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return 'Please remove the email address. Personal details are not allowed.'
  if (/([0-9০-৯][ ().-]*){10,}/.test(text)) return 'Please remove the phone number. Personal details are not allowed.'
  if (/(^|[^a-z0-9_])@[a-z0-9_.]{3,}/i.test(text) || /(instagram\.com|facebook\.com|fb\.com|fb\.me|tiktok\.com|t\.me|wa\.me|snapchat\.com|twitter\.com|x\.com\/)/i.test(text))
    return 'Please remove social media handles or links. Personal details are not allowed.'
  return null
}

/** No notifications between 11 pm and 7 am. */
export const quietHours = (d = new Date()): boolean => d.getHours() >= 23 || d.getHours() < 7

/* ------------------------------ For You ------------------------------ */

export interface RankContext {
  level: EwLevel | null
  following: string[]
  me: string | null
  now: number
}

/**
 * Learning ranking (never time spent): recent + close to my level + "Correct me" posts that still
 * need a correction + unanswered questions + people I follow.
 */
export function learningScore(p: EwPost, s: EwStats | undefined, ctx: RankContext): number {
  const ageH = Math.max(0, (ctx.now - new Date(p.createdAt).getTime()) / 3600000)
  let score = Math.max(0, 1 - ageH / 72) * 3
  if (ctx.level) {
    const gap = Math.abs(LEVELS.indexOf(p.author.level) - LEVELS.indexOf(ctx.level))
    score += gap === 0 ? 1.5 : gap === 1 ? 0.5 : 0
  }
  if (p.correctMe && (s?.fixes ?? 0) === 0 && p.authorId !== ctx.me) score += 2
  if (p.kind === 'question' && !p.solvedCommentId && (s?.comments ?? 0) === 0 && p.authorId !== ctx.me) score += 2
  if (ctx.following.includes(p.authorId)) score += 1.5
  return score
}

export function rankForYou(posts: EwPost[], stats: Map<string, EwStats>, ctx: RankContext): EwPost[] {
  return posts
    .map((p, i) => ({ p, i, s: learningScore(p, stats.get(p.id), ctx) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.p)
}

/* ------------------------------ Corrections ------------------------------ */

export type DiffPart = { text: string; op: 'same' | 'del' | 'add' }

/** Word-level difference: removed words (red) and added words (green). */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.trim().split(/\s+/).filter(Boolean)
  const b = after.trim().split(/\s+/).filter(Boolean)
  const norm = (w: string): string => w.toLowerCase()
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffPart[] = []
  const push = (text: string, op: DiffPart['op']): void => {
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += ' ' + text
    else out.push({ text, op })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (norm(a[i]) === norm(b[j])) {
      push(b[j], 'same')
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push(a[i++], 'del')
    else push(b[j++], 'add')
  }
  while (i < a.length) push(a[i++], 'del')
  while (j < b.length) push(b[j++], 'add')
  return out
}

/* ------------------------------ Display ------------------------------ */

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString()
}

export const KIND_LABEL = { post: 'Post', question: 'Question', story: 'Story', win: 'Win' } as const
export const REACTIONS = [
  { type: 'learned', emoji: '💡', label: 'Learned a new word' },
  { type: 'brave', emoji: '👏', label: 'Brave try' },
  { type: 'clear', emoji: '✅', label: 'Clear English' }
] as const
export const REPORT_REASONS = [
  { reason: 'bullying', label: 'Bullying' },
  { reason: 'inappropriate', label: 'Inappropriate' },
  { reason: 'personal_info', label: 'Personal info' },
  { reason: 'spam', label: 'Spam' }
] as const

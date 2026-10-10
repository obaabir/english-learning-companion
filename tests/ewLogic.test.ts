import { beforeAll, describe, expect, it } from 'vitest'

// English World renderer logic; loaded dynamically so the main tsconfig stays unchanged.
const LOGIC = '../src/renderer/src/features/englishworld/ewLogic.ts'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let L: any
beforeAll(async () => {
  L = await import(/* @vite-ignore */ LOGIC)
})

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  authorId: 'u-' + id,
  author: { name: id, avatar: '🙂', level: 'Beginner' },
  kind: 'post',
  text: 'x',
  hasImage: false,
  bg: null,
  tags: [],
  correctMe: false,
  challengeDay: null,
  aiAnswer: null,
  solvedCommentId: null,
  hidden: false,
  createdAt: new Date(Date.UTC(2026, 9, 10, 10)).toISOString(),
  expiresAt: null,
  ...over
})

describe('English World logic', () => {
  it('60 challenge prompts; the same one for everyone on a date, a new one tomorrow', () => {
    expect(L.CHALLENGES).toHaveLength(60)
    expect(new Set(L.CHALLENGES).size).toBe(60)
    expect(L.challengeFor('2026-01-01')).toBe(L.CHALLENGES[0])
    expect(L.challengeFor('2026-03-02')).toBe(L.CHALLENGES[0]) // 60 days later
    expect(L.challengeFor('2026-10-10')).not.toBe(L.challengeFor('2026-10-11'))
  })

  it('For You is a learning ranking: Correct-me posts without corrections and unanswered questions rise', () => {
    const now = Date.UTC(2026, 9, 10, 12)
    const posts = [post('a'), post('b', { correctMe: true }), post('c', { kind: 'question' }), post('d', { author: { name: 'd', avatar: '🙂', level: 'IELTS' } })]
    const stats = new Map([
      ['b', { postId: 'b', learned: 0, brave: 0, clear: 0, fixes: 0, comments: 0, mine: [] }],
      ['c', { postId: 'c', learned: 9, brave: 9, clear: 9, fixes: 0, comments: 0, mine: [] }]
    ])
    const ranked = L.rankForYou(posts, stats, { level: 'Beginner', following: [], me: 'me', now }).map((p: { id: string }) => p.id)
    expect(ranked.slice(0, 2).sort()).toEqual(['b', 'c'])
    expect(ranked.at(-1)).toBe('d') // far from my level
    // Already corrected → no boost; reactions (likes) never add score.
    stats.set('b', { postId: 'b', learned: 50, brave: 50, clear: 50, fixes: 1, comments: 0, mine: [] })
    expect(L.learningScore(posts[1], stats.get('b'), { level: 'Beginner', following: [], me: 'me', now })).toBe(L.learningScore(posts[0], undefined, { level: 'Beginner', following: [], me: 'me', now }))
  })

  it('following and recency count', () => {
    const now = Date.UTC(2026, 9, 10, 12)
    const ctx = { level: 'Beginner', following: ['u-f'], me: 'me', now }
    expect(L.learningScore(post('f'), undefined, ctx)).toBeGreaterThan(L.learningScore(post('g'), undefined, ctx))
    const old = post('o', { createdAt: new Date(now - 5 * 86400000).toISOString() })
    expect(L.learningScore(old, undefined, ctx)).toBeLessThan(L.learningScore(post('n'), undefined, ctx))
  })

  it('correction difference: removed red, added green', () => {
    expect(L.wordDiff('I goed to school yesterday.', 'I went to school yesterday.')).toEqual([
      { text: 'I', op: 'same' },
      { text: 'goed', op: 'del' },
      { text: 'went', op: 'add' },
      { text: 'to school yesterday.', op: 'same' }
    ])
    expect(L.wordDiff('She like apples', 'She likes apples very much')).toEqual([
      { text: 'She', op: 'same' },
      { text: 'like', op: 'del' },
      { text: 'likes', op: 'add' },
      { text: 'apples', op: 'same' },
      { text: 'very much', op: 'add' }
    ])
  })

  it('personal info is caught before sending (same rules as the server)', () => {
    expect(L.personalInfo('my number 01712-345678')).toMatch(/phone/)
    expect(L.personalInfo('write to me@site.com')).toMatch(/email/)
    expect(L.personalInfo('add me on @my.insta')).toMatch(/social/)
    expect(L.personalInfo('I read 3 books in 2025.')).toBeNull()
  })

  it('quiet hours 11 pm – 7 am', () => {
    expect(L.quietHours(new Date(2026, 9, 10, 23, 30))).toBe(true)
    expect(L.quietHours(new Date(2026, 9, 10, 6, 59))).toBe(true)
    expect(L.quietHours(new Date(2026, 9, 10, 7, 0))).toBe(false)
  })
})

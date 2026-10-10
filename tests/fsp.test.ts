import { beforeAll, describe, expect, it } from 'vitest'

// Flash Sentence Practice logic lives in the renderer; loaded dynamically so the main tsconfig stays unchanged.
const FSP_LOGIC = '../src/renderer/src/features/flashcards/fsp/fspLogic.ts'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let L: any

beforeAll(async () => {
  L = await import(/* @vite-ignore */ FSP_LOGIC)
})

const card = (term: string, example = '', type = 'phrase') => ({ id: term.toLowerCase(), term, type, meaningBn: '', example })

describe('Flash Sentence Practice: term forms', () => {
  it('accepts normal verb forms', () => {
    expect(L.usesTerm('Yesterday I went to the market.', 'go')).toBe(true)
    expect(L.usesTerm('She is going home now.', 'go')).toBe(true)
    expect(L.usesTerm('He broke the ice with a funny story.', 'break the ice')).toBe(true)
    expect(L.usesTerm('Breaking the ice is hard for me.', 'break the ice')).toBe(true)
    expect(L.usesTerm('She tried hard and finally passed.', 'try')).toBe(true)
    expect(L.usesTerm('I stopped the car near the shop.', 'stop')).toBe(true)
  })
  it('handles slots, possessives and separable phrasal verbs', () => {
    expect(L.usesTerm('I finally figured it out last night.', 'figure something out')).toBe(true)
    expect(L.usesTerm('Can you figure out the answer?', 'figure out')).toBe(true)
    expect(L.usesTerm('He should mind his own business.', 'mind your own business')).toBe(true)
    expect(L.usesTerm("I'm fed up with this traffic.", '(be) fed up')).toBe(true)
    expect(L.usesTerm('She looked after her brother.', 'look after someone')).toBe(true)
  })
  it('rejects sentences without the term', () => {
    expect(L.usesTerm('I like tea very much.', 'break the ice')).toBe(false)
    expect(L.usesTerm('The ice broke in the river.', 'break the ice')).toBe(false)
  })
})

describe('Flash Sentence Practice: instant checks', () => {
  const c = card('break the ice', 'He told a joke to break the ice.', 'idiom')
  it('blocks copies of the example', () => {
    expect(L.localCheck('He told a joke to break the ice.', c)).toEqual({ ok: false, reason: 'Make your own sentence.' })
    expect(L.localCheck('he told a JOKE to break the ice!!', c).reason).toBe('Make your own sentence.')
    expect(L.localCheck('Then he told a funny joke to break the ice.', c).reason).toBe('Make your own sentence.')
  })
  it('needs 4+ words and the term', () => {
    expect(L.localCheck('Break the ice.', c).reason).toBe('Write at least 4 words.')
    expect(L.localCheck('I met new people at school today.', c).reason).toMatch(/Use “break the ice”/)
    expect(L.localCheck('', c)).toEqual({ ok: false, reason: null })
  })
  it('lets an own sentence through', () => {
    expect(L.localCheck('My cousin broke the ice at the wedding by singing.', c)).toEqual({ ok: true, reason: null })
  })
})

describe('Flash Sentence Practice: doc import, schedule, radar', () => {
  it('parses "term | type | meaning | example" lines', () => {
    const cards = L.parseDocText('Term | Type | Meaning | Example\n- break the ice | idiom | আড়ষ্টতা কাটানো | He told a joke to break the ice.\nfigure out | phrase | বুঝে বের করা |\nrandom heading line\nreluctant | | অনিচ্ছুক')
    expect(cards.map((x: { term: string; type: string }) => [x.term, x.type])).toEqual([
      ['break the ice', 'idiom'],
      ['figure out', 'phrase'],
      ['reluctant', 'word']
    ])
    expect(cards[1].example).toBe('')
  })
  it('keeps an AI example when re-importing a line without one', () => {
    const old = [{ ...card('figure out'), example: 'I will figure out the answer.', aiExample: true }]
    const { cards, added, updated } = L.mergeCards(old, [card('figure out'), card('new one')])
    expect([added, updated]).toEqual([1, 1])
    expect(cards[0]).toMatchObject({ example: 'I will figure out the answer.', aiExample: true })
  })
  it('wrong → 1 day; correct → 3, 7, 14, 30', () => {
    let s = L.scheduleCard(undefined, true, '2026-10-10')
    expect(s.due).toBe('2026-10-13')
    s = L.scheduleCard(s, true, '2026-10-13')
    expect(s.due).toBe('2026-10-20')
    s = L.scheduleCard(s, true, '2026-10-20')
    expect(s.due).toBe('2026-11-03')
    s = L.scheduleCard(s, true, '2026-11-03')
    expect(s.due).toBe('2026-12-03')
    expect(L.scheduleCard(s, false, '2026-12-03')).toMatchObject({ box: 0, due: '2026-12-04' })
  })
  it('auto level rises after 3 correct in a row', () => {
    expect(L.nextAutoLevel(1, 3)).toEqual({ level: 2, streak: 0 })
    expect(L.nextAutoLevel(1, 2)).toEqual({ level: 1, streak: 2 })
    expect(L.nextAutoLevel(5, 3)).toEqual({ level: 5, streak: 3 })
  })
  it('top 3 mistakes this week', () => {
    const log = [
      ...Array(3).fill({ type: 'article', date: '2026-10-09' }),
      ...Array(2).fill({ type: 'tense', date: '2026-10-08' }),
      { type: 'preposition', date: '2026-10-10' },
      ...Array(5).fill({ type: 'word_order', date: '2026-09-20' })
    ]
    expect(L.topMistakes(log, '2026-10-10')).toEqual([
      { type: 'article', count: 3 },
      { type: 'tense', count: 2 },
      { type: 'preposition', count: 1 }
    ])
  })
  it('parses AI results safely', () => {
    expect(() => L.sanitizeCheck('nonsense', 'x')).toThrow()
    const r = L.sanitizeCheck({ status: 'correct', usesTargetCorrectly: false, challengeMet: true, errors: [], corrected: '', optionalTip: '' }, 'My sentence here.')
    expect(r.status).toBe('wrong')
    expect(r.errors[0].type).toBe('target_use')
    expect(r.corrected).toBe('My sentence here.')
    expect(L.highlightParts('He go to school.', [{ type: 'subject_verb_agreement', wrongText: 'go', fix: 'goes', ruleBangla: '' }])).toEqual([
      { text: 'He ', wrong: false },
      { text: 'go', wrong: true },
      { text: ' to school.', wrong: false }
    ])
  })
})

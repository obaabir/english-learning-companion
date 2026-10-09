import { describe, expect, it } from 'vitest'
import { pronounce } from '../src/main/practice/pronounce'
import { matchHeard, repeatPlan } from '../src/renderer/src/features/practice/practiceLogic'
import { openDatabase } from '../src/main/db'
import { practiceStats, recordPractice } from '../src/main/db/repos/practice'

describe('pronunciation line (free CMU dictionary)', () => {
  it('gives IPA with stress, a Bangla hint, and flags hard sounds', async () => {
    const r = await pronounce('I think we have very good vegetables.')
    const by = Object.fromEntries(r.words.map((w) => [w.word.toLowerCase(), w]))
    expect(by.think.ipa).toBe('θɪŋk')
    expect(by.think.traps).toContain('th (θ)')
    expect(by.very.ipa).toBe('ˈvɛri')
    expect(by.very.traps).toContain('v')
    expect(by.we.traps).toContain('w')
    expect(by.vegetables.ipa).toMatch(/^ˈv/)
    expect(by.think.bangla).toBe('থিংক')
    const tips = r.tips.map((t) => t.tip).join('\n')
    expect(tips).toMatch(/জিভের ডগা দুই দাঁতের মাঝে/) // th tip in Bangla
    expect(tips).toMatch(/vegetables: জোর \(stress\) দিন ১ম অংশে/)
  })

  it('handles unknown words without inventing a pronunciation', async () => {
    const r = await pronounce('Malekith said hello')
    const unknown = r.words.find((w) => w.word === 'Malekith')!
    expect(unknown.ipa).toBeNull()
    expect(unknown.bangla).toBeNull()
  })
})

describe('Repeat ×N', () => {
  it('plain repeat: same speed, text shown', () => {
    expect(repeatPlan(3, false)).toEqual([
      { rate: 1, hideText: false },
      { rate: 1, hideText: false },
      { rate: 1, hideText: false }
    ])
  })

  it('smart repeat: normal with text → slower → slower without text → normal without text', () => {
    expect(repeatPlan(5, true)).toEqual([
      { rate: 1, hideText: false },
      { rate: 0.75, hideText: false },
      { rate: 0.75, hideText: true },
      { rate: 0.75, hideText: true },
      { rate: 1, hideText: true }
    ])
    expect(repeatPlan(2, true)).toEqual([
      { rate: 1, hideText: false },
      { rate: 1, hideText: true }
    ])
  })
})

describe('Speak ×N word matching', () => {
  it('marks the words the recogniser heard, in order', () => {
    const words = "I don't think that's a good idea.".split(' ')
    expect(matchHeard(words, "I don't think that a good idea")).toEqual([true, true, true, false, true, true, true])
    expect(matchHeard(words, '')).toEqual(words.map(() => false))
  })
})

describe('practice progress', () => {
  it('adds up reps, keeps ratings, and lists Hard lines for review', () => {
    const db = openDatabase(':memory:')
    const line = { lineKey: 'm@1', mediaPath: 'm.mkv', mediaTitle: 'M', start: 1, end: 3, text: 'Who are you?' }
    recordPractice(db, { ...line, listenReps: 5 })
    recordPractice(db, { ...line, speakReps: 2 })
    recordPractice(db, { ...line, rating: 'Hard' })
    recordPractice(db, { ...line, listenReps: 1 })
    recordPractice(db, { lineKey: 'm@9', mediaPath: 'm.mkv', mediaTitle: 'M', start: 9, end: 10, text: 'Fine.', speakReps: 1, rating: 'Easy' })
    const s = practiceStats(db)
    expect(s).toMatchObject({ linesPractised: 2, listenReps: 6, speakReps: 3 })
    expect(s.hardLines.map((h) => h.text)).toEqual(['Who are you?'])
  })
})

import { describe, expect, it } from 'vitest'
import { appearsIn, normalizeAnalysis, tokens } from '../src/shared/explainAnalysis'
import { AA_NORMAL, contrastRatio, readableVersion } from '../src/shared/contrast'
import { SENTENCE_WORDS_INSTRUCTION } from '../src/main/ai/sentenceWordsSchema'

const vocab = (term: string, extra = {}) => ({ term, pos: 'noun', meaning_bn: 'অর্থ', meaning_en: 'meaning', example: 'An example.', certain: true, ...extra })
const expr = (term: string, type: string, base_form = term) => ({ term, base_form, type, meaning_bn: 'অর্থ', meaning_en: 'meaning', example: 'An example.', certain: true })

describe('Explain analysis: only what is really in the text', () => {
  it('"spill the beans" (idiom) is kept; its single words are not repeated as vocabulary', () => {
    const s = 'Don’t spill the beans about the surprise party.'
    const a = normalizeAnalysis({ vocabulary: [vocab('spill'), vocab('beans'), vocab('surprise')], expressions: [expr('spill the beans', 'idiom')] }, s)
    expect(a.expressions.map((e) => [e.term, e.type])).toEqual([['spill the beans', 'idiom']])
    expect(a.vocabulary.map((v) => v.term)).toEqual(['surprise'])
  })

  it('"give up" and a separated phrasal verb ("turned the offer down") are recognised', () => {
    const a = normalizeAnalysis(
      { expressions: [expr('give up', 'phrasal verb'), expr('turned the offer down', 'phrasal verb', 'turn down')] },
      'She never gave up, but in the end she turned the offer down.'
    )
    // "give up" is written "gave up" here: kept, with the text's form shown.
    expect(a.expressions.map((e) => [e.baseForm, e.writtenAs])).toEqual([
      ['give up', 'gave up'],
      ['turn down', undefined]
    ])
    const b = normalizeAnalysis({ expressions: [expr('gave up', 'phrasal verb', 'give up')] }, 'She never gave up.')
    expect(b.expressions[0]).toMatchObject({ term: 'gave up', baseForm: 'give up', type: 'phrasal verb' })
  })

  it('an idiom or phrasal verb that is not in the text is never shown (no invented expressions)', () => {
    const a = normalizeAnalysis({ expressions: [expr('break the ice', 'idiom'), expr('look up', 'phrasal verb')] }, 'We walked to the station together.')
    expect(a.expressions).toEqual([])
  })

  it('"look up" in two contexts: both kept when present (the meaning comes from the model, per context)', () => {
    for (const s of ['Look up the word in a dictionary.', 'Things are starting to look up for us.']) {
      const a = normalizeAnalysis({ expressions: [expr('look up', 'phrasal verb')] }, s)
      expect(a.expressions).toHaveLength(1)
    }
  })

  it('no idioms or phrasal verbs → empty section (hidden), vocabulary still listed', () => {
    const a = normalizeAnalysis({ vocabulary: [vocab('reluctant'), vocab('negotiate')], expressions: [] }, 'He was reluctant to negotiate.')
    expect(a.expressions).toEqual([])
    expect(a.vocabulary.map((v) => v.term)).toEqual(['reluctant', 'negotiate'])
  })

  it('several useful words: duplicates removed, words outside the selection dropped, broken items skipped', () => {
    const a = normalizeAnalysis(
      { vocabulary: [vocab('resilient'), vocab('Resilient'), vocab('economy'), vocab('inflation'), { term: 'shocks' }, vocab('shocks')] },
      'The resilient economy absorbed the shocks.'
    )
    expect(a.vocabulary.map((v) => v.term)).toEqual(['resilient', 'economy', 'shocks'])
  })

  it('a single selected word keeps its own card even inside an expression; ambiguity and uncertainty are passed on', () => {
    const a = normalizeAnalysis(
      { vocabulary: [vocab('bank', { certain: false })], expressions: [], ambiguity: 'It could be a river bank or a money bank.' },
      'bank',
      'We sat by the bank.'
    )
    expect(a.vocabulary[0]).toMatchObject({ term: 'bank', certain: false })
    expect(a.ambiguity).toMatch(/river bank/)
  })

  it('an expression may reach outside a one-word selection into its sentence', () => {
    const a = normalizeAnalysis({ expressions: [expr('looked it up', 'phrasal verb', 'look up')] }, 'up', 'I looked it up online.')
    expect(a.expressions[0].baseForm).toBe('look up')
  })

  it('helpers: tokens and in-order matching with gaps', () => {
    expect(tokens('Don’t spill it!')).toEqual(["don't", 'spill', 'it'])
    expect(appearsIn('turn down', tokens('turn the generous offer down'))).toBe(true)
    expect(appearsIn('turn down', tokens('down the road we turn'))).toBe(false)
  })

  it('the instruction tells the model the detection rules', () => {
    for (const rule of ['Never invent', 'used literally', 'separated forms', 'THIS context', 'ambiguity']) expect(SENTENCE_WORDS_INSTRUCTION).toContain(rule)
  })
})

describe('Explain colours: WCAG contrast', () => {
  it('the default colours pass 4.5:1 on the beige-white background', () => {
    for (const fg of ['#171717', '#2457C5', '#0F766E']) expect(contrastRatio(fg, '#F7F5EF')).toBeGreaterThanOrEqual(AA_NORMAL)
  })
  it('a failing custom colour is detected and a readable version is suggested', () => {
    expect(contrastRatio('#7FB3FF', '#F7F5EF')).toBeLessThan(AA_NORMAL)
    const fixed = readableVersion('#7FB3FF', '#F7F5EF')
    expect(contrastRatio(fixed, '#F7F5EF')).toBeGreaterThanOrEqual(AA_NORMAL)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
  })
})

describe('Explain analysis: misspelled words in the source still get their card', () => {
  it('"resembled" is kept for a text that says "resemhled" (scan error), showing how the text spells it', () => {
    const a = normalizeAnalysis({ vocabulary: [vocab('resembled'), vocab('tramp'), vocab('inflation')] }, 'he may have resemhled a tramp')
    expect(a.vocabulary.map((v) => [v.term, v.writtenAs])).toEqual([
      ['resembled', 'resemhled'],
      ['tramp', undefined]
    ])
  })
  it('the model may also say how the text spells it', () => {
    const a = normalizeAnalysis({ vocabulary: [{ ...vocab('was'), term: 'was', written_as: 'wos' }] }, 'He wos in business')
    expect(a.vocabulary[0]).toMatchObject({ term: 'was', writtenAs: 'wos' })
  })
  it('a different word is still not accepted as a misspelling', () => {
    expect(normalizeAnalysis({ vocabulary: [vocab('inflation')] }, 'The economy grew').vocabulary).toEqual([])
  })
})

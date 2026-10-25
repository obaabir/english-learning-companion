import { describe, expect, it } from 'vitest'
import { findInPassage, ocrLinesToParagraphs, splitSentences, textToPages, textToParagraphs, type BookPage } from '../src/shared/reading'

const pages: BookPage[] = [
  {
    label: '12',
    paragraphs: [
      'Despite his previous failures, Tom applied again. The odds were stacked against him, but he did not give up.',
      'He reluctantly agreed to meet Mr. Smith at the bank. Then he looked it up in a dictionary.'
    ]
  },
  {
    label: '13',
    paragraphs: ['They sat on the bank of the river and watched the boats. It was inevitable that the storm would come.']
  }
]

describe('Reading Companion: preparing the passage', () => {
  it('pasted text: page marks start pages; blank lines separate paragraphs; broken words are joined', () => {
    const p = textToPages('First para line one\nline two with a hy-\nphen.\n\nSecond para.\n[page 13]\nNext page text.', '12')
    expect(p.map((x) => x.label)).toEqual(['12', '13'])
    expect(p[0].paragraphs).toEqual(['First para line one line two with a hyphen.', 'Second para.'])
    expect(p[1].paragraphs).toEqual(['Next page text.'])
  })
  it('without blank lines, each line is a paragraph', () => {
    expect(textToParagraphs('One.\nTwo.')).toEqual(['One.', 'Two.'])
  })
  it('a phrase keeps its first word ("the odds…")', async () => {
    const { parseBookRequest } = await import('../src/shared/reading')
    expect(parseBookRequest('the odds were stacked against him').query).toBe('the odds were stacked against him')
    expect(parseBookRequest('explain the word reluctantly').query).toBe('reluctantly')
  })
  it('Windows OCR lines → paragraphs at short sentence-ending lines', () => {
    const lines = ['This is a long printed line of the book page that goes on', 'and it keeps going for one more full printed line, ending', 'with a short end.', 'A new paragraph starts on this long line of text here', 'and ends.']
    expect(ocrLinesToParagraphs(lines).length).toBe(2)
  })
  it('sentences: abbreviations like "Mr." do not split', () => {
    expect(splitSentences('He met Mr. Smith. Then he left!')).toEqual(['He met Mr. Smith.', 'Then he left!'])
  })
})

describe('Reading Companion: finding what was named', () => {
  it('a word named in the command is found with its sentence and place', () => {
    const r = findInPassage(pages, 'reluctantly')
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]).toMatchObject({ pageLabel: '12', paragraph: 1, sentence: 0, matchText: 'reluctantly', exact: true })
  })
  it('a phrase and the beginning of a sentence', () => {
    expect(findInPassage(pages, 'the odds were stacked against him').matches[0].sentenceText).toBe('The odds were stacked against him, but he did not give up.')
    expect(findInPassage(pages, 'Despite his previous failures').matches[0].sentence).toBe(0)
  })
  it('page + paragraph + sentence reference ("page 12, paragraph 1, second sentence")', () => {
    const r = findInPassage(pages, '', { page: '12', paragraph: 1, sentence: 2 })
    expect(r.matches[0].sentenceText).toMatch(/^The odds/)
  })
  it('a word that appears twice ("bank") returns both places, so the learner can be asked which one', () => {
    const r = findInPassage(pages, 'bank')
    expect(r.matches.map((m) => m.pageLabel)).toEqual(['12', '13'])
    expect(findInPassage(pages, 'bank', { page: '13' }).matches).toHaveLength(1)
  })
  it('a misheard word is found approximately and marked not exact; an absent word is reported', () => {
    const r = findInPassage(pages, 'reluctanly')
    expect(r.matches[0]).toMatchObject({ matchText: 'reluctantly', exact: false })
    const none = findInPassage(pages, 'serendipity')
    expect(none.matches).toEqual([])
    expect(none.note).toMatch(/not in the prepared passage/)
  })
  it('an approximate quote finds the closest sentence', () => {
    const r = findInPassage(pages, 'it was inevitable the storm will come')
    expect(r.matches[0]?.pageLabel).toBe('13')
  })
  it('wrong references are explained, not guessed', () => {
    expect(findInPassage(pages, 'x', { page: '99' }).note).toMatch(/no page 99/)
    expect(findInPassage(pages, '', { page: '13', paragraph: 4 }).note).toMatch(/1 paragraph/)
  })
})

describe('Reading Companion: spoken commands', () => {
  it('a named word / phrase / sentence becomes a target; "this word" and other commands do not', async () => {
    const { parseCommand } = await import('../src/shared/voice')
    expect(parseCommand('Jarvis, explain the word inevitable')).toEqual({ type: 'explainTarget', target: 'inevitable' })
    expect(parseCommand('What does reluctantly mean in this passage?')).toEqual({ type: 'explainTarget', target: 'reluctantly' })
    expect(parseCommand('Explain the phrase the odds were stacked against him')).toEqual({ type: 'explainTarget', target: 'the odds were stacked against him' })
    expect(parseCommand('Explain this word in Bangla')).toMatchObject({ type: 'explain', bangla: true })
    expect(parseCommand('What is the difference between affect and effect?')).toMatchObject({ type: 'ask' })
  })
})

describe('Reading Companion: requests that name the place', () => {
  it('page / paragraph / sentence and the words are separated', async () => {
    const { parseBookRequest } = await import('../src/shared/reading')
    expect(parseBookRequest('page 68, what does inevitable mean?')).toEqual({ query: 'inevitable', ref: { page: '68' } })
    expect(parseBookRequest('I am reading page 12, paragraph 3. Explain the second sentence.')).toEqual({ query: '', ref: { page: '12', paragraph: 3, sentence: 2 } })
    expect(parseBookRequest('Explain the phrase "the odds were stacked against him"')).toEqual({ query: 'the odds were stacked against him', ref: {} })
    expect(parseBookRequest('on the other hand')).toEqual({ query: 'on the other hand', ref: {} })
    expect(parseBookRequest('reluctantly')).toEqual({ query: 'reluctantly', ref: {} })
  })
})

describe('Reading Companion: JARVIS Voice Mode tool', () => {
  it('explain_from_book takes the words and an optional page / paragraph / sentence', async () => {
    const { validateToolCall } = await import('../src/shared/liveTools')
    expect(validateToolCall('explain_from_book', { query: 'inevitable', page: '68' })).toMatchObject({ ok: true, args: { query: 'inevitable', page: '68' } })
    expect(validateToolCall('explain_from_book', { page: '12', paragraph: '3', sentence: '2' })).toMatchObject({ ok: true })
    expect(validateToolCall('explain_from_book', { book: 'x' })).toMatchObject({ ok: false })
    expect(validateToolCall('open_section', { section: 'reading_companion' })).toMatchObject({ ok: true })
  })
})

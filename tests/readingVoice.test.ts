import { describe, expect, it } from 'vitest'
import { readyUtterance } from '../src/shared/reading'

const u = (text: string, done = false) => ({ role: 'user' as const, text, done })
const m = (text: string, done = false) => ({ role: 'model' as const, text, done })

describe('Reading Companion: when a spoken sentence is checked', () => {
  it('only once it is complete (turn ended or JARVIS started answering), once per sentence', () => {
    expect(readyUtterance([u('what does reluc')])).toBeNull()
    const a = readyUtterance([u('what does reluctantly mean'), m('It means')])
    expect(a?.text).toBe('what does reluctantly mean')
    // JARVIS's answer growing doesn't make it "new" again.
    expect(readyUtterance([u('what does reluctantly mean'), m('It means unwillingly.', true)])?.key).toBe(a?.key)
    // The next thing said is checked next.
    expect(readyUtterance([u('what does reluctantly mean', true), m('x', true), u('and inevitable', true)])?.text).toBe('and inevitable')
  })
})

describe('Reading Companion: questions asked in Bangla / Hindi', () => {
  const pages = [
    {
      label: '1',
      paragraphs: [
        'Barnes succeeded because he chose a definite goal, placed all his energy behind that goal. He may have resemhled a tramp. Don’t spill the beans.'
      ]
    }
  ]
  it('the English word right before "মানে" / "मतलब" is the target', async () => {
    const { spokenTarget } = await import('../src/shared/reading')
    // The real transcript from the app: the word, a reading of the sentence, and the question in Hindi.
    expect(spokenTarget(pages, 'definite মানে কী? You choose a definite goal. इस जगह definite माने की?')?.matches[0].matchText).toBe('definite')
    expect(spokenTarget(pages, 'spill the beans মানে কি')?.matches[0].matchText).toBe('spill the beans')
    expect(spokenTarget(pages, 'tramp का मतलब क्या है')?.matches[0].matchText).toBe('tramp')
  })
  it('JARVIS quoting the word in its reply also finds it', async () => {
    const { replyTarget, replyText } = await import('../src/shared/reading')
    expect(replyTarget(pages, '"Definite" মানে হলো নির্দিষ্ট বা স্পষ্ট। For example, "She has a definite plan for the future."')?.matches[0].matchText).toBe('definite')
    expect(replyTarget(pages, 'Nothing quoted here.')).toBeNull()
    expect(replyText([{ role: 'user', text: 'a' }, { role: 'model', text: 'It means' }, { role: 'model', text: 'x' }])).toBe('It means x')
  })
})

describe('Reading Companion: a word in two places, with the sentence said too', () => {
  it('the place whose sentence matches what was said is chosen (no question needed)', async () => {
    const { spokenTarget } = await import('../src/shared/reading')
    const pages = [{ label: '1', paragraphs: ['It was DEFINITE. The desire was not new.', 'Barnes succeeded because he chose a definite goal.'] }]
    const r = spokenTarget(pages, 'definite মানে কী? You choose a definite goal.')
    expect(r?.matches).toHaveLength(1)
    expect(r?.matches[0].paragraph).toBe(1)
    // Without the sentence, both places are offered.
    expect(spokenTarget(pages, 'definite মানে কী?')?.matches).toHaveLength(2)
  })
})

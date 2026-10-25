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

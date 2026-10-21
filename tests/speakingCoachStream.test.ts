import { describe, expect, it } from 'vitest'
import { completeSegments } from '../src/renderer/src/features/speakingcoach/transcriptFormat'

describe('Speaking Coach: lines shown while Gemini is still writing', () => {
  it('only finished lines are taken; a half-written line waits', () => {
    const soFar = '{"segments":[{"start":"00:00","end":"00:04","text":"I goes to market."},{"start":"00:04","end":"00:08","text":"He said \\"um, ok\\" আমি"},{"start":"00:08","end":"00:1'
    expect(completeSegments(soFar)).toEqual([
      { start: '00:00', end: '00:04', text: 'I goes to market.' },
      { start: '00:04', end: '00:08', text: 'He said "um, ok" আমি' }
    ])
  })

  it('nothing finished yet → nothing shown; empty lines are skipped', () => {
    expect(completeSegments('{"segments":[{"start":"00:00","end":"00:0')).toEqual([])
    expect(completeSegments('{"segments":[{"start":"00:00","end":"00:02","text":"  "}]}')).toEqual([])
  })
})

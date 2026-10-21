import { describe, expect, it } from 'vitest'
import { parseCommand, rainWindow } from '../src/shared/voice'
import { validateToolCall } from '../src/shared/liveTools'

describe('Home weather: when rain is expected (from the hourly forecast only)', () => {
  const times = Array.from({ length: 24 }, (_, h) => `2026-10-21T${String(h).padStart(2, '0')}:00`)
  const none = times.map(() => 10)
  it('finds the first stretch of likely rain from now', () => {
    const chance = none.map((c, h) => (h >= 16 && h <= 17 ? 70 : h === 18 ? 55 : c))
    expect(rainWindow('2026-10-21T13:30', times, chance, [])).toEqual({ start: '16:00', end: '19:00', chance: 70, tomorrow: false })
  })
  it('no likely hour → null (nothing invented); rain already falling counts', () => {
    expect(rainWindow('2026-10-21T09:00', times, none, [])).toBeNull()
    const mm = times.map((_, h) => (h === 9 ? 1.2 : 0))
    expect(rainWindow('2026-10-21T09:15', times, none, mm)).toMatchObject({ start: '09:00', end: '10:00' })
  })
})

describe('JARVIS: more commands', () => {
  it('opens every section, goes back and home', () => {
    expect(parseCommand('Open Speaking Coach')).toMatchObject({ type: 'open', page: 'speaking' })
    expect(parseCommand('open the vocabulary book')).toMatchObject({ type: 'open', page: 'vocabbook' })
    expect(parseCommand('Jarvis, go home')).toMatchObject({ type: 'open', page: 'home' })
    expect(parseCommand('go back')).toEqual({ type: 'back' })
  })
  it('controls the movie player and refreshes', () => {
    expect(parseCommand('pause the movie')).toEqual({ type: 'player', command: 'pause' })
    expect(parseCommand('resume')).toEqual({ type: 'player', command: 'play' })
    expect(parseCommand('open a movie')).toEqual({ type: 'player', command: 'open' })
    expect(parseCommand('refresh')).toEqual({ type: 'refresh' })
    // Games still work.
    expect(parseCommand('play a vocabulary game')).toMatchObject({ type: 'game' })
  })
  it('Voice Mode tools: only listed sections and actions are accepted', () => {
    expect(validateToolCall('open_section', { section: 'speaking_coach' })).toMatchObject({ ok: true })
    expect(validateToolCall('control_movie', { action: 'pause' })).toMatchObject({ ok: true })
    expect(validateToolCall('control_movie', { action: 'delete' })).toMatchObject({ ok: false })
    expect(validateToolCall('go_back', {})).toMatchObject({ ok: true })
  })
})

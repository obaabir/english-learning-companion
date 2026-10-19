import { describe, expect, it } from 'vitest'
import { isWakeOnly, parseCommand, weatherSentence } from '../src/shared/voice'
import { getWeather } from '../src/main/voice/weather'

describe('voice commands → app actions', () => {
  it('maps the 10 requested commands', () => {
    expect(parseCommand('Explain this word in Bangla.')).toEqual({ type: 'explain', bangla: true })
    expect(parseCommand('Save this word to vocabulary.')).toMatchObject({ type: 'save', kind: 'word' })
    expect(parseCommand('Save this sentence structure.')).toMatchObject({ type: 'save', kind: 'structure' })
    expect(parseCommand('Add this to flashcards.')).toEqual({ type: 'flashcard' })
    expect(parseCommand('Open Articles.')).toMatchObject({ type: 'open', page: 'articles' })
    expect(parseCommand('Open IELTS.')).toMatchObject({ type: 'open', page: 'ielts' })
    expect(parseCommand("Show today's revision.")).toEqual({ type: 'revision', start: false })
    expect(parseCommand('Start a vocabulary game.')).toMatchObject({ type: 'game', mode: 'vocab-match' })
    expect(parseCommand('Show my saved notes.')).toMatchObject({ type: 'open', page: 'notes' })
    expect(parseCommand('Read this sentence aloud.')).toEqual({ type: 'read', what: 'sentence' })
    expect(parseCommand('Read this word aloud')).toEqual({ type: 'read', what: 'word' })
  })

  it('understands the wake phrase and polite forms', () => {
    expect(parseCommand('Hey Jarvis, open Articles')).toMatchObject({ type: 'open', page: 'articles' })
    expect(parseCommand('jarvis could you start revision please')).toEqual({ type: 'revision', start: true })
    expect(isWakeOnly('Hey Jarvis')).toBe(true)
    expect(isWakeOnly('Hey Jarvis open articles')).toBe(false)
  })

  it('asks when a command is unclear', () => {
    const save = parseCommand('save this')
    expect(save.type).toBe('clarify')
    expect(save.type === 'clarify' && save.options.map((o) => o.label)).toEqual(['Vocabulary', 'Sentences', 'Sentence structures', 'Idioms', 'Phrasal verbs'])
    expect(parseCommand('play a game').type).toBe('clarify')
    expect(parseCommand('open the thing').type).toBe('clarify')
  })

  it('destructive commands are confirmed or refused', () => {
    expect(parseCommand('delete this chat')).toEqual({ type: 'deleteChat' })
    expect(parseCommand('delete all my notes').type).toBe('unsupported')
  })

  it('weather, time, date and general questions', () => {
    expect(parseCommand("Hey Jarvis, what's the weather?")).toEqual({ type: 'weather', city: null })
    expect(parseCommand("What's the weather in Dhaka?")).toEqual({ type: 'weather', city: 'dhaka' })
    expect(parseCommand('What time is it?')).toEqual({ type: 'time' })
    expect(parseCommand('What day is it today?')).toEqual({ type: 'date' })
    expect(parseCommand('What is the difference between affect and effect?')).toMatchObject({ type: 'ask' })
    expect(parseCommand('banana')).toEqual({ type: 'unknown' })
  })
})

describe('weather (Open-Meteo, free)', () => {
  it('finds the city and describes the weather', async () => {
    const fake = (async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('geocoding')
            ? { results: [{ name: 'Dhaka', country: 'Bangladesh', latitude: 23.7, longitude: 90.4 }] }
            : { current: { temperature_2m: 31.2, apparent_temperature: 36.4, weather_code: 2, wind_speed_10m: 9 }, daily: { temperature_2m_max: [33], temperature_2m_min: [26.4], precipitation_probability_max: [40] } }
        )
      )) as unknown as typeof fetch
    const w = await getWeather('dhaka', fake)
    expect(weatherSentence(w)).toBe("In Dhaka, Bangladesh it's 31 degrees and partly cloudy, feels like 36. Today: high 33, low 26, 40% chance of rain.")
    await expect(getWeather('', fake)).rejects.toThrow(/Which city/)
  })
})

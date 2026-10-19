import { describe, expect, it } from 'vitest'
import { windowsVoiceWav } from '../src/main/practice/voice'
import { recognizeWav } from '../src/main/voice/recognizer'
import { COMMAND_PHRASES, COMMAND_TAILS, parseCommand, WAKE_PHRASES } from '../src/shared/voice'

// Real Windows speech, offline: a Windows voice says each command, the Windows recognizer hears it,
// and the parser turns it into the right action. (A synthetic voice is clearer than a person.)
describe.skipIf(process.platform !== 'win32')('Windows offline speech recognition', () => {
  const cases: [string, string][] = [
    ['Explain this word in Bangla.', 'explain'],
    ['Save this word to vocabulary.', 'save'],
    ['Save this sentence structure.', 'save'],
    ['Add this to flashcards.', 'flashcard'],
    ['Open Articles.', 'open'],
    ['Open IELTS.', 'open'],
    ["Show today's revision.", 'revision'],
    ['Start a vocabulary game.', 'game'],
    ['Show my saved notes.', 'open'],
    ['Read this sentence aloud.', 'read'],
    ['Hey Jarvis, open Articles.', 'open'],
    ["What's the weather in London?", 'weather']
  ]
  for (const [spoken, type] of cases) {
    it(`"${spoken}" → ${type}`, async () => {
      const r = await recognizeWav(await windowsVoiceWav(spoken), { phrases: COMMAND_PHRASES, tails: COMMAND_TAILS, dictation: true })
      console.log(JSON.stringify(spoken), '→', JSON.stringify(r))
      expect(r.grammar).not.toBe('dictation')
      expect(parseCommand(r.text).type).toBe(type)
    }, 60_000)
  }

  it('"Hey Jarvis" alone is recognized by the wake grammar', async () => {
    const r = await recognizeWav(await windowsVoiceWav('Hey Jarvis.'), { phrases: WAKE_PHRASES, tails: [], dictation: false })
    expect(r.text.toLowerCase()).toBe('hey jarvis')
  }, 60_000)
})

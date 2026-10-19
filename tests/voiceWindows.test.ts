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
  /** The app's two steps: commands + free speech first; if that isn't clear, commands only. */
  const recognize = async (wav: string) => {
    const first = await recognizeWav(wav, { phrases: COMMAND_PHRASES, tails: COMMAND_TAILS, dictation: true })
    if (first.text && first.confidence >= (first.grammar === 'dictation' ? 0.6 : 0.5)) return first
    const second = await recognizeWav(wav, { phrases: COMMAND_PHRASES, tails: COMMAND_TAILS, dictation: false })
    return second.confidence >= 0.6 ? second : first
  }
  for (const [spoken, type] of cases) {
    it(`"${spoken}" → ${type}`, async () => {
      const r = await recognize(await windowsVoiceWav(spoken))
      console.log(JSON.stringify(spoken), '→', JSON.stringify(r))
      expect(r.grammar).not.toBe('dictation')
      expect(parseCommand(r.text).type).toBe(type)
    }, 60_000)
  }

  it('"Hey Jarvis" alone is understood offline by the command grammar too (mic button), not sent to Gemini', async () => {
    const r = await recognize(await windowsVoiceWav('Hey Jarvis.'))
    expect(r.text.toLowerCase()).toBe('hey jarvis')
    expect(r.grammar).toBe('command')
  }, 60_000)

  for (const question of ['What is the capital of France?', 'How do I use the present perfect tense?', 'Tell me a short story about a cat.']) {
    it(`a real question is not mistaken for a command: "${question}"`, async () => {
      const r = await recognize(await windowsVoiceWav(question))
      console.log(JSON.stringify(question), '→', JSON.stringify(r))
      expect(r.grammar === 'command' || r.grammar === 'tail').toBe(false)
    }, 60_000)
  }

  it('"Hey Jarvis" alone is recognized by the wake grammar', async () => {
    const r = await recognizeWav(await windowsVoiceWav('Hey Jarvis.'), { phrases: WAKE_PHRASES, tails: [], dictation: false })
    expect(r.text.toLowerCase()).toBe('hey jarvis')
  }, 60_000)
})

import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { insertChat, insertMessage, listMessages } from '../src/main/db/repos/chats'
import { insertNote, listNotes } from '../src/main/db/repos/notes'
import { buildFocusedQuestion } from '../src/main/ai/gemini'

// Phase 1: the chat knows the exact text highlighted in the explanation / a chat answer.
describe('Chat focus (highlighted text)', () => {
  it('adds the highlight, original sentence and nearby explanation to the question', () => {
    const q = buildFocusedQuestion('Why is this used here?', {
      text: "I'd rather",
      sentence: "I'd rather be dead.",
      excerpt: '"I\'d rather" + base verb shows a strong preference.',
      source: 'explanation'
    })
    expect(q).toContain('highlighted this text and is asking about it: "I\'d rather"')
    expect(q).toContain('Original sentence: "I\'d rather be dead."')
    expect(q).toContain('Where it appears in the explanation')
    expect(q.trim().endsWith('Why is this used here?')).toBe(true)
  })

  it('leaves questions without a highlight unchanged', () => {
    expect(buildFocusedQuestion('Hello?', null)).toBe('Hello?')
    expect(buildFocusedQuestion('Hello?', { text: '  ', source: 'chat' })).toBe('Hello?')
  })

  it('stores the highlight with the question so later turns keep it', () => {
    const db = openDatabase(':memory:')
    const chat = insertChat(db, { title: 't', promptId: null, contextText: null, contextSentence: null, mediaPath: null, mediaTitle: null, timestampSec: null })
    insertMessage(db, chat.id, 'user', 'Why is this used here?', { text: 'rather', source: 'chat' })
    insertMessage(db, chat.id, 'model', 'Because…')
    const [q, a] = listMessages(db, chat.id)
    expect(q.focus).toEqual({ text: 'rather', source: 'chat' })
    expect(a.focus).toBeNull()
  })

  it('saves grammar and general notes', () => {
    const db = openDatabase(':memory:')
    insertNote(db, { kind: 'grammar', text: 'would rather + base verb' }, null)
    insertNote(db, { kind: 'general', text: 'Watch S01E03 again' }, null)
    expect(listNotes(db, { kinds: ['grammar'] })).toHaveLength(1)
    expect(listNotes(db, { kinds: ['general'] })).toHaveLength(1)
  })
})

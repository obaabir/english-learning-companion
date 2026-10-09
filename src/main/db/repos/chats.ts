import type { Chat, ChatMessage } from '@shared/types'
import type { Db } from '../index'

interface ChatRow {
  id: number
  title: string
  prompt_id: number | null
  context_text: string | null
  context_sentence: string | null
  media_path: string | null
  media_title: string | null
  timestamp_sec: number | null
  created_at: string
}

interface MessageRow {
  id: number
  chat_id: number
  role: 'user' | 'model'
  content: string
  created_at: string
}

const toChat = (r: ChatRow): Chat => ({
  id: r.id,
  title: r.title,
  promptId: r.prompt_id,
  contextText: r.context_text,
  contextSentence: r.context_sentence,
  mediaPath: r.media_path,
  mediaTitle: r.media_title,
  timestampSec: r.timestamp_sec,
  createdAt: r.created_at
})

const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  chatId: r.chat_id,
  role: r.role,
  content: r.content,
  createdAt: r.created_at
})

export function insertChat(db: Db, c: Omit<Chat, 'id' | 'createdAt'>): Chat {
  const res = db
    .prepare(
      `INSERT INTO chats (title, prompt_id, context_text, context_sentence, media_path, media_title, timestamp_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(c.title, c.promptId, c.contextText, c.contextSentence, c.mediaPath, c.mediaTitle, c.timestampSec)
  return getChat(db, Number(res.lastInsertRowid))!
}

export function getChat(db: Db, id: number): Chat | null {
  const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as ChatRow | undefined
  return row ? toChat(row) : null
}

export function listChats(db: Db, limit = 100): Chat[] {
  return (db.prepare('SELECT * FROM chats ORDER BY id DESC LIMIT ?').all(limit) as unknown as ChatRow[]).map(toChat)
}

export function deleteChat(db: Db, id: number): void {
  db.prepare('DELETE FROM chats WHERE id = ?').run(id)
}

export function insertMessage(db: Db, chatId: number, role: 'user' | 'model', content: string): ChatMessage {
  const res = db.prepare('INSERT INTO chat_messages (chat_id, role, content) VALUES (?, ?, ?)').run(chatId, role, content)
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(Number(res.lastInsertRowid)) as unknown as MessageRow
  return toMessage(row)
}

export function listMessages(db: Db, chatId: number): ChatMessage[] {
  return (
    db.prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY id').all(chatId) as unknown as MessageRow[]
  ).map(toMessage)
}

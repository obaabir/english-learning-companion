import type { Prompt } from '@shared/types'
import { tx, type Db } from '../index'

interface PromptRow {
  id: number
  name: string
  instruction: string
  is_default: number
  created_at: string
  updated_at: string
}

const toPrompt = (r: PromptRow): Prompt => ({
  id: r.id,
  name: r.name,
  instruction: r.instruction,
  isDefault: r.is_default === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function listPrompts(db: Db): Prompt[] {
  return (db.prepare('SELECT * FROM prompts ORDER BY is_default DESC, name').all() as unknown as PromptRow[]).map(toPrompt)
}

export function getPrompt(db: Db, id: number): Prompt | null {
  const row = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as PromptRow | undefined
  return row ? toPrompt(row) : null
}

export function getDefaultPrompt(db: Db): Prompt | null {
  const row = db.prepare('SELECT * FROM prompts ORDER BY is_default DESC, id LIMIT 1').get() as PromptRow | undefined
  return row ? toPrompt(row) : null
}

/** Resolves a prompt id, falling back to the default prompt. */
export function resolvePrompt(db: Db, id: number | null | undefined): Prompt | null {
  return (id != null ? getPrompt(db, id) : null) ?? getDefaultPrompt(db)
}

export function savePrompt(db: Db, p: { id?: number; name: string; instruction: string }): Prompt {
  const name = p.name.trim()
  const instruction = p.instruction.trim()
  if (!name) throw new Error('Prompt name is required.')
  if (!instruction) throw new Error('Prompt instruction is required.')
  if (p.id != null) {
    db.prepare(
      "UPDATE prompts SET name = ?, instruction = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).run(name, instruction, p.id)
    return getPrompt(db, p.id)!
  }
  const hasAny = (db.prepare('SELECT COUNT(*) AS n FROM prompts').get() as { n: number }).n > 0
  const res = db.prepare('INSERT INTO prompts (name, instruction, is_default) VALUES (?, ?, ?)').run(name, instruction, hasAny ? 0 : 1)
  return getPrompt(db, Number(res.lastInsertRowid))!
}

export function deletePrompt(db: Db, id: number): void {
  tx(db, () => {
    const wasDefault = getPrompt(db, id)?.isDefault
    db.prepare('DELETE FROM prompts WHERE id = ?').run(id)
    if (wasDefault) {
      db.prepare('UPDATE prompts SET is_default = 1 WHERE id = (SELECT id FROM prompts ORDER BY id LIMIT 1)').run()
    }
  })
}

export function setDefaultPrompt(db: Db, id: number): void {
  tx(db, () => {
    db.prepare('UPDATE prompts SET is_default = 0').run()
    db.prepare('UPDATE prompts SET is_default = 1 WHERE id = ?').run(id)
  })
}

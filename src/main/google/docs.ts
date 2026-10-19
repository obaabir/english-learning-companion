import { DOC_CATEGORIES, NOTE_KINDS, docCategoryForNote, formatTimestamp, type Note } from '@shared/types'

export interface DocEntry {
  title: string
  fields: { label: string; value: string }[]
}

/** Google Docs batchUpdate request (only the shapes we use). */
export type DocsRequest =
  | { insertText: { location: { index: number }; text: string } }
  | {
      updateParagraphStyle: {
        range: { startIndex: number; endIndex: number }
        paragraphStyle: { namedStyleType: string }
        fields: string
      }
    }
  | {
      updateTextStyle: {
        range: { startIndex: number; endIndex: number }
        textStyle: { bold: boolean }
        fields: string
      }
    }

const bullet = (s: string): string => `• ${s}`

/** The line written into the doc that identifies a record, so it is never appended twice. */
export const recordIdLine = (uid: string): string => `elc-${uid}`

/** Markdown explanation as plain text for the doc (heading and bold marks removed). */
const plain = (md: string): string =>
  md
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^>\s?/gm, '')
    .trim()

export function noteToDocEntry(note: Note, now = new Date()): DocEntry {
  const d = note.data
  const fields: DocEntry['fields'] = [
    { label: 'Category', value: DOC_CATEGORIES.find((c) => c.value === docCategoryForNote(note))?.label ?? '' },
    { label: 'Type', value: NOTE_KINDS.find((k) => k.value === note.kind)?.label ?? note.kind }
  ]
  if (note.contextSentence && note.contextSentence !== note.text) {
    fields.push({ label: 'Sentence', value: note.contextSentence })
  }
  if (d) {
    fields.push({ label: 'Meaning (Bangla)', value: d.meaning_bn })
    fields.push({ label: 'Meaning (English)', value: d.meaning_en })
    fields.push({
      label: 'Vocabulary',
      value: d.vocabulary.map((v) => bullet(`${v.term} — ${v.meaning_bn}${v.note ? ` (${v.note})` : ''}`)).join('\n')
    })
    fields.push({
      label: 'Idioms / Phrasal verbs',
      value: d.idioms_phrasal.map((v) => bullet(`${v.term} — ${v.meaning_bn}${v.note ? ` (${v.note})` : ''}`)).join('\n')
    })
    fields.push({ label: 'Grammar', value: d.grammar.map((g) => bullet(`${g.pattern} — ${g.explanation}`)).join('\n') })
    fields.push({ label: 'Examples', value: d.examples.map((e) => bullet(`${e.en}\n   ${e.bn}`)).join('\n') })
    if (note.explanationMd) fields.push({ label: 'Explanation', value: plain(note.explanationMd).slice(0, 1500) })
  } else if (note.explanationMd) {
    fields.push({ label: 'Explanation', value: plain(note.explanationMd).slice(0, 5000) })
  }
  if (note.userNote) fields.push({ label: 'My note', value: note.userNote })
  if (note.mediaTitle) fields.push({ label: 'Source', value: note.mediaTitle })
  if (note.sourceUrl) fields.push({ label: 'Source URL', value: note.sourceUrl })
  if (note.timestampSec != null) fields.push({ label: 'Timestamp', value: formatTimestamp(note.timestampSec) })
  if (note.ieltsRef) fields.push({ label: 'IELTS question', value: note.ieltsRef })
  // The date the item was saved (SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC, or ISO).
  const saved = note.createdAt ? new Date(note.createdAt.includes('T') ? note.createdAt : `${note.createdAt.replace(' ', 'T')}Z`) : now
  fields.push({ label: 'Saved', value: (isNaN(saved.getTime()) ? now : saved).toISOString().slice(0, 10) })
  if (note.uid) fields.push({ label: 'Record ID', value: recordIdLine(note.uid) })
  return { title: note.text, fields: fields.filter((f) => f.value.trim()) }
}

/**
 * Builds requests that append a formatted entry at insertIndex: a Heading 2 title,
 * bold field labels, and normal body text. Indices are UTF-16 code units, which
 * matches both JavaScript strings and the Docs API.
 */
export function buildAppendRequests(entry: DocEntry, insertIndex: number): DocsRequest[] {
  let text = '\n'
  const titleStart = insertIndex + text.length
  text += entry.title.replace(/\s+/g, ' ').trim()
  const titleEnd = insertIndex + text.length
  text += '\n'
  const labelRanges: [number, number][] = []
  for (const f of entry.fields) {
    const start = insertIndex + text.length
    text += `${f.label}:`
    labelRanges.push([start, insertIndex + text.length])
    text += f.value.includes('\n') ? `\n${f.value}\n` : ` ${f.value}\n`
  }
  text += '────────────\n'
  const end = insertIndex + text.length

  return [
    { insertText: { location: { index: insertIndex }, text } },
    {
      updateParagraphStyle: {
        range: { startIndex: insertIndex, endIndex: end },
        paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
        fields: 'namedStyleType'
      }
    },
    { updateTextStyle: { range: { startIndex: insertIndex, endIndex: end }, textStyle: { bold: false }, fields: 'bold' } },
    {
      updateParagraphStyle: {
        range: { startIndex: titleStart, endIndex: titleEnd },
        paragraphStyle: { namedStyleType: 'HEADING_2' },
        fields: 'namedStyleType'
      }
    },
    ...labelRanges.map(
      ([startIndex, endIndex]): DocsRequest => ({
        updateTextStyle: { range: { startIndex, endIndex }, textStyle: { bold: true }, fields: 'bold' }
      })
    )
  ]
}

/** The index just before the document's final newline, where new content is appended. */
export function endInsertIndex(body: { content?: { endIndex?: number }[] } | undefined): number {
  const last = body?.content?.at(-1)?.endIndex
  return last && last > 1 ? last - 1 : 1
}

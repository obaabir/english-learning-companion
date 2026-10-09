import { NOTE_KINDS, formatTimestamp, type Note } from '@shared/types'

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

export function noteToDocEntry(note: Note, now = new Date()): DocEntry {
  const d = note.data
  const fields: DocEntry['fields'] = [
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
  } else if (note.explanationMd) {
    fields.push({ label: 'Explanation', value: note.explanationMd.slice(0, 5000) })
  }
  if (note.userNote) fields.push({ label: 'My note', value: note.userNote })
  if (note.mediaTitle) fields.push({ label: 'Source', value: note.mediaTitle })
  if (note.timestampSec != null) fields.push({ label: 'Timestamp', value: formatTimestamp(note.timestampSec) })
  fields.push({ label: 'Saved', value: now.toISOString().slice(0, 10) })
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

import type { Note } from '@shared/types'

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

/** The line written into the doc that identifies a record, so it is never appended twice. */
export const recordIdLine = (uid: string): string => `elc-${uid}`

/**
 * What goes into Google Docs for a saved item: just its Bangla meaning, English meaning and one example
 * (with its Bangla line). Everything else stays in the app. The record ID line lets the app check, after
 * a lost connection, whether the entry already arrived, so nothing is written twice.
 */
export function noteToDocEntry(note: Note): DocEntry {
  const d = note.data
  const fields: DocEntry['fields'] = []
  if (d) {
    fields.push({ label: 'Meaning (Bangla)', value: d.meaning_bn })
    fields.push({ label: 'Meaning (English)', value: d.meaning_en })
    const ex = d.examples[0]
    if (ex) fields.push({ label: 'Example', value: ex.bn ? `${ex.en}\n${ex.bn}` : ex.en })
  }
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

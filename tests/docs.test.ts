import { describe, expect, it } from 'vitest'
import { buildAppendRequests, endInsertIndex, noteToDocEntry } from '../src/main/google/docs'
import type { Note } from '../src/shared/types'

const note: Note = {
  id: 1,
  kind: 'sentence',
  text: "I don't think that's a good idea.",
  contextSentence: null,
  explanationMd: null,
  data: {
    meaning_bn: 'আমার মনে হয় না এটা ভালো বুদ্ধি।',
    meaning_en: 'I believe this plan is not wise.',
    vocabulary: [{ term: 'good idea', meaning_bn: 'ভালো বুদ্ধি', note: 'common collocation' }],
    idioms_phrasal: [],
    grammar: [{ pattern: "I don't think + clause", explanation: 'polite disagreement' }],
    examples: [{ en: "I don't think that's true.", bn: 'আমার মনে হয় না এটা সত্যি।' }]
  },
  mediaPath: 'C:/movies/film.mkv',
  mediaTitle: 'Film',
  timestampSec: 3725,
  promptId: null,
  gdocId: null,
  gdocSyncedAt: null,
  gdocError: null,
  userNote: null,
  createdAt: '2026-10-09T00:00:00Z'
}

describe('Google Docs entry', () => {
  it('only the Bangla meaning, English meaning and one example (plus the record ID) go to the doc', () => {
    const entry = noteToDocEntry(note)
    const byLabel = Object.fromEntries(entry.fields.map((f) => [f.label, f.value]))
    expect(entry.title).toBe(note.text)
    expect(byLabel['Meaning (Bangla)']).toBe(note.data!.meaning_bn)
    expect(byLabel['Meaning (English)']).toBe(note.data!.meaning_en)
    expect(entry.fields.map((f) => f.label).every((l) => ['Meaning (Bangla)', 'Meaning (English)', 'Example', 'Record ID'].includes(l))).toBe(true)
    expect(entry.fields.filter((f) => f.label === 'Example').length).toBeLessThanOrEqual(1)
  })

  it('computes style ranges that match the inserted text', () => {
    const entry = noteToDocEntry(note)
    const insertAt = 42
    const requests = buildAppendRequests(entry, insertAt)
    const insert = requests[0]
    if (!('insertText' in insert)) throw new Error('first request must insert text')
    const text = insert.insertText.text
    const slice = (r: { startIndex: number; endIndex: number }): string => text.slice(r.startIndex - insertAt, r.endIndex - insertAt)

    const heading = requests.find((r) => 'updateParagraphStyle' in r && r.updateParagraphStyle.paragraphStyle.namedStyleType === 'HEADING_2')
    if (!heading || !('updateParagraphStyle' in heading)) throw new Error('missing heading')
    expect(slice(heading.updateParagraphStyle.range)).toBe(note.text)

    const bold = requests.filter((r) => 'updateTextStyle' in r && r.updateTextStyle.textStyle.bold)
    const labels = bold.map((r) => ('updateTextStyle' in r ? slice(r.updateTextStyle.range) : ''))
    expect(labels).toEqual(entry.fields.map((f) => `${f.label}:`))
  })

  it('appends before the final newline of the document', () => {
    expect(endInsertIndex({ content: [{ endIndex: 1 }, { endIndex: 120 }] })).toBe(119)
    expect(endInsertIndex({ content: [{ endIndex: 1 }, { endIndex: 2 }] })).toBe(1)
    expect(endInsertIndex(undefined)).toBe(1)
  })
})

import { Type, type Schema } from '@google/genai'

/** Reading Companion: one photographed page of a printed English book, transcribed exactly. */
export const BOOK_PAGE_INSTRUCTION = `You transcribe one photographed page of a printed English book for a reader who will ask about its words.
- Copy the main text EXACTLY as printed: same words, spelling, punctuation and order. Never correct, modernise, summarise or add anything.
- paragraphs: one string per printed paragraph, in reading order. Join the lines of a paragraph with spaces; a word broken with a hyphen at the end of a line is written as one word.
- Leave out running headers, footers and the page number line, but put the printed page number (if visible) in page_number.
- If a word cannot be read (blurred, cut off, covered by a finger), write [unclear] in its place. Never guess.
- If part of the page is missing from the photo, still transcribe what is visible and say so in note.
- note: one short sentence about anything that may be wrong (blur, cut-off lines); otherwise "".`

export const BOOK_PAGE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    page_number: { type: Type.STRING },
    paragraphs: { type: Type.ARRAY, items: { type: Type.STRING } },
    note: { type: Type.STRING }
  },
  required: ['page_number', 'paragraphs', 'note'],
  propertyOrdering: ['page_number', 'paragraphs', 'note']
}

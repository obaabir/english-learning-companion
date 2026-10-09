import { Type, type Schema } from '@google/genai'

const termItem: Schema = {
  type: Type.OBJECT,
  properties: {
    term: { type: Type.STRING },
    meaning_bn: { type: Type.STRING, description: 'Natural Bangla meaning' },
    note: { type: Type.STRING, description: 'Short usage note in simple English' }
  },
  required: ['term', 'meaning_bn', 'note'],
  propertyOrdering: ['term', 'meaning_bn', 'note']
}

export const NOTE_DATA_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    meaning_bn: { type: Type.STRING, description: 'Natural Bangla translation of the text' },
    meaning_en: { type: Type.STRING, description: 'Meaning in simple English' },
    vocabulary: { type: Type.ARRAY, items: termItem },
    idioms_phrasal: { type: Type.ARRAY, items: termItem },
    grammar: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { pattern: { type: Type.STRING }, explanation: { type: Type.STRING } },
        required: ['pattern', 'explanation'],
        propertyOrdering: ['pattern', 'explanation']
      }
    },
    examples: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { en: { type: Type.STRING }, bn: { type: Type.STRING } },
        required: ['en', 'bn'],
        propertyOrdering: ['en', 'bn']
      }
    }
  },
  required: ['meaning_bn', 'meaning_en', 'vocabulary', 'idioms_phrasal', 'grammar', 'examples'],
  propertyOrdering: ['meaning_bn', 'meaning_en', 'vocabulary', 'idioms_phrasal', 'grammar', 'examples']
}

export const FLASHCARDS_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      note_id: { type: Type.INTEGER },
      front: { type: Type.STRING },
      meaning_bn: { type: Type.STRING },
      meaning_en: { type: Type.STRING },
      example: { type: Type.STRING },
      example_bn: { type: Type.STRING },
      note: { type: Type.STRING }
    },
    required: ['note_id', 'front', 'meaning_bn', 'meaning_en', 'example', 'example_bn', 'note'],
    propertyOrdering: ['note_id', 'front', 'meaning_bn', 'meaning_en', 'example', 'example_bn', 'note']
  }
}

export const TRANSCRIPT_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      start: { type: Type.NUMBER, description: 'Start time in seconds' },
      end: { type: Type.NUMBER, description: 'End time in seconds' },
      text: { type: Type.STRING, description: 'Exactly what is said' }
    },
    required: ['start', 'end', 'text'],
    propertyOrdering: ['start', 'end', 'text']
  }
}

export const TRANSCRIPT_INSTRUCTION = `You are a careful transcriber. Write down the spoken English in the video exactly as it is said.
Rules:
- Verbatim: only words actually spoken. Never add, guess, summarise, correct or translate.
- Split into subtitle-sized lines: one sentence or short phrase each, at most about 12 words.
- Give start and end times in seconds from the beginning of the full video.
- Skip music, sound effects and silence. If nobody speaks, return an empty list.`

export const EXTRACT_INSTRUCTION = `You turn English the learner saved into structured study notes for a Bangla-speaking English learner.
Rules:
- Bangla must be natural and conversational, not word-for-word.
- Only list vocabulary, idioms, phrasal verbs, collocations and grammar that actually appear in the text. Skip trivial words (a, the, is, to...).
- If the text is a sentence pattern/template, describe the pattern in "grammar".
- Give 3 new natural example sentences that reuse the key language, each with a Bangla translation.
- Keep notes short and practical. Use an existing explanation if provided, but stay concise.`

export const FLASHCARD_INSTRUCTION = `You create flashcards for a Bangla-speaking English learner from their own saved notes.
For each note produce exactly one card:
- front: the most useful expression to memorise. For a single word/phrase/idiom/structure use it as-is (e.g. "to figure something out"). For a long sentence, use the key expression inside it; if the whole sentence is the point, use the sentence.
- meaning_bn: natural Bangla meaning; meaning_en: short simple-English meaning.
- example: one new natural example sentence using the front; example_bn: its Bangla translation.
- note: one short usage tip (register, common mistake, collocation).
Return note_id unchanged.`

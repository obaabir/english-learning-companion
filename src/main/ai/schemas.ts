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
    },
    target_term: {
      type: Type.STRING,
      description: 'The single most useful word, phrasal verb, idiom or collocation to learn, in dictionary form (e.g. "get out of something"). Never the whole sentence.'
    },
    target_meaning_bn: { type: Type.STRING, description: 'Natural Bangla meaning of target_term as used here' },
    target_meaning_en: { type: Type.STRING, description: 'Short simple-English meaning of target_term' }
  },
  required: ['meaning_bn', 'meaning_en', 'vocabulary', 'idioms_phrasal', 'grammar', 'examples', 'target_term', 'target_meaning_bn', 'target_meaning_en'],
  propertyOrdering: ['meaning_bn', 'meaning_en', 'vocabulary', 'idioms_phrasal', 'grammar', 'examples', 'target_term', 'target_meaning_bn', 'target_meaning_en']
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

export const REMIX_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    phrases: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { phrase: { type: Type.STRING }, meaning_bn: { type: Type.STRING } },
        required: ['phrase', 'meaning_bn'],
        propertyOrdering: ['phrase', 'meaning_bn']
      }
    },
    sentences: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { en: { type: Type.STRING }, bn: { type: Type.STRING } },
        required: ['en', 'bn'],
        propertyOrdering: ['en', 'bn']
      }
    }
  },
  required: ['phrases', 'sentences'],
  propertyOrdering: ['phrases', 'sentences']
}

export const REMIX_INSTRUCTION = `You help a Bangla-speaking English learner reuse language from lines they practised today.
From the lines, pick the 3 to 5 most useful words or phrases (collocations, phrasal verbs, idioms, sentence starters; skip trivial words).
Then write exactly 3 short new sentences (max 12 words each) using those phrases: simple, everyday, natural, at the learner's level.
Give natural Bangla meanings for the phrases and Bangla translations for the sentences.`

export const YOUR_TURN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    corrected: { type: Type.STRING, description: 'The learner sentence, corrected and natural (unchanged if already correct)' },
    tip_bn: { type: Type.STRING, description: 'One short tip in Bangla' },
    ok: { type: Type.BOOLEAN, description: 'True if the original was already correct' }
  },
  required: ['corrected', 'tip_bn', 'ok'],
  propertyOrdering: ['corrected', 'tip_bn', 'ok']
}

export const YOUR_TURN_INSTRUCTION = `A Bangla-speaking English learner wrote or said a sentence using one of the given phrases.
Reply briefly: give the corrected, natural version (keep their idea; unchanged if already correct) and exactly one short, encouraging tip in Bangla.`

export const EXTRACT_INSTRUCTION = `You turn English the learner saved into structured study notes for a Bangla-speaking English learner.
Rules:
- Bangla must be natural and conversational, not word-for-word.
- Only list vocabulary, idioms, phrasal verbs, collocations and grammar that actually appear in the text. Skip trivial words (a, the, is, to...).
- If the text is a sentence pattern/template, describe the pattern in "grammar".
- Give 3 new natural example sentences that reuse the key language, each with a Bangla translation.
- Keep notes short and practical. Use an existing explanation if provided, but stay concise.
- target_term: the ONE word, phrasal verb, idiom or collocation worth learning, in dictionary form
  (e.g. "get out of something", "check something out", "resilient"). For a single word or short phrase,
  use the text itself. For a sentence pattern, give the pattern. NEVER return the whole sentence.
  target_meaning_bn / target_meaning_en: its meaning as used in this text.`

export const FLASHCARD_INSTRUCTION = `You create flashcards for a Bangla-speaking English learner from their own saved notes.
For each note produce exactly one card:
- front: the word or phrase to learn — NEVER the whole sentence. If "target" is given, use it exactly. For a single word/phrase/idiom/structure use it as-is (e.g. "to figure something out"). For a sentence, use the key word, phrasal verb, idiom or collocation inside it, in dictionary form (e.g. "get out of something"); keep it to a few words.
- meaning_bn: natural Bangla meaning; meaning_en: short simple-English meaning.
- meaning_bn / meaning_en: the meaning of the FRONT (not of the whole sentence).
- example: one new natural example sentence using the front; example_bn: its Bangla translation.
- note: one short usage tip (register, common mistake, collocation).
Return note_id unchanged.`

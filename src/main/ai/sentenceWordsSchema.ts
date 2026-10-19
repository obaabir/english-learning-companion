import { Type, type Schema } from '@google/genai'

/** Movie Mode: the words and idioms of one explained sentence, each with Bangla meaning, easy synonyms and one example. */
export const SENTENCE_WORDS_INSTRUCTION = `You help a Bangla-speaking English learner with one English sentence from a movie.
List, in the order they appear in the sentence:
- every idiom, phrasal verb and fixed expression, and
- the meaningful words (nouns, verbs, adjectives, adverbs) a learner may not know.
Skip very basic words (I, you, he, the, a, an, is, are, was, and, but, to, of, in, on, it, this, that, so, no, yes, ok …) and people's names.
For each item give:
- term: as it appears in the sentence (for a phrasal verb, its usual form, e.g. "cut off"),
- kind: "word", "idiom", "phrasal verb" or "expression",
- meaning_bn: its Bangla meaning as used in THIS sentence,
- synonyms: 1–3 easy, common English synonyms with the same meaning,
- example: one short, natural new English example sentence using it with the same meaning.`

export const SENTENCE_WORDS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          term: { type: Type.STRING },
          kind: { type: Type.STRING, enum: ['word', 'idiom', 'phrasal verb', 'expression'] },
          meaning_bn: { type: Type.STRING },
          synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
          example: { type: Type.STRING }
        },
        required: ['term', 'kind', 'meaning_bn', 'synonyms', 'example'],
        propertyOrdering: ['term', 'kind', 'meaning_bn', 'synonyms', 'example']
      }
    }
  },
  required: ['items']
}

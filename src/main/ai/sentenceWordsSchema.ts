import { Type, type Schema } from '@google/genai'

/**
 * Explain: the vocabulary, idioms and phrasal verbs of the selected text, each with its meaning in THIS
 * context. The model first writes a one-line gist of the whole sentence (so meanings follow the context),
 * then the items. The result is checked against the source text in shared/explainAnalysis.ts.
 */
export const SENTENCE_WORDS_INSTRUCTION = `You analyse English text for a Bangla-speaking learner of English (intermediate level).
You get the SELECTED text and, when available, the sentence and nearby text it comes from.

gist: first, one short sentence saying what the selected text means in its context. Use it to choose the right meanings below.

vocabulary: words from the SELECTED text that are useful to learn or likely to be unfamiliar or important for understanding (nouns, verbs, adjectives, adverbs).
- Skip very basic words (I, you, he, the, a, an, is, are, was, have, do, go, get, good, very, and, but, to, of, in, on, it, this, that, so, yes, no, ok…) and people's names.
- Skip words that are only part of an idiom or phrasal verb you list under expressions.
- If the selection is a single word, list that word (even if it is common), with its meaning in this context.
- No duplicates; list a repeated word twice only if its meaning differs. Usually 0–8 items, in the order they appear.
- term: exactly as written in the text. pos: its part of speech here.
- meaning_bn: ONE natural Bangla meaning that fits THIS context (not a list of dictionary meanings).
- meaning_en: a simple English definition of that meaning (at most about 12 words).
- example: one short, natural NEW sentence using it with the same meaning (never copy the source text).
- certain: false if the context is not enough to be sure of the meaning.

expressions: ONLY genuine idioms, phrasal verbs and useful fixed expressions that are really used in the text with that meaning.
- Phrasal verb: a verb + particle with its own meaning (give up = stop trying; look up = search for information). A verb followed by an ordinary preposition used literally is NOT a phrasal verb ("she looked up at the sky" is literal). Recognise separated forms ("turned the offer down" → turn down).
- Idiom: a figurative meaning different from its words (spill the beans = reveal a secret). If the words are used literally here, it is NOT an idiom.
- Fixed expression: only when it is genuinely worth learning as one unit.
- Never invent expressions. An ordinary multi-word phrase is not an idiom. If there are none, return an empty list.
- term: exactly as written in the text (keep the words in between for separated forms). base_form: the dictionary form. type: "idiom", "phrasal verb" or "fixed expression".
- meaning_bn: natural Bangla meaning in this text. meaning_en: what it means here, in simple English. example: one short new example. certain: as above.

ambiguity: if the meaning of the selected text cannot be decided from the given context, one short sentence saying what is unclear and what context would help; otherwise "".`

const item = {
  type: Type.OBJECT,
  properties: {
    term: { type: Type.STRING },
    pos: { type: Type.STRING },
    meaning_bn: { type: Type.STRING },
    meaning_en: { type: Type.STRING },
    example: { type: Type.STRING },
    certain: { type: Type.BOOLEAN }
  },
  required: ['term', 'pos', 'meaning_bn', 'meaning_en', 'example', 'certain'],
  propertyOrdering: ['term', 'pos', 'meaning_bn', 'meaning_en', 'example', 'certain']
}

export const SENTENCE_WORDS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    gist: { type: Type.STRING },
    vocabulary: { type: Type.ARRAY, items: item },
    expressions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          term: { type: Type.STRING },
          base_form: { type: Type.STRING },
          type: { type: Type.STRING, enum: ['idiom', 'phrasal verb', 'fixed expression'] },
          meaning_bn: { type: Type.STRING },
          meaning_en: { type: Type.STRING },
          example: { type: Type.STRING },
          certain: { type: Type.BOOLEAN }
        },
        required: ['term', 'base_form', 'type', 'meaning_bn', 'meaning_en', 'example', 'certain'],
        propertyOrdering: ['term', 'base_form', 'type', 'meaning_bn', 'meaning_en', 'example', 'certain']
      }
    },
    ambiguity: { type: Type.STRING }
  },
  required: ['gist', 'vocabulary', 'expressions', 'ambiguity'],
  propertyOrdering: ['gist', 'vocabulary', 'expressions', 'ambiguity']
}

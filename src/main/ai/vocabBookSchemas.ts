import { Type, type Schema } from '@google/genai'

/** Vocabulary Book Learning: reading words from a picture, choosing words from a story, and teaching each word. */

export const VB_IMAGE_INSTRUCTION = `You read a photo of a vocabulary book page or an image with an English word list, for a Bangla-speaking learner.
List the English vocabulary items that are visible, in reading order (top to bottom, column by column). Keep numbering order if the page is numbered.
- term: the English word or phrase exactly as printed (no numbering, no part-of-speech labels).
- meaning_bn: the Bangla meaning only if it is printed on the page; otherwise "".
- context: an example sentence printed next to the word, if any; otherwise "".
- uncertain: true if the text is blurry, cut off, partly hidden, or you are guessing any letter.
- note: why it is uncertain (short), or "".
page_ref: a printed page / unit / lesson reference if visible, else "".
complete: false if part of the page is cut off, unreadable, or you could not list every item.
warning: a short plain-English explanation when complete is false (what may be missing), else "".
Never invent words that are not visible.`

export const VB_IMAGE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          term: { type: Type.STRING },
          meaning_bn: { type: Type.STRING },
          context: { type: Type.STRING },
          uncertain: { type: Type.BOOLEAN },
          note: { type: Type.STRING }
        },
        required: ['term', 'meaning_bn', 'context', 'uncertain', 'note'],
        propertyOrdering: ['term', 'meaning_bn', 'context', 'uncertain', 'note']
      }
    },
    page_ref: { type: Type.STRING },
    complete: { type: Type.BOOLEAN },
    warning: { type: Type.STRING }
  },
  required: ['items', 'page_ref', 'complete', 'warning'],
  propertyOrdering: ['items', 'page_ref', 'complete', 'warning']
}

export const VB_TEXT_INSTRUCTION = `You choose useful vocabulary from an English story or passage for a Bangla-speaking intermediate learner.
Pick words and phrases worth learning (less common words, phrasal verbs, idioms, useful collocations); skip very basic words and names.
List them in the order they first appear in the text. For each give:
- term: the word or phrase as it appears (or its base form if clearer),
- context: the full sentence from the text where it appears (copied exactly).
At most 40 items.`

export const VB_TEXT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { term: { type: Type.STRING }, context: { type: Type.STRING } },
        required: ['term', 'context'],
        propertyOrdering: ['term', 'context']
      }
    }
  },
  required: ['items']
}

export const VB_ENRICH_INSTRUCTION = `You teach English vocabulary to a Bangla-speaking learner. For each item you get the word or phrase, and sometimes the sentence (context) it came from.
If a context is given, explain the meaning the word has IN THAT CONTEXT (not another meaning).
For each item return:
- id (as given),
- meaning_bn: short natural Bangla meaning,
- definition_en: a simple English definition (one short line),
- pos: part of speech (noun, verb, adjective, adverb, phrasal verb, idiom, phrase, …),
- example: one new, natural example sentence using the word with the same meaning,
- example_bn: the Bangla translation of that example,
- synonyms: up to 4 useful synonyms with the same meaning (may be empty),
- collocations: up to 4 common collocations (may be empty).`

export const VB_ENRICH_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.INTEGER },
      meaning_bn: { type: Type.STRING },
      definition_en: { type: Type.STRING },
      pos: { type: Type.STRING },
      example: { type: Type.STRING },
      example_bn: { type: Type.STRING },
      synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
      collocations: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['id', 'meaning_bn', 'definition_en', 'pos', 'example', 'example_bn', 'synonyms', 'collocations'],
    propertyOrdering: ['id', 'meaning_bn', 'definition_en', 'pos', 'example', 'example_bn', 'synonyms', 'collocations']
  }
}

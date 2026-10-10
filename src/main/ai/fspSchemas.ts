import { Type, type Schema } from '@google/genai'
import { FSP_ERROR_TYPES } from '@shared/fsp'

/** Flash Sentence Practice: focused grammar check (JSON only). */
export const FSP_CHECK_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ['correct', 'wrong'] },
    usesTargetCorrectly: { type: Type.BOOLEAN },
    challengeMet: { type: Type.BOOLEAN },
    errors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: FSP_ERROR_TYPES },
          wrongText: { type: Type.STRING, description: 'The exact wrong words copied from the learner sentence' },
          fix: { type: Type.STRING, description: 'The minimal replacement for wrongText' },
          ruleBangla: { type: Type.STRING, description: 'One short rule in Bangla' }
        },
        required: ['type', 'wrongText', 'fix', 'ruleBangla'],
        propertyOrdering: ['type', 'wrongText', 'fix', 'ruleBangla']
      }
    },
    corrected: { type: Type.STRING, description: 'The learner sentence with only the minimal fixes (identical if correct)' },
    optionalTip: { type: Type.STRING, description: 'Optional short tip in Bangla, or empty' }
  },
  required: ['status', 'usesTargetCorrectly', 'challengeMet', 'errors', 'corrected', 'optionalTip'],
  propertyOrdering: ['status', 'usesTargetCorrectly', 'challengeMet', 'errors', 'corrected', 'optionalTip']
}

export const FSP_CHECK_INSTRUCTION = `You check one sentence written by a Bangla-speaking English learner who is practising a target word, phrase or idiom.
Check ONLY these error types:
- word_order: verb position / word order
- subject_verb_agreement
- tense
- article: a / an / the
- preposition
- noun_phrase
- noun_clause
- adverb: adverb of manner, place or time (form and position)
- relative_clause
- target_use: wrong meaning or use of the target term (including a literal use of an idiom)
Also decide whether the sentence meets the given challenge (challengeMet).
Rules:
- If none of these errors exist, status is "correct", even if the sentence could sound more natural. Never rewrite for style.
- Make minimal edits only. "corrected" is the learner's sentence with just those fixes (identical when correct).
- wrongText must be copied exactly from the learner's sentence.
- ruleBangla: one short, simple rule in Bangla per error.
- Do not count spelling, punctuation or capitalisation as errors unless they change the grammar.
- usesTargetCorrectly is false only when the target term is missing or used with the wrong meaning or form.`

export const FSP_EXAMPLE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: { example: { type: Type.STRING } },
  required: ['example']
}

export const FSP_EXAMPLE_INSTRUCTION = `Write one short, natural, everyday example sentence (8-14 words) that uses the given English word, phrase or idiom with its usual meaning. Simple vocabulary. Return only the sentence.`

export const FSP_LESSON_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    lessonBn: { type: Type.STRING, description: 'A 1-minute mini-lesson in Bangla (4-6 short lines) with 1-2 English examples' },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { wrong: { type: Type.STRING }, fix: { type: Type.STRING } },
        required: ['wrong', 'fix'],
        propertyOrdering: ['wrong', 'fix']
      }
    }
  },
  required: ['lessonBn', 'items'],
  propertyOrdering: ['lessonBn', 'items']
}

export const FSP_LESSON_INSTRUCTION = `You teach a Bangla-speaking English learner about one grammar mistake type they make often.
Give a very short mini-lesson in simple Bangla (about 1 minute to read) and exactly 3 quick fix-it items:
each item is one short English sentence with exactly one mistake of this type ("wrong") and its corrected version ("fix").
If the learner's own mistakes are given, base the lesson on them.`

import { Type, type Schema } from '@google/genai'

/** Practice material for games: wrong versions of the learner's own saved sentences. */
export const PRACTICE_INSTRUCTION = {
  choose: `You make practice material for a Bangla-speaking English learner from sentences they saved.
For each sentence, write exactly THREE incorrect versions that look natural but each contain ONE typical learner
mistake (article, tense, subject-verb agreement, preposition, word order, word form, missing auxiliary).
Keep the same meaning and vocabulary. Never write a version that is also correct.
"why": in simple English (one or two sentences), why the original sentence is correct.
"structure": the main grammar structure of the original sentence (e.g. "Present perfect + since-clause").
"errors": for each wrong version, the wrong part, the right part and a short reason, in the same order.`,
  error: `You make error-correction practice for a Bangla-speaking English learner from sentences they saved.
For each sentence, write ONE incorrect version with one or two typical learner mistakes (article, tense,
subject-verb agreement, preposition, word order, word form). Keep the meaning and vocabulary.
Put it as the only item of "wrong". "errors": each mistake's wrong part, the right part and a short reason.
"why": in simple English, why the corrected (original) sentence is right. "structure": its main grammar structure.`
}

export const PRACTICE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.INTEGER },
      wrong: { type: Type.ARRAY, items: { type: Type.STRING } },
      errors: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: { wrong: { type: Type.STRING }, right: { type: Type.STRING }, why: { type: Type.STRING } },
          required: ['wrong', 'right', 'why']
        }
      },
      why: { type: Type.STRING },
      structure: { type: Type.STRING }
    },
    required: ['id', 'wrong', 'errors', 'why', 'structure']
  }
}

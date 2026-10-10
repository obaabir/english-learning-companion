/** Flash Sentence Practice (Flashcards section): types shared by main and renderer. */

export type FspCardType = 'word' | 'phrase' | 'idiom'

export type FspErrorType =
  | 'word_order'
  | 'subject_verb_agreement'
  | 'tense'
  | 'article'
  | 'preposition'
  | 'noun_phrase'
  | 'noun_clause'
  | 'adverb'
  | 'relative_clause'
  | 'target_use'

export const FSP_ERROR_TYPES: FspErrorType[] = [
  'word_order',
  'subject_verb_agreement',
  'tense',
  'article',
  'preposition',
  'noun_phrase',
  'noun_clause',
  'adverb',
  'relative_clause',
  'target_use'
]

export interface FspError {
  type: FspErrorType
  wrongText: string
  fix: string
  ruleBangla: string
}

export interface FspCheckInput {
  term: string
  type: FspCardType
  meaningBn: string
  sentence: string
  /** What this level asks for, e.g. "Use a relative clause with who/which/that." */
  challenge: string
  context: string | null
}

export interface FspCheckResult {
  status: 'correct' | 'wrong'
  usesTargetCorrectly: boolean
  challengeMet: boolean
  errors: FspError[]
  corrected: string
  optionalTip: string
}

export interface FspLesson {
  lessonBn: string
  items: { wrong: string; fix: string }[]
}

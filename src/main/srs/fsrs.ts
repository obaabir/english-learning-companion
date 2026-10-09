import { createEmptyCard, fsrs, type Card, type Grade } from 'ts-fsrs'
import type { ReviewRating } from '@shared/types'

const scheduler = fsrs({ enable_fuzz: true })

/** JSON-safe card (dates as ISO strings). */
export type StoredCard = Omit<Card, 'due' | 'last_review'> & { due: string; last_review?: string }

function toStored(card: Card): StoredCard {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : undefined
  }
}

function fromStored(card: StoredCard): Card {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined
  }
}

export function newCard(now = new Date()): StoredCard {
  return toStored(createEmptyCard(now))
}

export function reviewCard(card: StoredCard, rating: ReviewRating, now = new Date()): StoredCard {
  const { card: next } = scheduler.next(fromStored(card), now, rating as Grade)
  return toStored(next)
}

import { useEffect, useState, type ReactNode } from 'react'
import { BookA, Loader2, RotateCcw } from 'lucide-react'
import type { SentenceWord } from '@shared/types'
import { errorMessage, invoke } from '@renderer/lib/api'
import { Badge, Button } from '@renderer/components/ui'

/**
 * Movie Mode: the words and idioms of the explained sentence, shown separately below the explanation —
 * each with its Bangla meaning, easy English synonyms and one example.
 */
export function SentenceWords({ sentence }: { sentence: string }): ReactNode {
  const [words, setWords] = useState<SentenceWord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setWords(null)
    setError(null)
    invoke('ai:sentenceWords', sentence)
      .then((w) => !cancelled && setWords(w))
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [sentence, attempt])

  return (
    <section className="mt-5 border-t border-line/60 pt-4" aria-label="Words and idioms in this sentence">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <BookA className="size-4 text-rose" /> Words &amp; idioms in this sentence
      </h3>
      {error ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>Couldn’t list the words: {error}</span>
          <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </Button>
        </div>
      ) : !words ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Finding the words and idioms…
        </p>
      ) : !words.length ? (
        <p className="text-sm text-muted">No words or idioms to explain in this sentence.</p>
      ) : (
        <div className="grid gap-2 @lg:grid-cols-2">
          {words.map((w, i) => (
            <div key={`${w.term}-${i}`} className="glass-inset rounded-xl px-3 py-2.5 text-sm" data-sentence-word={w.term}>
              <p className="flex items-center gap-2">
                <span className="font-semibold">{w.term}</span>
                {w.kind !== 'word' && <Badge tone="accent">{w.kind}</Badge>}
              </p>
              {w.meaningBn && <p className="mt-0.5">{w.meaningBn}</p>}
              {w.synonyms.length > 0 && (
                <p className="mt-0.5 text-xs text-muted">
                  Similar: <span className="text-fg">{w.synonyms.join(', ')}</span>
                </p>
              )}
              {w.example && <p className="mt-1 text-xs italic">“{w.example}”</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

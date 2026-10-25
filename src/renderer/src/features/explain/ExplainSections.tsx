import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, Check, Loader2, Palette, RotateCcw } from 'lucide-react'
import type { ExplainAnalysis, ExplainExpression, ExplainVocab } from '@shared/explainAnalysis'
import { readableVersion } from '@shared/contrast'
import { errorMessage, invoke } from '@renderer/lib/api'
import { useEscape } from '@renderer/lib/navigation'
import { checkColors, EXPLAIN_DEFAULTS, EXPLAIN_TEXT, useExplainAppearance, type ExplainColors } from './explainAppearance'

/**
 * The Explain reading surface, shared by Movies, YouTube and Articles:
 *   A. Original (the selected text, exactly as in the source)
 *   B. Vocabulary            ┐ from ai:analyze, checked against the source text
 *   C. Idioms & Phrasal Verbs ┘ (C only when the text really has some)
 *   D. Explanation (the streamed explanation, rendered by the caller)
 * Colours have fixed roles: near-black text and meanings, one vocabulary colour, one example colour.
 */

/** Style for the element with the "explain-paper" class: the user's colours as CSS variables. */
export function useExplainPaperStyle(): CSSProperties {
  const c = useExplainAppearance((s) => s.colors)
  return paperVars(c)
}
const paperVars = (c: ExplainColors): CSSProperties => ({ ['--ex-bg' as string]: c.bg, ['--ex-text' as string]: EXPLAIN_TEXT, ['--ex-vocab' as string]: c.vocab, ['--ex-example' as string]: c.example })

function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }): ReactNode {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3 className="ex-label">{children}</h3>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  )
}

/** A. The original text (source text, never changed), with its sentence when only part was selected. */
export function OriginalContext({ text, sentence, source }: { text: string; sentence?: string | null; source?: string | null }): ReactNode {
  return (
    <section aria-label="Original text" className="ex-section">
      <SectionLabel right={<AppearanceButton />}>Original</SectionLabel>
      <p className="ex-original">{text}</p>
      {sentence && sentence.trim() !== text.trim() && (
        <p className="mt-1.5 text-sm">
          <span className="ex-muted">In the sentence: </span>“{sentence}”
        </p>
      )}
      {source && <p className="ex-muted mt-1 truncate text-xs">{source}</p>}
    </section>
  )
}

/** B + C. Asked for once per selection (cached in the main process for the session). */
export function ExplainAnalysisView({ text, sentence, context }: { text: string; sentence: string | null; context: string | null }): ReactNode {
  const [data, setData] = useState<ExplainAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    invoke('ai:analyze', { text, sentence, context })
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [text, sentence, context, attempt])

  if (error)
    return (
      <section className="ex-section" aria-label="Vocabulary">
        <SectionLabel>Vocabulary</SectionLabel>
        <p className="text-sm">
          Couldn’t find the vocabulary: {error}{' '}
          <button className="ex-link inline-flex items-center gap-1" onClick={() => setAttempt((a) => a + 1)}>
            <RotateCcw className="size-3" /> Try again
          </button>
        </p>
      </section>
    )
  if (!data)
    return (
      <section className="ex-section" aria-label="Vocabulary" aria-busy="true">
        <SectionLabel>Vocabulary</SectionLabel>
        <p className="ex-muted flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Finding vocabulary, idioms and phrasal verbs…
        </p>
      </section>
    )
  return (
    <>
      <section className="ex-section" aria-label="Vocabulary" data-explain-vocabulary>
        <SectionLabel>Vocabulary</SectionLabel>
        {data.ambiguity && (
          <p className="ex-note mb-3 flex gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{data.ambiguity}</span>
          </p>
        )}
        {data.vocabulary.length ? (
          <div className="space-y-2.5">
            {data.vocabulary.map((v, i) => (
              <VocabCard key={`${v.term}-${i}`} v={v} />
            ))}
          </div>
        ) : (
          <p className="ex-muted text-sm">No difficult words to list in this text.</p>
        )}
      </section>
      {/* Only when the text really contains idioms or phrasal verbs. */}
      {data.expressions.length > 0 && (
        <section className="ex-section" aria-label="Idioms and phrasal verbs" data-explain-expressions>
          <SectionLabel>Idioms &amp; Phrasal Verbs</SectionLabel>
          <div className="space-y-2.5">
            {data.expressions.map((e, i) => (
              <ExpressionCard key={`${e.term}-${i}`} e={e} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function Uncertain(): ReactNode {
  return (
    <span className="ex-tag" title="The context is not enough to be sure of this meaning">
      Meaning not certain
    </span>
  )
}

function VocabCard({ v }: { v: ExplainVocab }): ReactNode {
  return (
    <article className="ex-card" data-vocab={v.term}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="ex-term">{v.term}</span>
        {v.pos && <span className="ex-muted text-xs italic">{v.pos}</span>}
        {!v.certain && <Uncertain />}
      </p>
      <dl className="ex-fields">
        {v.meaningBn && (
          <>
            <dt>বাংলা অর্থ</dt>
            <dd>{v.meaningBn}</dd>
          </>
        )}
        {v.meaningEn && (
          <>
            <dt>Simple English meaning</dt>
            <dd>{v.meaningEn}</dd>
          </>
        )}
        {v.example && (
          <>
            <dt>Example</dt>
            <dd className="ex-example">{v.example}</dd>
          </>
        )}
      </dl>
    </article>
  )
}

const TYPE_LABEL: Record<ExplainExpression['type'], string> = { idiom: 'Idiom', 'phrasal verb': 'Phrasal verb', 'fixed expression': 'Fixed expression' }

function ExpressionCard({ e }: { e: ExplainExpression }): ReactNode {
  const showBase = e.baseForm && e.baseForm.toLowerCase() !== e.term.toLowerCase()
  return (
    <article className="ex-card ex-card-expression" data-expression={e.term}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="ex-term">{e.term}</span>
        <span className="ex-tag ex-tag-type">{TYPE_LABEL[e.type]}</span>
        {!e.certain && <Uncertain />}
      </p>
      {showBase && <p className="ex-muted mt-0.5 text-xs">Dictionary form: {e.baseForm}</p>}
      <dl className="ex-fields">
        {e.meaningEn && (
          <>
            <dt>Meaning here</dt>
            <dd>{e.meaningEn}</dd>
          </>
        )}
        {e.meaningBn && (
          <>
            <dt>বাংলা অর্থ</dt>
            <dd>{e.meaningBn}</dd>
          </>
        )}
        {e.example && (
          <>
            <dt>Example</dt>
            <dd className="ex-example">{e.example}</dd>
          </>
        )}
      </dl>
    </article>
  )
}

/** D's heading (the caller renders the streamed explanation under it). */
export function ExplanationHeading(): ReactNode {
  return <SectionLabel>Explanation</SectionLabel>
}

// ---- Appearance: background, vocabulary and example colours, with a live preview and contrast checks.
const FIELDS: { key: keyof ExplainColors; label: string }[] = [
  { key: 'bg', label: 'Background' },
  { key: 'vocab', label: 'Vocabulary words' },
  { key: 'example', label: 'Example sentences' }
]

function AppearanceButton(): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Explanation colours" title="Explanation colours" className="ex-icon-btn">
        <Palette className="size-4" />
      </button>
      {open && <AppearancePopover onClose={() => setOpen(false)} />}
    </div>
  )
}

function AppearancePopover({ onClose }: { onClose: () => void }): ReactNode {
  const saved = useExplainAppearance((s) => s.colors)
  const { save, reset } = useExplainAppearance.getState()
  const [draft, setDraft] = useState<ExplainColors>(saved)
  const [hexText, setHexText] = useState<ExplainColors>(saved)
  useEscape(onClose)
  const checks = checkColors(draft)
  const failing = checks.filter((c) => !c.ok)
  const set = (key: keyof ExplainColors, value: string): void => {
    setHexText({ ...hexText, [key]: value })
    if (/^#[0-9a-f]{6}$/i.test(value)) setDraft({ ...draft, [key]: value })
  }
  const fix = (): void => {
    const next = { ...draft }
    if (checkColors(next).find((c) => c.key === 'bg' && !c.ok)) next.bg = readableVersion(next.bg, EXPLAIN_TEXT)
    next.vocab = readableVersion(next.vocab, next.bg)
    next.example = readableVersion(next.example, next.bg)
    setDraft(next)
    setHexText(next)
  }
  return (
    <div role="dialog" aria-label="Explanation colours" className="ex-popover">
      <p className="text-sm font-semibold">Explanation colours</p>
      <div className="mt-3 space-y-2.5">
        {FIELDS.map((f) => {
          const c = checks.find((x) => x.key === f.key)!
          return (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input type="color" value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} aria-label={`${f.label} colour`} className="ex-swatch" />
              <span className="min-w-0 flex-1">{f.label}</span>
              <input value={hexText[f.key]} onChange={(e) => set(f.key, e.target.value.trim())} aria-label={`${f.label} hex`} className="ex-hex" maxLength={7} />
              <span className={c.ok ? 'ex-ok' : 'ex-bad'} title={`Contrast ${c.ratio.toFixed(1)}:1 (needs 4.5:1)`}>
                {c.ok ? <Check className="inline size-3" /> : <AlertTriangle className="inline size-3" />} {c.ratio.toFixed(1)}:1
              </span>
            </label>
          )
        })}
      </div>
      {/* Preview with the colours being edited (nothing changes until Save). */}
      <div className="ex-preview" style={paperVars(draft)} aria-label="Preview">
        <span className="ex-term">reluctant</span> <span className="ex-muted text-xs italic">adjective</span>
        <p className="mt-1 text-sm">বাংলা অর্থ: অনিচ্ছুক</p>
        <p className="text-sm">Simple English meaning: not wanting to do something</p>
        <p className="ex-example text-sm">She was reluctant to leave the party early.</p>
      </div>
      {failing.length > 0 && (
        <div className="ex-warn mt-2 text-xs">
          <p>Not readable enough: {failing.map((f) => f.label.toLowerCase()).join(', ')} need at least 4.5:1 contrast.</p>
          <button onClick={fix} className="mt-1 font-semibold underline">
            Use readable versions
          </button>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => {
            reset()
            setDraft(EXPLAIN_DEFAULTS)
            setHexText(EXPLAIN_DEFAULTS)
          }}
          className="ex-btn"
        >
          Reset to default
        </button>
        <button onClick={onClose} className="ex-btn ml-auto">
          Cancel
        </button>
        <button onClick={() => save(draft) && onClose()} disabled={failing.length > 0} title={failing.length ? 'Fix the contrast first' : undefined} className="ex-btn ex-btn-primary">
          Save
        </button>
      </div>
    </div>
  )
}

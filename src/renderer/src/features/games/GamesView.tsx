import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Gamepad2, Sparkles } from 'lucide-react'
import type { Note } from '@shared/types'
import { asVocabNotes, buildBlanks, buildContextQuestions, buildGrammarQuestions, buildIdiomTasks, buildMeaningQuestions, GAME_MODES, type GameMode } from '@shared/games'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, PanelHeader } from '@renderer/components/ui'
import { BlankGame, ChoiceGame, OrderingGame, VocabMatch } from './LocalGames'
import { ChooseGame, ErrorGame, WriteGame } from './AiGames'
import { useIntents } from '@renderer/stores/intents'

/** Games built from the learner's own saved notes (words, idioms, sentences, structures, grammar). */
export function GamesView(): ReactNode {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [mode, setMode] = useState<GameMode | null>(() => useIntents.getState().takeGameMode())
  // A voice command ("start a vocabulary game") can choose the game while the section is open.
  const requested = useIntents((s) => s.gameMode)
  useEffect(() => {
    const m = requested && useIntents.getState().takeGameMode()
    if (m) setMode(m)
  }, [requested])
  const toastError = useApp((s) => s.toastError)
  useEffect(() => {
    // The regular learning collection — the same items your flashcards use.
    invoke('notes:list', { collection: 'regular' }).then(setNotes).catch(toastError)
  }, [toastError])

  const game = GAME_MODES.find((g) => g.mode === mode)
  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <PanelHeader title={game ? game.title : 'Games'} icon={<Gamepad2 className="size-4" />}>
        {game && (
          <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-3.5" />} onClick={() => setMode(null)}>
            All games
          </Button>
        )}
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl">
          {!notes ? null : !mode ? (
            <>
              <p className="mb-4 text-sm text-muted">
                Every game is made from your own saved notes ({notes.length} saved). Sentences from your notes are marked <Badge tone="info">From your notes</Badge>; practice sentences made by
                Gemini are marked <Badge tone="warn">AI-generated practice sentence</Badge>.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {GAME_MODES.map((g, i) => (
                  <button key={g.mode} onClick={() => setMode(g.mode)} className="motion-press rounded-xl border border-line/60 px-4 py-3 text-left hover:bg-white/[0.08]">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <span className="text-muted tabular-nums">{i + 1}.</span> {g.title}
                      {g.ai && <Sparkles className="size-3.5 text-rose" aria-label="Uses Gemini" />}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{g.description}</p>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <Game key={mode} mode={mode} notes={notes} />
          )}
        </div>
      </div>
    </div>
  )
}

function Game({ mode, notes }: { mode: GameMode; notes: Note[] }): ReactNode {
  // Vocabulary games use each item's word/phrase to learn; sentence games use the original sentences.
  const vocab = useMemo(() => asVocabNotes(notes), [notes])
  switch (mode) {
    case 'vocab-match':
      return <VocabMatch notes={vocab} />
    case 'meaning-match':
      return <ChoiceGame notes={vocab} build={() => buildMeaningQuestions(vocab)} emptyText="Save at least 4 words or idioms with meanings to play." />
    case 'ordering':
      return <OrderingGame notes={notes} />
    case 'blanks':
      return <BlankGame notes={vocab} build={() => buildBlanks(vocab)} emptyText="Save at least 2 words together with the sentence they came from (select a word in a subtitle or article and save it)." />
    case 'choose':
      return <ChooseGame notes={notes} />
    case 'idiom':
      return <BlankGame notes={vocab} build={() => buildIdiomTasks(vocab)} emptyText="Save some idioms or phrasal verbs (two words or more) to play." />
    case 'grammar':
      return <ChoiceGame notes={notes} build={() => buildGrammarQuestions(notes)} emptyText="Save a few sentences with Gemini set up (their grammar is saved with them), then play." />
    case 'error':
      return <ErrorGame notes={notes} />
    case 'write':
      return <WriteGame notes={[...vocab, ...notes.filter((n) => n.kind === 'structure' || n.kind === 'grammar')]} />
    case 'context':
      return <ChoiceGame notes={vocab} build={() => buildContextQuestions(vocab)} emptyText="Save at least 4 words together with the sentence they came from (and their meanings) to play." />
  }
}

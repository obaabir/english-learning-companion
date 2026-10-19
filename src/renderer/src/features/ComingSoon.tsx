import type { ReactNode } from 'react'
import { Gamepad2, GraduationCap, ListChecks } from 'lucide-react'
import { EmptyState } from '@renderer/components/ui'

const PAGES = {
  games: {
    icon: <Gamepad2 className="size-12" />,
    title: 'Games are coming in Phase 2',
    text: 'Sentence Builder, Choose the Correct Sentence, Matching, Sentence Completion and the Word Movement Puzzle, all built from your own saved notes, with Easy/Medium/Hard levels and grammar structure highlighting.'
  },
  ielts: {
    icon: <GraduationCap className="size-12" />,
    title: 'IELTS Mode is coming in Phase 3',
    text: 'A browser extension will follow your IELTS practice, track each question, analyse your reasoning and log mistakes like FALSE vs NOT GIVEN.'
  },
  errors: {
    icon: <ListChecks className="size-12" />,
    title: 'Error Log is coming in Phase 3',
    text: 'Your personal IELTS mistake database with repeated-weakness detection, saved automatically to your IELTS Error Log Google Doc.'
  }
} as const

export function ComingSoon({ page }: { page: keyof typeof PAGES }): ReactNode {
  const p = PAGES[page]
  return (
    <div className="glass-panel h-full">
      <EmptyState icon={p.icon} title={p.title}>
        {p.text}
      </EmptyState>
    </div>
  )
}

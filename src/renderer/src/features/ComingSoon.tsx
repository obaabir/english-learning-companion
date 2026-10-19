import type { ReactNode } from 'react'
import { GraduationCap, ListChecks } from 'lucide-react'
import { EmptyState } from '@renderer/components/ui'

const PAGES = {
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

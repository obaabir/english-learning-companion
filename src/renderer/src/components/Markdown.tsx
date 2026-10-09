import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@renderer/lib/cn'

export function Markdown({ text, streaming, className }: { text: string; streaming?: boolean; className?: string }): ReactNode {
  return (
    <div className={cn('prose-ai', streaming && 'stream-caret', className)} data-savable>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-info underline">
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

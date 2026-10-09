import type { ReactNode } from 'react'

/** YouTube-style play button (the icon set has no brand logos). */
export function YouTubeIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="#FF0000" />
      <path d="M10 8.8v6.4l5.6-3.2z" fill="#FFFFFF" />
    </svg>
  )
}

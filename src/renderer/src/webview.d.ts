import type { DetailedHTMLProps, HTMLAttributes } from 'react'

// Electron's <webview> element (the Articles in-app browser).
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string }
    }
  }
}

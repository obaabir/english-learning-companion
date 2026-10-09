/** Shared motion settings for JavaScript-driven animations (CSS uses the same values via tokens). */
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const PANEL_MS = 240

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * FLIP: after a layout change has moved `el` vertically by `-delta` px, play it
 * back from its old position with a compositor-only transform animation. Layout
 * happens once; every animation frame is transform-only.
 */
export function flipY(el: HTMLElement, delta: number, duration = PANEL_MS): void {
  if (Math.abs(delta) < 1 || reducedMotion()) return
  el.animate([{ transform: `translate3d(0, ${delta}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }], { duration, easing: EASE })
}

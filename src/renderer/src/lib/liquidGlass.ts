/**
 * Liquid glass helpers (see the ".liquid" rules in index.css):
 *  - one delegated pointer listener follows the pointer over the interactive element under it. The
 *    specular shine (--lx / --ly) follows it closely; the smoke inside the glass (--sx / --sy) drifts
 *    after it more slowly, so it trails like light through a thick liquid. When the pointer leaves,
 *    both glide back to their resting place while the glass fades. One animation frame loop runs only
 *    while something is still moving;
 *  - a tiny SVG filter (#liquid-refract) gives the glass a slight refraction where the browser
 *    supports SVG backdrop filters (Chromium); elsewhere the CSS falls back to blur only.
 * With "reduce motion" on, the shine jumps to the pointer and nothing trails.
 */
const INTERACTIVE = '.liquid, button.motion-press, [role="tab"], [role="menuitem"], [role="radio"]'
/** Where the shine rests (top centre), in % of the element. */
const REST = { x: 50, y: 0 }
const SHINE_EASE = 0.35
const SMOKE_EASE = 0.1

type Glass = { lx: number; ly: number; sx: number; sy: number; tx: number; ty: number }

export function initLiquidGlass(): () => void {
  if (!document.getElementById('liquid-glass-defs')) {
    const holder = document.createElement('div')
    holder.id = 'liquid-glass-defs'
    holder.setAttribute('aria-hidden', 'true')
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
    holder.innerHTML =
      '<svg width="0" height="0" focusable="false"><filter id="liquid-refract" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="1" seed="7" result="n"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter></svg>'
    document.body.appendChild(holder)
  }
  const still = window.matchMedia('(prefers-reduced-motion: reduce)')
  /** Last known shine/smoke state per element; the ones still gliding are in `moving`. */
  const state = new WeakMap<HTMLElement, Glass>()
  const moving = new Set<HTMLElement>()
  let current: HTMLElement | null = null
  let pointer: { x: number; y: number } | null = null
  let frame = 0

  const paint = (el: HTMLElement, g: Glass): void => {
    el.style.setProperty('--lx', `${g.lx.toFixed(1)}%`)
    el.style.setProperty('--ly', `${g.ly.toFixed(1)}%`)
    el.style.setProperty('--sx', `${g.sx.toFixed(1)}%`)
    el.style.setProperty('--sy', `${g.sy.toFixed(1)}%`)
  }
  const tick = (): void => {
    frame = 0
    // The pointer target of the element under the pointer (read once per frame).
    if (current && pointer && moving.has(current)) {
      const r = current.getBoundingClientRect()
      if (r.width && r.height) {
        const g = state.get(current)!
        g.tx = ((pointer.x - r.left) / r.width) * 100
        g.ty = ((pointer.y - r.top) / r.height) * 100
      }
    }
    for (const el of moving) {
      const g = state.get(el)!
      const k = still.matches ? 1 : SHINE_EASE
      const s = still.matches ? 1 : SMOKE_EASE
      g.lx += (g.tx - g.lx) * k
      g.ly += (g.ty - g.ly) * k
      g.sx += (g.tx - g.sx) * s
      g.sy += (g.ty - g.sy) * s
      paint(el, g)
      // Settled: stop animating it until the pointer moves over it again.
      if (Math.abs(g.tx - g.sx) + Math.abs(g.ty - g.sy) + Math.abs(g.tx - g.lx) + Math.abs(g.ty - g.ly) < 0.4) moving.delete(el)
    }
    if (moving.size && !frame) frame = requestAnimationFrame(tick)
  }
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(tick)
  }
  /** The pointer left an element: shine and smoke glide back to rest while the glass fades. */
  const release = (el: HTMLElement | null): void => {
    if (!el) return
    const g = state.get(el)
    if (g) {
      g.tx = REST.x
      g.ty = REST.y
      moving.add(el)
    }
  }
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    const el = (e.target as Element | null)?.closest?.<HTMLElement>(INTERACTIVE) ?? null
    pointer = { x: e.clientX, y: e.clientY }
    if (el !== current) {
      release(current)
      current = el
      // A fresh element starts where the pointer came in, so the smoke drifts in from that edge.
      if (el && !state.has(el)) {
        const r = el.getBoundingClientRect()
        const x = r.width ? ((e.clientX - r.left) / r.width) * 100 : REST.x
        const y = r.height ? ((e.clientY - r.top) / r.height) * 100 : REST.y
        state.set(el, { lx: x, ly: y, sx: x, sy: y, tx: x, ty: y })
      }
    }
    if (el) moving.add(el)
    if (moving.size) schedule()
  }
  const onLeaveWindow = (): void => {
    release(current)
    current = null
    pointer = null
    schedule()
  }
  document.addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeaveWindow)
  return () => {
    document.removeEventListener('pointermove', onMove)
    document.documentElement.removeEventListener('pointerleave', onLeaveWindow)
    cancelAnimationFrame(frame)
  }
}

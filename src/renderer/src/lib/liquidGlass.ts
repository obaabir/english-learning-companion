/**
 * Liquid glass helpers (see the ".liquid" rules in index.css):
 *  - one delegated pointer listener moves the specular shine (--lx / --ly) on the interactive element
 *    under the pointer, throttled to one update per frame;
 *  - a tiny SVG filter (#liquid-refract) gives the glass a slight refraction where the browser
 *    supports SVG backdrop filters (Chromium); elsewhere the CSS falls back to blur only.
 */
const INTERACTIVE = '.liquid, button.motion-press, [role="tab"], [role="menuitem"], [role="radio"]'

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
  let frame = 0
  let last: { el: HTMLElement; x: number; y: number } | null = null
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    const el = (e.target as Element | null)?.closest?.<HTMLElement>(INTERACTIVE)
    if (!el) return
    last = { el, x: e.clientX, y: e.clientY }
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!last) return
      const r = last.el.getBoundingClientRect()
      if (!r.width || !r.height) return
      last.el.style.setProperty('--lx', `${Math.round(((last.x - r.left) / r.width) * 100)}%`)
      last.el.style.setProperty('--ly', `${Math.round(((last.y - r.top) / r.height) * 100)}%`)
    })
  }
  document.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    document.removeEventListener('pointermove', onMove)
    cancelAnimationFrame(frame)
  }
}

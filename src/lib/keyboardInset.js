/** Layout viewport minus the visual viewport. Android Chrome's keyboard is this gap. */
export function keyboardInsetPx(layoutHeight, visualHeight, offsetTop = 0) {
  const layout = Number(layoutHeight)
  const visual = Number(visualHeight)
  const offset = Number(offsetTop) || 0
  if (!Number.isFinite(layout) || !Number.isFinite(visual)) return 0
  return Math.max(0, Math.round(layout - visual - offset))
}

export function bindKeyboardInset(target = globalThis) {
  const viewport = target.visualViewport
  const root = target.document?.documentElement
  if (!viewport || !root) return () => {}
  const apply = () => {
    const inset = keyboardInsetPx(target.innerHeight, viewport.height, viewport.offsetTop)
    root.style.setProperty('--keyboard-inset', `${inset}px`)
  }
  viewport.addEventListener('resize', apply)
  viewport.addEventListener('scroll', apply)
  apply()
  return () => {
    viewport.removeEventListener('resize', apply)
    viewport.removeEventListener('scroll', apply)
    root.style.removeProperty('--keyboard-inset')
  }
}

export function scrollFocusedFieldIntoView(event) {
  const el = event?.target
  if (!el || typeof el.matches !== 'function') return
  if (!el.matches('input, textarea, select')) return
  const run = () => {
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else run()
}

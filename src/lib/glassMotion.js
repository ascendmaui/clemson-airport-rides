import { useEffect } from 'react'

/** Cards and notes that rise in as they enter the scrollport. Hero shots stay on CSS. */
export const REVEAL_SELECTOR = '.mkt-card, .lux-legal-section, .mkt-note, .mkt-section-head, .mkt-reach, .mkt-close, .dp-card, .dp-offer, .dp-legend, .dp-compare, .dp-rental'

const STAGGER_MS = 70
const STAGGER_CAP = 4
const ENTER_SLOP = 24

export function revealDelay(index) {
  const step = Math.min(Math.max(Math.floor(Number(index) || 0), 0), STAGGER_CAP)
  return `${step * STAGGER_MS}ms`
}

/**
 * Per-parent stagger. Hide only nodes whose top sits below the visible scrollport
 * so above-the-fold content never flashes out after first paint.
 */
export function planReveals(items, viewBottom) {
  const counts = new Map()
  return items.map((item) => {
    const index = counts.get(item.parentKey) ?? 0
    counts.set(item.parentKey, index + 1)
    return {
      index,
      delay: revealDelay(index),
      hide: item.top > viewBottom - ENTER_SLOP,
    }
  })
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Site pages scroll in `.app-shell`. Phone-shell routes scroll the route pane. */
function scrollport(route) {
  const shell = route.closest?.('.app-shell')
  if (shell && shell !== route) {
    const overflow = window.getComputedStyle(shell).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return shell
  }
  return route
}

export function bindGlassMotion(root) {
  if (!root || prefersReducedMotion() || typeof IntersectionObserver !== 'function') {
    return () => {}
  }

  const port = scrollport(root)
  const viewBottom = port.getBoundingClientRect().bottom
  const nodes = [...root.querySelectorAll(REVEAL_SELECTOR)].filter((node) => (
    !node.parentElement?.closest(REVEAL_SELECTOR)
  ))
  const plan = planReveals(nodes.map((node) => ({
    top: node.getBoundingClientRect().top,
    parentKey: node.parentElement || root,
  })), viewBottom)

  const hidden = []
  plan.forEach((entry, index) => {
    if (!entry.hide) return
    const node = nodes[index]
    node.classList.add('mkt-reveal')
    node.style.setProperty('--mkt-delay', entry.delay)
    hidden.push(node)
  })
  if (hidden.length === 0) return () => {}

  root.classList.add('glass-motion')
  let observer = null
  const reveal = (node) => {
    const rect = node.getBoundingClientRect()
    const view = port.getBoundingClientRect()
    if (rect.top < view.bottom - 160) node.style.setProperty('--mkt-delay', '0ms')
    node.classList.add('is-in')
    observer?.unobserve(node)
  }
  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      reveal(entry.target)
    })
  }, {
    root: port,
    rootMargin: '0px 0px 12% 0px',
    threshold: 0,
  })
  hidden.forEach((node) => observer.observe(node))
  const view = port.getBoundingClientRect()
  hidden.forEach((node) => {
    const rect = node.getBoundingClientRect()
    if (rect.bottom > view.top && rect.top < view.bottom) reveal(node)
  })

  return () => {
    observer.disconnect()
    root.classList.remove('glass-motion')
    hidden.forEach((node) => {
      node.classList.remove('mkt-reveal', 'is-in')
      node.style.removeProperty('--mkt-delay')
    })
  }
}

export function useGlassMotion(routeKey) {
  useEffect(() => {
    let stop = () => {}
    const frame = window.requestAnimationFrame(() => {
      const root = document.querySelector('[data-route]')
      if (root) stop = bindGlassMotion(root)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      stop()
    }
  }, [routeKey])
}

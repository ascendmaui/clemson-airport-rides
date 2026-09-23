import type { Href } from 'expo-router'

let nextHref: Href | null = null

export function setAuthNext(href: Href) {
  nextHref = href
}

export function takeAuthNext(): Href | null {
  const value = nextHref
  nextHref = null
  return value
}

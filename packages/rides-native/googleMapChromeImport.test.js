import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as googleMapChrome from './googleMapChrome.js'

for (const app of ['rider', 'driver']) {
  test(`${app} CampusMap imports every googleMapChrome helper it uses`, () => {
    const source = readFileSync(fileURLToPath(new URL(`../../apps/${app}/components/CampusMap.native.tsx`, import.meta.url)), 'utf8')
    const imports = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]rides-native\/googleMapChrome\.js['"]/g)]
    const imported = new Set(imports.flatMap((match) => match[1].split(',').map((name) => name.trim())))
    const body = source.replace(/import\s*\{[^}]+\}\s*from\s*['"]rides-native\/googleMapChrome\.js['"]/g, '')

    for (const name of Object.keys(googleMapChrome)) {
      if (new RegExp(`\\b${name}\\b`).test(body)) {
        assert.ok(imported.has(name), `${app} uses ${name} without importing it`)
      }
    }
  })
}

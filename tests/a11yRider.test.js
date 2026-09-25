import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Static scan of rider JSX. No React Native runtime.
//
// Pressable, TouchableOpacity, and Button opening tags need accessibilityLabel
// or accessibilityRole. Image opening tags need accessibilityLabel or
// accessible={false}. Tags that have neither are offenders.
//
// ALLOWLIST is the current tree. New offenders fail the test; removing a
// listed tag from the source fails until the entry is deleted.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = ['apps/rider/app', 'apps/rider/components']
const INTERACTIVE = new Set(['Pressable', 'TouchableOpacity', 'Button'])

const ALLOWLIST = [
  'apps/rider/app/history.tsx:61:9 <Pressable>',
  'apps/rider/app/schedule.tsx:884:15 <Pressable>',
  'apps/rider/components/EmergencyContactsCard.tsx:192:15 <Pressable>',
  'apps/rider/components/EmergencyContactsCard.tsx:196:13 <Pressable>',
]

function isIdentStart(ch) {
  return ch != null && /[A-Za-z_]/.test(ch)
}

function isIdentPart(ch) {
  return ch != null && /[A-Za-z0-9_]/.test(ch)
}

function lineColumn(source, index) {
  let line = 1
  let column = 1
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') {
      line++
      column = 1
    } else {
      column++
    }
  }
  return { line, column }
}

function readIdent(source, index) {
  let end = index + 1
  while (end < source.length && isIdentPart(source[end])) end++
  return { name: source.slice(index, end), end }
}

// Advance past one quoted string or template literal starting at `index`.
// Template expressions are skipped as raw text here; callers that must see
// code inside `${}` should not use this for the whole template.
function skipQuoted(source, index, end) {
  const quote = source[index]
  let i = index + 1
  if (quote !== '`') {
    while (i < end) {
      if (source[i] === '\\') {
        i += 2
        continue
      }
      if (source[i] === quote) return i + 1
      i++
    }
    return i
  }
  let brace = 0
  while (i < end) {
    const ch = source[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (brace === 0 && ch === '`') return i + 1
    if (ch === '`') {
      // nested template inside an expression
      i = skipQuoted(source, i, end)
      continue
    }
    if (brace === 0 && ch === '$' && source[i + 1] === '{') {
      brace = 1
      i += 2
      continue
    }
    if (ch === '{') brace++
    else if (ch === '}') brace = Math.max(0, brace - 1)
    else if (ch === "'" || ch === '"') {
      i = skipQuoted(source, i, end)
      continue
    }
    i++
  }
  return i
}

function skipLineComment(source, index, end) {
  let i = index
  while (i < end && source[i] !== '\n') i++
  return i
}

function skipBlockComment(source, index, end) {
  let i = index
  while (i < end && !(source[i] === '*' && source[i + 1] === '/')) i++
  return Math.min(end, i + 2)
}

// Opening tag beginning at `<`. Null when this `<` is not Pressable,
// TouchableOpacity, Button, or Image.
function readOpeningTag(source, index) {
  const n = source.length
  if (source[index] !== '<') return null
  let i = index + 1
  if (!isIdentStart(source[i])) return null
  const ident = readIdent(source, i)
  const name = ident.name
  i = ident.end
  if (source[i] === '.') return null
  if (!INTERACTIVE.has(name) && name !== 'Image') return null

  const bodyStart = i
  let mode = 'code'
  let brace = 0
  const templateResume = []
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    if (mode === 'sq' || mode === 'dq') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if ((mode === 'sq' && ch === "'") || (mode === 'dq' && ch === '"')) mode = 'code'
      i++
      continue
    }
    if (mode === 'tmpl') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '`') {
        mode = 'code'
        i++
        continue
      }
      if (ch === '$' && next === '{') {
        brace++
        templateResume.push(brace - 1)
        mode = 'code'
        i += 2
        continue
      }
      i++
      continue
    }
    if (ch === '/' && next === '/' && source[i - 1] !== ':') {
      i = skipLineComment(source, i + 2, n)
      continue
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(source, i + 2, n)
      continue
    }
    if (ch === "'") {
      mode = 'sq'
      i++
      continue
    }
    if (ch === '"') {
      mode = 'dq'
      i++
      continue
    }
    if (ch === '`') {
      mode = 'tmpl'
      i++
      continue
    }
    if (ch === '{') {
      brace++
      i++
      continue
    }
    if (ch === '}') {
      brace = Math.max(0, brace - 1)
      i++
      if (templateResume.length > 0 && brace === templateResume[templateResume.length - 1]) {
        templateResume.pop()
        mode = 'tmpl'
      }
      continue
    }
    if (ch === '>' && brace === 0) {
      return { name, body: source.slice(bodyStart, i), end: i + 1 }
    }
    i++
  }
  return { name, body: source.slice(bodyStart), end: n }
}

function readAttributeValue(source, index) {
  const ch = source[index]
  if (ch === "'" || ch === '"' || ch === '`') {
    const end = skipQuoted(source, index, source.length)
    return { raw: source.slice(index, end), end }
  }
  if (ch !== '{') return null
  let i = index + 1
  let mode = 'code'
  let brace = 1
  const templateResume = []
  while (i < source.length) {
    const cur = source[i]
    const next = source[i + 1]
    if (mode === 'sq' || mode === 'dq') {
      if (cur === '\\') {
        i += 2
        continue
      }
      if ((mode === 'sq' && cur === "'") || (mode === 'dq' && cur === '"')) mode = 'code'
      i++
      continue
    }
    if (mode === 'tmpl') {
      if (cur === '\\') {
        i += 2
        continue
      }
      if (cur === '`') {
        mode = 'code'
        i++
        continue
      }
      if (cur === '$' && next === '{') {
        brace++
        templateResume.push(brace - 1)
        mode = 'code'
        i += 2
        continue
      }
      i++
      continue
    }
    if (cur === '/' && next === '/' && source[i - 1] !== ':') {
      i = skipLineComment(source, i + 2, source.length)
      continue
    }
    if (cur === '/' && next === '*') {
      i = skipBlockComment(source, i + 2, source.length)
      continue
    }
    if (cur === "'") {
      mode = 'sq'
      i++
      continue
    }
    if (cur === '"') {
      mode = 'dq'
      i++
      continue
    }
    if (cur === '`') {
      mode = 'tmpl'
      i++
      continue
    }
    if (cur === '{') {
      brace++
      i++
      continue
    }
    if (cur === '}') {
      brace--
      i++
      if (brace === 0) return { raw: source.slice(index, i), end: i }
      if (templateResume.length > 0 && brace === templateResume[templateResume.length - 1]) {
        templateResume.pop()
        mode = 'tmpl'
      }
      continue
    }
    i++
  }
  return { raw: source.slice(index), end: source.length }
}

function openingAttributes(body) {
  const attrs = []
  let i = 0
  let mode = 'code'
  let brace = 0
  const templateResume = []
  while (i < body.length) {
    const ch = body[i]
    const next = body[i + 1]
    if (mode === 'sq' || mode === 'dq') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if ((mode === 'sq' && ch === "'") || (mode === 'dq' && ch === '"')) mode = 'code'
      i++
      continue
    }
    if (mode === 'tmpl') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '`') {
        mode = 'code'
        i++
        continue
      }
      if (ch === '$' && next === '{') {
        brace++
        templateResume.push(brace - 1)
        mode = 'code'
        i += 2
        continue
      }
      i++
      continue
    }
    if (ch === '/' && next === '/' && body[i - 1] !== ':') {
      i = skipLineComment(body, i + 2, body.length)
      continue
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(body, i + 2, body.length)
      continue
    }
    if (ch === "'") {
      mode = 'sq'
      i++
      continue
    }
    if (ch === '"') {
      mode = 'dq'
      i++
      continue
    }
    if (ch === '`') {
      mode = 'tmpl'
      i++
      continue
    }
    if (ch === '{') {
      brace++
      i++
      continue
    }
    if (ch === '}') {
      brace = Math.max(0, brace - 1)
      i++
      if (templateResume.length > 0 && brace === templateResume[templateResume.length - 1]) {
        templateResume.pop()
        mode = 'tmpl'
      }
      continue
    }
    if (brace === 0 && isIdentStart(ch)) {
      const ident = readIdent(body, i)
      i = ident.end
      while (i < body.length && /\s/.test(body[i])) i++
      let valueRaw = null
      if (body[i] === '=') {
        i++
        while (i < body.length && /\s/.test(body[i])) i++
        const value = readAttributeValue(body, i)
        if (value) {
          valueRaw = value.raw
          i = value.end
        }
      }
      attrs.push({ name: ident.name, valueRaw })
      continue
    }
    i++
  }
  return attrs
}

function hasAttribute(attrs, name) {
  return attrs.some((attr) => attr.name === name)
}

function isAccessibleFalse(valueRaw) {
  return typeof valueRaw === 'string' && /^\{\s*false\s*\}$/.test(valueRaw)
}

// 'control' | 'image' | null
function offenderKind(name, body) {
  const attrs = openingAttributes(body)
  if (INTERACTIVE.has(name)) {
    if (hasAttribute(attrs, 'accessibilityLabel') || hasAttribute(attrs, 'accessibilityRole')) return null
    return 'control'
  }
  if (name === 'Image') {
    if (hasAttribute(attrs, 'accessibilityLabel')) return null
    if (attrs.some((attr) => attr.name === 'accessible' && isAccessibleFalse(attr.valueRaw))) return null
    return 'image'
  }
  return null
}

function scanSource(file, source) {
  const offenders = []
  const n = source.length
  let i = 0
  let mode = 'code'
  let brace = 0
  const templateResume = []
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    if (mode === 'sq' || mode === 'dq') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if ((mode === 'sq' && ch === "'") || (mode === 'dq' && ch === '"')) mode = 'code'
      i++
      continue
    }
    if (mode === 'tmpl') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '`') {
        mode = 'code'
        i++
        continue
      }
      if (ch === '$' && next === '{') {
        brace++
        templateResume.push(brace - 1)
        mode = 'code'
        i += 2
        continue
      }
      i++
      continue
    }
    if (ch === '/' && next === '/' && source[i - 1] !== ':') {
      i = skipLineComment(source, i + 2, n)
      continue
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(source, i + 2, n)
      continue
    }
    if (ch === "'") {
      mode = 'sq'
      i++
      continue
    }
    if (ch === '"') {
      mode = 'dq'
      i++
      continue
    }
    if (ch === '`') {
      mode = 'tmpl'
      i++
      continue
    }
    if (ch === '{') {
      brace++
      i++
      continue
    }
    if (ch === '}') {
      brace = Math.max(0, brace - 1)
      i++
      if (templateResume.length > 0 && brace === templateResume[templateResume.length - 1]) {
        templateResume.pop()
        mode = 'tmpl'
      }
      continue
    }
    if (ch === '<') {
      const tag = readOpeningTag(source, i)
      if (tag && offenderKind(tag.name, tag.body)) {
        const pos = lineColumn(source, i)
        offenders.push({
          file,
          name: tag.name,
          line: pos.line,
          column: pos.column,
          id: `${file}:${pos.line}:${pos.column} <${tag.name}>`,
        })
      }
    }
    i++
  }
  return offenders
}

function walkTsx(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkTsx(full))
    else if (entry.isFile() && entry.name.endsWith('.tsx')) files.push(full)
  }
  return files
}

function scanRiderTree() {
  const files = []
  for (const relDir of SCAN_DIRS) {
    files.push(...walkTsx(path.join(ROOT, relDir)))
  }
  files.sort()
  const offenders = []
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    const source = readFileSync(file, 'utf8')
    offenders.push(...scanSource(rel, source))
  }
  offenders.sort((a, b) => a.id.localeCompare(b.id))
  return { files, offenders }
}

function idsIn(source) {
  return scanSource('fixture.tsx', source).map((hit) => hit.id)
}

test('interactive controls need accessibilityLabel or accessibilityRole', () => {
  assert.deepEqual(idsIn('<Pressable onPress={go} />'), ['fixture.tsx:1:1 <Pressable>'])
  assert.deepEqual(idsIn('<Pressable accessibilityRole="button" onPress={go} />'), [])
  assert.deepEqual(idsIn('<Pressable accessibilityLabel="Go" onPress={go} />'), [])
  assert.deepEqual(idsIn('<Pressable accessibilityRole="button" accessibilityLabel="Go" />'), [])
  assert.deepEqual(idsIn('<TouchableOpacity onPress={go}><Text>Go</Text></TouchableOpacity>'), [
    'fixture.tsx:1:1 <TouchableOpacity>',
  ])
  assert.deepEqual(idsIn('<TouchableOpacity accessibilityLabel={label} onPress={go} />'), [])
  assert.deepEqual(idsIn('<Button title="Save" onPress={go} />'), ['fixture.tsx:1:1 <Button>'])
  assert.deepEqual(idsIn('<Button accessibilityRole="button" title="Save" />'), [])
  assert.deepEqual(idsIn('<PrimaryButton label="Save" onPress={go} />'), [])
  assert.deepEqual(idsIn('<PressableThing onPress={go} />'), [])
})

test('a comparison inside a prop does not hide a later accessibility prop', () => {
  assert.deepEqual(idsIn('<Pressable onPress={() => a > b} accessibilityRole="button" />'), [])
  assert.deepEqual(idsIn('<Pressable onPress={() => a > b} />'), ['fixture.tsx:1:1 <Pressable>'])
  const multiline = [
    '<Pressable',
    '  onPress={() => {',
    '    // accessibilityLabel is not a prop here',
    '    if (a > b) return',
    '  }}',
    '>',
    '  <Text>Go</Text>',
    '</Pressable>',
  ].join('\n')
  assert.deepEqual(idsIn(multiline), ['fixture.tsx:1:1 <Pressable>'])
})

test('images need accessibilityLabel or accessible={false}', () => {
  assert.deepEqual(idsIn('<Image source={src} />'), ['fixture.tsx:1:1 <Image>'])
  assert.deepEqual(idsIn('<Image source={src}></Image>'), ['fixture.tsx:1:1 <Image>'])
  assert.deepEqual(idsIn('<Image source={src} accessibilityLabel="Tiger" />'), [])
  assert.deepEqual(idsIn('<Image source={src} accessibilityLabel={`Tiger ${name}`} />'), [])
  assert.deepEqual(idsIn('<Image source={src} accessible={false} />'), [])
  assert.deepEqual(idsIn('<Image source={src} accessible={ false } />'), [])
  assert.deepEqual(idsIn('<Image\n  accessible={\n    false\n  }\n/>'), [])
  assert.deepEqual(idsIn('<Image source={src} accessible={true} />'), ['fixture.tsx:1:1 <Image>'])
  assert.deepEqual(idsIn('<Image source={src} accessible={hidden} />'), ['fixture.tsx:1:1 <Image>'])
  assert.deepEqual(idsIn('<Image source={src} accessible />'), ['fixture.tsx:1:1 <Image>'])
  assert.deepEqual(idsIn('<ImageBackground source={src} />'), [])
})

test('strings and comments are not elements', () => {
  const source = [
    'const example = "<Pressable onPress={go} />"',
    'const image = \'<Image source={src} />\'',
    '/* <Button title="Save" /> */',
    '{/* <TouchableOpacity onPress={go} /> */}',
    '// <Image source={src} />',
    '<Pressable accessibilityRole="button" onPress={go} />',
  ].join('\n')
  assert.deepEqual(idsIn(source), [])
})

test('rider app and components have no unlabeled controls or images outside the allowlist', (t) => {
  const { files, offenders } = scanRiderTree()
  const found = offenders.map((hit) => hit.id)
  console.log(`rider a11y offenders: ${found.length}`)
  t.diagnostic(`rider a11y offenders: ${found.length}`)
  assert.ok(files.length > 0, 'expected .tsx files under apps/rider/app and apps/rider/components')
  const allow = [...ALLOWLIST].sort()
  const foundSet = new Set(found)
  const allowSet = new Set(allow)
  const unexpected = found.filter((id) => !allowSet.has(id))
  const stale = allow.filter((id) => !foundSet.has(id))
  assert.deepEqual(
    { unexpected, stale },
    { unexpected: [], stale: [] },
    `rider a11y offenders: ${found.length}`,
  )
})

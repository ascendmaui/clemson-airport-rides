import assert from 'node:assert/strict'
import test from 'node:test'
import QRCode from 'qrcode'
import { qrMatrix } from './qrMatrix.js'

// Byte-mode ceiling for qrcode 1.5.4 at error correction M (version 40).
const LEVEL_M_BYTE_CAPACITY = 2331

function modulesAt(text, level) {
  return QRCode.create(text, { errorCorrectionLevel: level })
}

function matrixFromModules(modules) {
  const size = modules.size
  const cells = []
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules.get(x, y)) cells.push([x, y])
    }
  }
  return { size, cells }
}

function matrixAt(text, level = 'M') {
  return matrixFromModules(modulesAt(text, level).modules)
}

function cellKey(x, y) {
  return `${x},${y}`
}

function assertRowMajorUniqueInBounds(matrix) {
  const { size, cells } = matrix
  assert.equal(Number.isInteger(size), true)
  assert.ok(size >= 21)
  const seen = new Set()
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]
    assert.ok(Array.isArray(cell) && cell.length === 2)
    const [x, y] = cell
    assert.equal(Number.isInteger(x), true)
    assert.equal(Number.isInteger(y), true)
    assert.ok(x >= 0 && x < size, `x ${x} outside [0, ${size})`)
    assert.ok(y >= 0 && y < size, `y ${y} outside [0, ${size})`)
    const key = cellKey(x, y)
    assert.equal(seen.has(key), false, `duplicate cell ${key}`)
    seen.add(key)
    if (i === 0) continue
    const [prevX, prevY] = cells[i - 1]
    const rowMajor = y > prevY || (y === prevY && x > prevX)
    assert.equal(rowMajor, true, `cells not row-major at ${key}`)
  }
  assert.ok(cells.length > 0)
  assert.ok(cells.length < size * size)
}

// 7x7 finder: dark outer ring, light ring, dark 3x3 core.
function finderModuleIsDark(dx, dy) {
  const outerRing = dx === 0 || dy === 0 || dx === 6 || dy === 6
  const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
  return outerRing || core
}

test('matrix matches QRCode.create at error correction M', () => {
  const samples = [
    ['url', 'https://expo.dev/accounts/john/projects/clemson-airport-rides'],
    ['numeric', '1234567890'],
    ['alphanumeric', 'CLEMSON AIRPORT GATE A'],
    ['utf8', 'Clémson — café'],
    ['emoji', '🚐✈️'],
  ]
  for (const [, text] of samples) {
    const actual = qrMatrix(text)
    const created = modulesAt(text, 'M')
    assert.equal(created.errorCorrectionLevel.bit, 0)
    assert.deepEqual(actual, matrixFromModules(created.modules))
    assert.equal(actual.size, 17 + 4 * created.version)
    assertRowMajorUniqueInBounds(actual)
  }
})

test('size follows 17 + 4*version, grows with the input, and stays level M', () => {
  const shortUrl = 'https://t.co'
  const short = qrMatrix(shortUrl)
  const shortCreated = modulesAt(shortUrl, 'M')
  assert.equal(shortCreated.version, 1)
  assert.equal(short.size, 21)
  assert.equal(short.size, 17 + 4 * shortCreated.version)
  assert.deepEqual(short, matrixFromModules(shortCreated.modules))

  const longerUrl = 'https://expo.dev/accounts/john/projects/clemson-airport-rides'
  const longer = qrMatrix(longerUrl)
  const longerCreated = modulesAt(longerUrl, 'M')
  assert.ok(longerCreated.version > shortCreated.version)
  assert.ok(longer.size > short.size)
  assert.equal(longer.size, 17 + 4 * longerCreated.version)

  const numericShort = qrMatrix('1234567890')
  const numericLongText = '1234567890123456789012345678901234567890'
  const numericLong = qrMatrix(numericLongText)
  const numericLongCreated = modulesAt(numericLongText, 'M')
  assert.ok(numericLongCreated.version > modulesAt('1234567890', 'M').version)
  assert.ok(numericLong.size > numericShort.size)
  assert.equal(numericLong.size, 17 + 4 * numericLongCreated.version)

  // 40 numeric digits: L is version 1, M is version 2, H is version 3.
  const levelL = modulesAt(numericLongText, 'L')
  const levelM = numericLongCreated
  const levelH = modulesAt(numericLongText, 'H')
  assert.equal(levelL.errorCorrectionLevel.bit, 1)
  assert.equal(levelM.errorCorrectionLevel.bit, 0)
  assert.equal(levelH.errorCorrectionLevel.bit, 2)
  assert.equal(levelL.version, 1)
  assert.equal(levelM.version, 2)
  assert.equal(levelH.version, 3)
  assert.notEqual(levelL.modules.size, levelM.modules.size)
  assert.notEqual(levelH.modules.size, levelM.modules.size)
  assert.deepEqual(numericLong, matrixFromModules(levelM.modules))
  assert.equal(numericLong.size, levelM.modules.size)
  assert.notEqual(numericLong.size, levelL.modules.size)
  assert.notEqual(numericLong.size, levelH.modules.size)
  assert.notDeepEqual(numericLong, matrixFromModules(levelL.modules))
  assert.notDeepEqual(numericLong, matrixFromModules(levelH.modules))

  assert.deepEqual(qrMatrix(shortUrl), qrMatrix(shortUrl))
  assert.deepEqual(qrMatrix(longerUrl), qrMatrix(longerUrl))
  assert.deepEqual(qrMatrix('🚐✈️'), qrMatrix('🚐✈️'))
  assert.deepEqual(qrMatrix(numericLongText), qrMatrix(numericLongText))
})

test('finder patterns sit in three corners with light separators and an alternating timing run', () => {
  const text = 'https://t.co'
  const matrix = qrMatrix(text)
  const created = modulesAt(text, 'M')
  assert.equal(created.version, 1)
  assert.equal(matrix.size, 21)
  const { size, cells } = matrix
  const dark = new Set(cells.map(([x, y]) => cellKey(x, y)))

  const origins = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]
  for (const [originX, originY] of origins) {
    for (let dy = 0; dy < 7; dy += 1) {
      for (let dx = 0; dx < 7; dx += 1) {
        const x = originX + dx
        const y = originY + dy
        assert.equal(
          dark.has(cellKey(x, y)),
          finderModuleIsDark(dx, dy),
          `finder ${originX},${originY} module ${x},${y}`,
        )
      }
    }
  }

  // No fourth finder in the bottom-right corner.
  let bottomRightIsFinder = true
  for (let dy = 0; dy < 7; dy += 1) {
    for (let dx = 0; dx < 7; dx += 1) {
      const x = size - 7 + dx
      const y = size - 7 + dy
      if (dark.has(cellKey(x, y)) !== finderModuleIsDark(dx, dy)) bottomRightIsFinder = false
    }
  }
  assert.equal(bottomRightIsFinder, false)

  // One-module light separator around each finder.
  for (let i = 0; i <= 7; i += 1) {
    assert.equal(dark.has(cellKey(i, 7)), false, `top-left separator ${i},7`)
    assert.equal(dark.has(cellKey(7, i)), false, `top-left separator 7,${i}`)
    assert.equal(dark.has(cellKey(size - 8, i)), false, `top-right separator ${size - 8},${i}`)
    assert.equal(dark.has(cellKey(size - 8 + i, 7)), false, `top-right separator ${size - 8 + i},7`)
    assert.equal(dark.has(cellKey(i, size - 8)), false, `bottom-left separator ${i},${size - 8}`)
    assert.equal(dark.has(cellKey(7, size - 8 + i)), false, `bottom-left separator 7,${size - 8 + i}`)
  }

  // Timing alternates on row 6 and column 6 between the separators.
  // Modules 0..6 are the finder edge (solid dark) and module 7 is the separator.
  for (let i = 8; i <= size - 9; i += 1) {
    const on = i % 2 === 0
    assert.equal(dark.has(cellKey(i, 6)), on, `horizontal timing ${i},6`)
    assert.equal(dark.has(cellKey(6, i)), on, `vertical timing 6,${i}`)
  }
  assert.equal(dark.has(cellKey(7, 6)), false)
  assert.equal(dark.has(cellKey(6, 7)), false)
  assert.equal(dark.has(cellKey(8, 6)), true)
  assert.equal(dark.has(cellKey(6, 8)), true)
})

test('edge inputs coerce through String(text || "") before encoding', () => {
  for (const value of ['', null, undefined]) {
    assert.throws(() => qrMatrix(value), /No input text/)
  }

  // BUG?: `text || ''` drops numeric 0 (and false / NaN). qrMatrix(0) throws
  // "No input text" instead of encoding "0". qrMatrix(42) and qrMatrix('0') encode.
  for (const value of [0, false, NaN]) {
    assert.throws(() => qrMatrix(value), /No input text/)
  }
  assert.deepEqual(qrMatrix('0'), matrixAt('0'))
  assert.deepEqual(qrMatrix(42), matrixAt('42'))
  assert.deepEqual(qrMatrix(1234567890), matrixAt('1234567890'))
  assertRowMajorUniqueInBounds(qrMatrix(42))

  const spaces = '   '
  const mixedWhitespace = ' \t\n '
  for (const text of [spaces, mixedWhitespace]) {
    const matrix = qrMatrix(text)
    assert.deepEqual(matrix, matrixAt(text))
    assertRowMajorUniqueInBounds(matrix)
  }
  assert.notDeepEqual(qrMatrix(spaces), qrMatrix(mixedWhitespace))

  const near = 'b'.repeat(LEVEL_M_BYTE_CAPACITY)
  const nearMatrix = qrMatrix(near)
  const nearCreated = modulesAt(near, 'M')
  assert.equal(nearCreated.version, 40)
  assert.equal(nearMatrix.size, 177)
  assert.equal(nearMatrix.size, 17 + 4 * nearCreated.version)
  assert.deepEqual(nearMatrix, matrixFromModules(nearCreated.modules))
  assert.throws(
    () => qrMatrix('b'.repeat(LEVEL_M_BYTE_CAPACITY + 1)),
    /The amount of data is too big to be stored in a QR Code/,
  )

  // BUG?: plain objects stringify to "[object Object]" and encode that text.
  // An empty array stringifies to '' and throws. A non-empty array is joined
  // ("1,2"), not passed through as QR segments.
  const link = { href: 'https://example.com/ride' }
  assert.equal(String(link), '[object Object]')
  assert.deepEqual(qrMatrix(link), matrixAt('[object Object]'))
  assert.deepEqual(qrMatrix({}), matrixAt('[object Object]'))
  assert.throws(() => qrMatrix([]), /No input text/)
  assert.deepEqual(qrMatrix([1, 2]), matrixAt('1,2'))

  const labeled = {
    toString() {
      return 'https://example.com/custom'
    },
  }
  assert.deepEqual(qrMatrix(labeled), matrixAt('https://example.com/custom'))
})

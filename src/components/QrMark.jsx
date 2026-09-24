import { useMemo } from 'react'
import { qrMatrix } from '../lib/qrMatrix.js'

export function QrMark({ value, label }) {
  const matrix = useMemo(() => qrMatrix(value), [value])
  const quiet = 2
  const span = matrix.size + quiet * 2
  return (
    <svg
      className="mkt-qr-svg"
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label={`${label} download QR`}
    >
      <rect width={span} height={span} fill="#ffffff" />
      {matrix.cells.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x + quiet}
          y={y + quiet}
          width="1"
          height="1"
          fill="#522D80"
        />
      ))}
    </svg>
  )
}

import QRCode from 'qrcode'

/** Square QR modules for an SVG. Used by the marketing download codes. */
export function qrMatrix(text) {
  // Nullish only. `||` would turn numeric 0 (and false / NaN) into ''.
  const qr = QRCode.create(String(text ?? ''), { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const cells = []
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.get(x, y)) cells.push([x, y])
    }
  }
  return { size, cells }
}

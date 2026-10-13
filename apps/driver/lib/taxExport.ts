import { File, Paths } from 'expo-file-system'
import { isAvailableAsync, shareAsync } from 'expo-sharing'
import { Platform, Share } from 'react-native'
import {
  buildYearEndCsv,
  buildYearEndPdf,
  yearEndCsvFilename,
  yearEndPdfFilename,
} from '../../../shared/driverTaxMileage.js'
import type { YearEndView } from '@/lib/taxPacket'

export type ExportKind = 'csv' | 'pdf'

type FileBody = {
  mime: string
  bytes: Uint8Array | string
  uti: string
}

type Anchor = { href: string; download: string; click: () => void }

type BrowserScope = typeof globalThis & {
  document?: {
    createElement: (tag: 'a') => Anchor
    body: { appendChild: (node: Anchor) => void; removeChild: (node: Anchor) => void }
  }
  Blob?: new (parts: BlobPart[], options?: { type?: string }) => Blob
  URL?: { createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void }
}

function filenameFor(kind: ExportKind, year: number): string {
  switch (kind) {
    case 'csv':
      return yearEndCsvFilename(year)
    case 'pdf':
      return yearEndPdfFilename(year)
    default: {
      const neverKind: never = kind
      return neverKind
    }
  }
}

function fileBody(kind: ExportKind, packet: YearEndView): FileBody {
  switch (kind) {
    case 'csv':
      return { mime: 'text/csv;charset=utf-8', bytes: buildYearEndCsv(packet), uti: 'public.comma-separated-values-text' }
    case 'pdf':
      return { mime: 'application/pdf', bytes: buildYearEndPdf(packet), uti: 'com.adobe.pdf' }
    default: {
      const neverKind: never = kind
      return neverKind
    }
  }
}

function blobParts(bytes: Uint8Array | string): BlobPart[] {
  if (typeof bytes === 'string') return [bytes]
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return [copy]
}

function saveInBrowser(filename: string, body: FileBody) {
  const scope = globalThis as BrowserScope
  if (!scope.document || !scope.Blob || !scope.URL) {
    throw new Error('Save this file from the browser version of the driver app')
  }
  const blob = new scope.Blob(blobParts(body.bytes), { type: body.mime })
  const url = scope.URL.createObjectURL(blob)
  const anchor = scope.document.createElement('a')
  anchor.href = url
  anchor.download = filename
  scope.document.body.appendChild(anchor)
  anchor.click()
  scope.document.body.removeChild(anchor)
  scope.URL.revokeObjectURL(url)
}

async function shareNative(filename: string, body: FileBody) {
  const file = new File(Paths.cache, filename)
  file.create({ overwrite: true })
  file.write(body.bytes)
  if (await isAvailableAsync()) {
    await shareAsync(file.uri, { mimeType: body.mime, UTI: body.uti, dialogTitle: filename })
    return
  }
  if (typeof body.bytes === 'string') {
    await Share.share({ title: filename, message: body.bytes })
    return
  }
  throw new Error('This phone cannot open the share sheet for a PDF')
}

export async function exportYearEnd(kind: ExportKind, packet: YearEndView): Promise<void> {
  const filename = filenameFor(kind, packet.year)
  const body = fileBody(kind, packet)
  if (Platform.OS === 'web') {
    saveInBrowser(filename, body)
    return
  }
  await shareNative(filename, body)
}

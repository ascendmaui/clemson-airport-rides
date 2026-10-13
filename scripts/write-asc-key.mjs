/**
 * Write the App Store Connect API private key for eas submit.
 * Reads ASC_API_KEY_P8 from the environment and does not print it.
 */
import { writeFileSync } from 'node:fs'
import { normalizePem } from './store-release-submit.mjs'

const dest = process.argv[2]
if (!dest || dest === '-' || dest.includes('\0')) {
  console.error('write-asc-key.mjs needs a destination file path')
  process.exit(1)
}

writeFileSync(dest, normalizePem(process.env.ASC_API_KEY_P8), { mode: 0o600 })
console.log('wrote App Store Connect API key file')

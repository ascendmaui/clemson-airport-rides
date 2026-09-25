/**
 * Typecheck rider + driver (each app's own tsc) and syntax-check API/server JS.
 * Installs an app's dependencies only when that app's node_modules is missing.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function ensureAppDeps(appDir) {
  if (existsSync(path.join(appDir, 'node_modules'))) return
  const label = path.relative(root, appDir)
  console.log(`node_modules missing in ${label}; running npm ci`)
  run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], appDir)
}

function jsSources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      jsSources(full, out)
      continue
    }
    if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(full)
  }
  return out
}

for (const app of ['rider', 'driver', 'mobile']) {
  const appDir = path.join(root, 'apps', app)
  ensureAppDeps(appDir)
  run('npm', ['exec', '--', 'tsc', '--noEmit', '-p', '.'], appDir)
}

for (const rel of ['api', 'server']) {
  for (const file of jsSources(path.join(root, rel))) {
    run(process.execPath, ['--check', file], root)
  }
}

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { describe } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(__filename), '..')

function resolveRepoPath(relOrAbsPath) {
  return path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.resolve(REPO_ROOT, relOrAbsPath)
}

describe('CI cwd-independent path resolution resilience', () => {
  test('resolveRepoPath resolves tracked repository files independently of process.cwd', () => {
    const menuPath = resolveRepoPath('apps/driver/app/(tabs)/menu.tsx')
    assert.ok(fs.existsSync(menuPath), 'menu.tsx should exist via resolved path')

    const settingsPath = resolveRepoPath('apps/driver/app/settings/index.tsx')
    assert.ok(fs.existsSync(settingsPath), 'settings/index.tsx should exist via resolved path')

    const code = fs.readFileSync(menuPath, 'utf8')
    assert.ok(code.includes('MenuRow'), 'menu.tsx should contain MenuRow type annotation')
  })

  test('git ls-files with explicit cwd: REPO_ROOT reliably lists tracked files from any cwd', () => {
    const originalCwd = process.cwd()
    try {
      // Simulate running from a subdirectory
      process.chdir(path.join(REPO_ROOT, 'tests'))

      const output = execFileSync('git', ['ls-files', '-z'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      })
      const files = output.split('\0').filter(Boolean)

      // Ensure root files and deep app files are listed
      assert.ok(files.includes('package.json'))
      assert.ok(files.includes('apps/driver/app/(tabs)/menu.tsx'))
      assert.ok(files.includes('src/lib/apiClient.js'))
    } finally {
      process.chdir(originalCwd)
    }
  })

  test('Babel AST parser succeeds on resolved repo paths', () => {
    const menuPath = resolveRepoPath('apps/driver/app/(tabs)/menu.tsx')
    const code = fs.readFileSync(menuPath, 'utf8')
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    })
    assert.equal(ast.type, 'File')
    assert.ok(ast.program.body.length > 0)
  })
})

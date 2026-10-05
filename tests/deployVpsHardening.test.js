import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const workflow = readFileSync(new URL('../.github/workflows/deploy-vps.yml', import.meta.url), 'utf8')
const remoteUp = readFileSync(new URL('../deploy/remote-up.sh', import.meta.url), 'utf8')
const compose = readFileSync(new URL('../deploy/docker-compose.yml', import.meta.url), 'utf8')
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')

function tokenize(source) {
  const tokens = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === "'") {
      let value = ''
      i += 1
      while (i < source.length && source[i] !== "'") {
        value += source[i]
        i += 1
      }
      if (source[i] !== "'") throw new Error('unterminated string')
      i += 1
      tokens.push({ kind: 'string', value })
      continue
    }
    if ('()'.includes(ch)) {
      tokens.push({ kind: ch })
      i += 1
      continue
    }
    if (source.startsWith('==', i)) {
      tokens.push({ kind: '==' })
      i += 2
      continue
    }
    if (source.startsWith('&&', i)) {
      tokens.push({ kind: '&&' })
      i += 2
      continue
    }
    if (source.startsWith('||', i)) {
      tokens.push({ kind: '||' })
      i += 2
      continue
    }
    if (ch === ',') {
      tokens.push({ kind: ',' })
      i += 1
      continue
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(i))
    if (ident) {
      tokens.push({ kind: 'ident', value: ident[0] })
      i += ident[0].length
      continue
    }
    throw new Error(`unexpected ${source.slice(i, i + 20)}`)
  }
  return tokens
}

function lookup(root, path) {
  let cur = root
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, part)) return null
    cur = cur[part]
  }
  return cur
}

function truthy(value) {
  return !(value === false || value === null || value === undefined || value === 0 || value === '')
}

function equal(left, right) {
  return left === right
}

// GitHub Actions returns the operand from && and ||, matching the
// `condition && 'name' || 'other'` form used in the deploy workflow.
function evaluateGithubExpression(source, github) {
  const tokens = tokenize(source)
  let i = 0
  function peek() {
    return tokens[i]
  }
  function parseOr() {
    let left = parseAnd()
    while (peek()?.kind === '||') {
      i += 1
      const right = parseAnd()
      left = truthy(left) ? left : right
    }
    return left
  }
  function parseAnd() {
    let left = parseEq()
    while (peek()?.kind === '&&') {
      i += 1
      const right = parseEq()
      left = truthy(left) ? right : left
    }
    return left
  }
  function parseEq() {
    const left = parsePrimary()
    if (peek()?.kind !== '==') return left
    i += 1
    const right = parsePrimary()
    return equal(left, right)
  }
  function parsePrimary() {
    const token = peek()
    if (!token) throw new Error('unexpected end')
    if (token.kind === '(') {
      i += 1
      const value = parseOr()
      if (peek()?.kind !== ')') throw new Error('missing )')
      i += 1
      return value
    }
    if (token.kind === 'string') {
      i += 1
      return token.value
    }
    if (token.kind === 'ident') {
      i += 1
      if (peek()?.kind === '(') {
        i += 1
        const args = []
        if (peek()?.kind !== ')') {
          args.push(parseOr())
          while (peek()?.kind === ',') {
            i += 1
            args.push(parseOr())
          }
        }
        if (peek()?.kind !== ')') throw new Error('missing )')
        i += 1
        if (token.value !== 'format') throw new Error(`unsupported call ${token.value}`)
        const template = String(args[0])
        return template.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index) + 1]))
      }
      return lookup(github, token.value)
    }
    throw new Error(`bad token ${token.kind}`)
  }
  const value = parseOr()
  if (i !== tokens.length) throw new Error('trailing tokens')
  return value
}

function concurrencyGroup(github) {
  const match = workflow.match(/group:\s*\$\{\{\s*([\s\S]*?)\s*\}\}/)
  assert.ok(match, 'concurrency group expression missing')
  return evaluateGithubExpression(match[1], { github })
}

describe('deploy VPS concurrency', () => {
  test('serializes production and keeps staging and skipped PR runs off that lock', () => {
    assert.equal(concurrencyGroup({
      event_name: 'workflow_dispatch',
      event: { inputs: { target: 'production' } },
      run_id: 10,
    }), 'deploy-vps-prod')
    assert.equal(concurrencyGroup({
      event_name: 'workflow_dispatch',
      event: { inputs: { target: 'staging' } },
      run_id: 11,
    }), 'deploy-vps-staging')
    assert.equal(concurrencyGroup({
      event_name: 'push',
      event: {},
      run_id: 12,
    }), 'deploy-vps-staging')
    assert.equal(concurrencyGroup({
      event_name: 'workflow_run',
      event: { workflow_run: { conclusion: 'success', event: 'push', head_branch: 'main' } },
      run_id: 13,
    }), 'deploy-vps-prod')
    assert.equal(concurrencyGroup({
      event_name: 'workflow_run',
      event: { workflow_run: { conclusion: 'success', event: 'pull_request', head_branch: 'feature' } },
      run_id: 14,
    }), 'deploy-vps-noop-14')
    assert.equal(concurrencyGroup({
      event_name: 'workflow_run',
      event: { workflow_run: { conclusion: 'failure', event: 'push', head_branch: 'main' } },
      run_id: 15,
    }), 'deploy-vps-noop-15')
    assert.equal(concurrencyGroup({
      event_name: 'workflow_run',
      event: { workflow_run: { conclusion: 'success', event: 'push', head_branch: 'staging/demo' } },
      run_id: 16,
    }), 'deploy-vps-noop-16')
  })

  test('does not cancel an in-progress deploy and queues the pending ones', () => {
    assert.match(workflow, /cancel-in-progress:\s*false/)
    assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/)
    assert.match(workflow, /queue:\s*max/)
    assert.match(workflow, /deploy-vps-prod/)
    assert.match(workflow, /deploy-vps-staging/)
    assert.match(workflow, /head_branch == 'main'/)
    assert.match(workflow, /branches:\s*\n\s*- 'staging\/\*\*'/)
  })
})

describe('deploy swap', () => {
  test('remote-up overlaps a healthy backend before recreating the canonical container', () => {
    execFileSync('bash', ['-n', new URL('../deploy/remote-up.sh', import.meta.url).pathname])
    assert.match(remoteUp, /HEALTH_ATTEMPTS=60/)
    assert.match(remoteUp, /TRAEFIK_SETTLE_SECONDS=10/)
    assert.match(remoteUp, /flock -n/)
    assert.match(remoteUp, /COMPOSE_FILE/)
    assert.match(remoteUp, /Never runs `docker system prune`/)
    assert.doesNotMatch(remoteUp, /^\s*docker system prune/m)
    assert.match(remoteUp, /clemson-rides-web-next/)
    assert.match(remoteUp, /clemson-rides-staging-next/)

    const tail = remoteUp.slice(remoteUp.indexOf('acquire_deploy_lock\n'))
    const start = tail.indexOf('start_fresh_overlap')
    const recreate = tail.indexOf('recreate_canonical')
    const fallbackRemove = tail.indexOf('remove_overlap')
    const promoted = tail.lastIndexOf('remove_overlap')
    assert.ok(start > 0 && start < fallbackRemove && fallbackRemove < recreate && recreate < promoted)
    assert.doesNotMatch(remoteUp, /docker network disconnect/)
    assert.match(remoteUp, /wait_healthy_attached/)
    assert.match(remoteUp, /stays on \$\{CLEMSON_NETWORK\}/)
    assert.match(remoteUp, /falling back to an in-place recreate/)
    assert.match(remoteUp, /TRAEFIK_OBSERVE_ATTEMPTS=30/)
  })

  test('compose healthcheck and overlap services share Traefik labels without taking the debug ports', () => {
    assert.match(dockerfile, /HEALTHCHECK --interval=2s/)
    for (const service of ['web:', 'web_next:', 'staging:', 'staging_next:']) {
      assert.ok(compose.includes(service))
    }
    assert.match(compose, /web_next:[\s\S]*profiles: \["overlap"\]/)
    assert.match(compose, /staging_next:[\s\S]*profiles: \["overlap"\]/)
    assert.match(compose, /healthcheck: \*app-healthcheck/)
    assert.match(compose, /web:\n[\s\S]*labels: \*web-labels/)
    assert.match(compose, /web_next:\n[\s\S]*labels: \*web-labels/)
    assert.match(compose, /staging:\n[\s\S]*labels: \*staging-labels/)
    assert.match(compose, /staging_next:\n[\s\S]*labels: \*staging-labels/)
    assert.match(compose, /DISABLE_CRON_ENDPOINTS: "1"/)
    const webNext = compose.split('web_next:')[1].split('staging:')[0]
    const stagingNext = compose.split('staging_next:')[1]
    assert.equal(webNext.includes('3080'), false)
    assert.equal(stagingNext.includes('3081'), false)
    assert.match(compose, /127\.0\.0\.1:3080:3000/)
    assert.match(compose, /127\.0\.0\.1:3081:3000/)
  })
})

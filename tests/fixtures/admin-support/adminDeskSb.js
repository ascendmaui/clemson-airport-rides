/**
 * Chainable fake for the Supabase calls adminDesk makes.
 * Later when() rules win. Every terminal records one call.
 */

export function hasFilter(ctx, op, column, value) {
  return ctx.filters.some((filter) => (
    filter.op === op && filter.column === column && Object.is(filter.value, value)
  ))
}

function snapshot(query, terminal) {
  return {
    table: query.table,
    op: query.op,
    columns: query.columns,
    head: Boolean(query.selectOptions && query.selectOptions.head),
    countMode: query.selectOptions ? (query.selectOptions.count || null) : null,
    payload: query.payload == null ? null : { ...query.payload },
    filters: query.filters.map((filter) => ({
      op: filter.op,
      column: filter.column,
      value: filter.value,
    })),
    orderBy: query.orderBy ? { column: query.orderBy.column, ascending: query.orderBy.ascending } : null,
    limitN: query.limitN,
    terminal,
  }
}

function defaultResult(ctx) {
  if (ctx.terminal === 'maybeSingle' || ctx.terminal === 'single') {
    return { data: null, error: null }
  }
  if (ctx.head) return { count: 0, error: null }
  if (ctx.op === 'insert' || ctx.op === 'update') return { data: null, error: null }
  return { data: [], error: null }
}

class Query {
  constructor(client, table) {
    this.client = client
    this.table = table
    this.op = null
    this.columns = null
    this.selectOptions = null
    this.payload = null
    this.filters = []
    this.orderBy = null
    this.limitN = null
  }

  select(columns, options) {
    if (this.op == null) this.op = 'select'
    this.columns = columns
    this.selectOptions = options || null
    return this
  }

  insert(payload) {
    this.op = 'insert'
    this.payload = payload
    return this
  }

  update(payload) {
    this.op = 'update'
    this.payload = payload
    return this
  }

  eq(column, value) {
    this.filters.push({ op: 'eq', column, value })
    return this
  }

  neq(column, value) {
    this.filters.push({ op: 'neq', column, value })
    return this
  }

  is(column, value) {
    this.filters.push({ op: 'is', column, value })
    return this
  }

  in(column, value) {
    this.filters.push({ op: 'in', column, value })
    return this
  }

  order(column, options) {
    this.orderBy = { column, ascending: options ? options.ascending : undefined }
    return this
  }

  limit(n) {
    this.limitN = n
    return this
  }

  maybeSingle() {
    return this.client._finish(this, 'maybeSingle')
  }

  single() {
    return this.client._finish(this, 'single')
  }

  then(onFulfilled, onRejected) {
    return this.client._finish(this, 'list').then(onFulfilled, onRejected)
  }
}

export function createFakeSb() {
  const calls = []
  const rules = []
  return {
    calls,
    when(match, result) {
      rules.push({ match, result })
      return this
    },
    from(table) {
      return new Query(this, table)
    },
    _finish(query, terminal) {
      const ctx = snapshot(query, terminal)
      calls.push(ctx)
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        if (rules[i].match(ctx)) {
          const value = rules[i].result
          return Promise.resolve(typeof value === 'function' ? value(ctx) : value)
        }
      }
      return Promise.resolve(defaultResult(ctx))
    },
  }
}

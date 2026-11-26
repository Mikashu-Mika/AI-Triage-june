// In-memory stand-in for the Supabase client, so tests never touch a real database.
// Covers the query-builder calls the bot uses: select/insert/update/upsert/delete with
// eq, neq, in, gt(e), lt(e), is, like, ilike, not, filter, match, order, limit, range, single, maybeSingle.
import crypto from 'node:crypto';

const DEFAULTS = {
  companies: () => ({
    client_id: `client-${crypto.randomUUID()}`,
    client_secret: crypto.randomBytes(16).toString('hex'),
    package_tier: 'starter',
    package_status: 'active',
    billing_cycle_anchor: 1,
  }),
  users: () => ({ is_active: true }),
};

const likeToRegExp = (pattern, flags) =>
  new RegExp('^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', flags);

const OPS = {
  eq: (v, x) => v === x,
  neq: (v, x) => v !== x,
  gt: (v, x) => v > x,
  gte: (v, x) => v >= x,
  lt: (v, x) => v < x,
  lte: (v, x) => v <= x,
  in: (v, list) => list.includes(v),
  is: (v, x) => (x === null ? v === null || v === undefined : v === x),
  like: (v, p) => typeof v === 'string' && likeToRegExp(p).test(v),
  ilike: (v, p) => typeof v === 'string' && likeToRegExp(p, 'i').test(v),
};

function project(row, columns) {
  if (!columns || columns.trim() === '*' || columns.includes('(')) return { ...row };
  const out = {};
  for (const col of columns.split(',').map(c => c.trim()).filter(Boolean)) out[col] = row[col] ?? null;
  return out;
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.op = 'select';
    this.columns = '*';
    this.returning = false;
    this.filters = [];
    this.orders = [];
    this.rangeFrom = 0;
    this.rangeTo = Infinity;
    this.mode = 'many';
    this.countOnly = false;
  }

  select(columns = '*', options = {}) {
    if (this.op === 'select') this.columns = columns;
    else { this.returning = true; this.columns = columns; }
    if (options.count) this.wantCount = true;
    if (options.head) this.countOnly = true;
    return this;
  }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  upsert(rows, { onConflict } = {}) {
    this.op = 'upsert';
    this.payload = rows;
    this.conflictCols = onConflict ? onConflict.split(',').map(c => c.trim()) : null;
    return this;
  }
  update(patch) { this.op = 'update'; this.payload = patch; return this; }
  delete() { this.op = 'delete'; return this; }

  where(column, test) { this.filters.push(row => test(row[column])); return this; }
  eq(c, v) { return this.where(c, x => OPS.eq(x, v)); }
  neq(c, v) { return this.where(c, x => OPS.neq(x, v)); }
  gt(c, v) { return this.where(c, x => OPS.gt(x, v)); }
  gte(c, v) { return this.where(c, x => OPS.gte(x, v)); }
  lt(c, v) { return this.where(c, x => OPS.lt(x, v)); }
  lte(c, v) { return this.where(c, x => OPS.lte(x, v)); }
  in(c, list) { return this.where(c, x => OPS.in(x, list)); }
  is(c, v) { return this.where(c, x => OPS.is(x, v)); }
  like(c, p) { return this.where(c, x => OPS.like(x, p)); }
  ilike(c, p) { return this.where(c, x => OPS.ilike(x, p)); }
  not(c, op, v) { return this.where(c, x => !OPS[op](x, v)); }
  filter(c, op, v) { return this.where(c, x => OPS[op](x, v)); }
  match(obj) { for (const [c, v] of Object.entries(obj)) this.eq(c, v); return this; }
  or() { throw new Error('fakeSupabase: .or() is not supported'); }

  order(column, { ascending = true } = {}) { this.orders.push({ column, ascending }); return this; }
  limit(n) { this.rangeTo = Math.min(this.rangeTo, this.rangeFrom + n - 1); return this; }
  range(from, to) { this.rangeFrom = from; this.rangeTo = to; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  then(resolve, reject) {
    try { resolve(this.run()); } catch (err) { reject(err); }
  }

  rows() { return this.db.tables[this.table] ??= []; }
  matching() { return this.rows().filter(row => this.filters.every(f => f(row))); }

  run() {
    this.db.calls.push({ table: this.table, op: this.op });
    let result;
    if (this.op === 'select') {
      result = this.matching();
      for (const { column, ascending } of [...this.orders].reverse()) {
        result = [...result].sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (ascending ? 1 : -1));
      }
      const total = result.length;
      result = result.slice(this.rangeFrom, this.rangeTo + 1);
      if (this.countOnly) return { data: null, count: total, error: null };
      return this.finish(result.map(r => project(r, this.columns)), this.wantCount ? total : undefined);
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const written = [];
      for (const input of list) {
        // Upsert matches on the onConflict columns when given, like Postgres ON CONFLICT; otherwise on id
        const existing = this.op === 'upsert' && this.conflictCols
          ? this.rows().find(r => this.conflictCols.every(c => r[c] === input[c]))
          : input.id !== undefined ? this.rows().find(r => r.id === input.id) : undefined;
        if (existing && this.op === 'insert') {
          return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${this.table}_pkey"` } };
        }
        if (existing) { Object.assign(existing, input); written.push(existing); continue; }
        const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[this.table]?.() ?? {}), ...input };
        this.rows().push(row);
        written.push(row);
      }
      return this.returning ? this.finish(written.map(r => project(r, this.columns))) : { data: null, error: null };
    }
    if (this.op === 'update') {
      const hit = this.matching();
      for (const row of hit) Object.assign(row, this.payload);
      return this.returning ? this.finish(hit.map(r => project(r, this.columns))) : { data: null, error: null };
    }
    if (this.op === 'delete') {
      const hit = this.matching();
      this.db.tables[this.table] = this.rows().filter(r => !hit.includes(r));
      return this.returning ? this.finish(hit.map(r => project(r, this.columns))) : { data: null, error: null };
    }
    throw new Error(`fakeSupabase: unknown op ${this.op}`);
  }

  finish(rows, count) {
    if (this.mode === 'many') return { data: rows, error: null, ...(count !== undefined ? { count } : {}) };
    if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } };
    if (rows.length === 0) {
      return this.mode === 'maybe'
        ? { data: null, error: null }
        : { data: null, error: { code: 'PGRST116', message: 'no rows returned' } };
    }
    return { data: rows[0], error: null };
  }
}

export function createFakeSupabase() {
  const db = { tables: {}, calls: [] };
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  return {
    db,
    /** Replace every table's rows (deep-copied so tests cannot share state by accident). */
    reset(seed = {}) { db.tables = structuredClone(seed); db.calls.length = 0; },
    from: table => new Query(db, table),
    channel: () => channel,
    removeChannel: async () => {},
    rpc: async () => ({ data: null, error: null }),
  };
}

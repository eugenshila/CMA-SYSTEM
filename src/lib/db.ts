import 'server-only';
import pg from 'pg';
import { env } from './env';

const { Pool, types } = pg;

// NUMERIC -> number and BIGINT -> number so application code can work with
// plain JavaScript numbers (values are KES amounts / row ids well within range).
types.setTypeParser(20, (v: string) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1700, (v: string) => (v === null ? null : parseFloat(v)));

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: parseInt(process.env.PGPOOL_MAX || '8', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      ssl: env.DATABASE_URL.includes('sslmode=require') || process.env.PGSSL === '1'
        ? { rejectUnauthorized: false }
        : undefined,
      allowExitOnIdle: false,
    });
    pool.on('error', (err) => console.error('[db] idle client error', err.message));
  }
  return pool;
}

export type Queryable = pg.Pool | pg.PoolClient;

/* ------------------------------------------------------------------ *
 * Connection resilience
 *
 * A pooled client can go stale (server restart, idle timeout, or the
 * single-threaded PGlite dev server dropping a socket). When that happens the
 * driver raises a connection-level error before the statement is executed, so
 * re-running it on a fresh client from the pool is safe. Statements that run
 * inside an explicit transaction are never retried — the caller owns that
 * rollback.
 * ------------------------------------------------------------------ */
const CONNECTION_ERROR_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT', '08000', '08003', '08006', '57P01', '57P02', '57P03']);

export function isConnectionError(err: any): boolean {
  if (!err) return false;
  if (CONNECTION_ERROR_CODES.has(String(err.code || ''))) return true;
  return /connection terminated unexpectedly|read ECONNRESET|server closed the connection|terminating connection/i.test(String(err.message || ''));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isConnectionError(err)) throw err;
      attempt += 1;
      await new Promise((r) => setTimeout(r, 120 * attempt));
    }
  }
}

export async function query<T = any>(text: string, params: any[] = [], client?: Queryable): Promise<T[]> {
  const runner = client || getPool();
  const run = async () => (await runner.query(text, params)).rows as T[];
  return client ? run() : withRetry(run);
}

export async function one<T = any>(text: string, params: any[] = [], client?: Queryable): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

export async function many<T = any>(text: string, params: any[] = [], client?: Queryable): Promise<T[]> {
  return query<T>(text, params, client);
}

export async function scalar<T = any>(text: string, params: any[] = [], client?: Queryable): Promise<T | null> {
  const row = await one<Record<string, any>>(text, params, client);
  if (!row) return null;
  const first = Object.values(row)[0];
  return (first === undefined ? null : first) as T;
}

export async function execute(text: string, params: any[] = [], client?: Queryable): Promise<number> {
  const runner = client || getPool();
  const run = async () => (await runner.query(text, params)).rowCount ?? 0;
  return client ? run() : withRetry(run);
}

/**
 * Run `fn` inside a database transaction. Rollback is automatic on throw.
 */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await withRetry(() => getPool().connect(), 3);
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Build a parameterised `IN ($1,$2,…)` list. */
export function inList(values: any[], startIndex = 1): { sql: string; params: any[] } {
  if (!values?.length) return { sql: '(NULL)', params: [] };
  return {
    sql: `(${values.map((_, i) => `$${startIndex + i}`).join(',')})`,
    params: values,
  };
}

/** Incrementally build a WHERE clause with bound parameters. */
export class SqlBuilder {
  private clauses: string[] = [];
  params: any[] = [];

  where(sql: string, ...values: any[]) {
    for (const v of values) this.params.push(v);
    this.clauses.push(sql.replace(/\$(\w+)/g, (_m, name) => {
      // named placeholders are not supported; keep positional only
      return `$${name}`;
    }));
    return this;
  }

  /** Adds `sql` replacing every `?` with the next positional parameter. */
  add(sql: string, ...values: any[]) {
    let i = this.params.length;
    const replaced = sql.replace(/\?/g, () => {
      i += 1;
      return `$${i}`;
    });
    this.params.push(...values);
    this.clauses.push(replaced);
    return this;
  }

  get whereSql(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }

  get andSql(): string {
    return this.clauses.length ? ` AND ${this.clauses.join(' AND ')}` : '';
  }
}

export const db = { query, one, many, scalar, execute, tx, getPool };
export default db;

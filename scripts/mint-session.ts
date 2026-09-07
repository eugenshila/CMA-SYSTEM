/**
 * Development helper: prints a valid `cma_session` cookie for a seeded user so
 * pages can be smoke-tested with curl (no browser needed).
 *
 *   npx tsx scripts/mint-session.ts treasurer@stmonica.or.ke
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { SignJWT } from 'jose';

function loadEnv() {
  const file = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret';
const secretKey = () => new TextEncoder().encode(AUTH_SECRET);

async function main() {
  const identifier = process.argv[2] || 'admin@stmonica.or.ke';
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(
    `SELECT u.id, u.name, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.deleted_at IS NULL AND (lower(u.email) = lower($1) OR u.phone = $1 OR lower(u.login_id) = lower($1))
      LIMIT 1`,
    [identifier],
  );
  const user = rows[0];
  if (!user) {
    console.error(`No user found for "${identifier}"`);
    await client.end();
    process.exit(1);
  }

  const raw = crypto.randomBytes(32).toString('base64url');
  const inserted = await client.query(
    `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1,$2,$3,$4, now() + interval '12 hours') RETURNING id`,
    [user.id, crypto.createHash('sha256').update(raw).digest('hex'), '127.0.0.1', 'mint-session'],
  );
  const sessionId = Number(inserted.rows[0].id);

  const token = await new SignJWT({ rk: user.role_key, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setIssuer('cma-system')
    .setExpirationTime('12h')
    .sign(secretKey());

  await client.end();
  console.log(`# ${user.name} (${user.role_key}) — session ${sessionId}`);
  console.log(`cma_session=${token}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

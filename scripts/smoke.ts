import pg from 'pg';
import { verifyPassword } from '@/lib/crypto';

const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/postgres';

const CREDS: [string, string][] = [
  ['superadmin@cma.or.ke', 'Cma@Super2026'],
  ['admin@stmonica.or.ke', 'Cma@Admin2026'],
  ['treasurer@stmonica.or.ke', 'Cma@Treas2026'],
  ['secretary@stmonica.or.ke', 'Cma@Sec2026'],
  ['CMA/STM/0006', 'Member@2026'],
];

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  for (const [identifier, pw] of CREDS) {
    const { rows } = await client.query(
      `SELECT u.id, u.name, u.password_hash, u.member_id, r.key AS role_key
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.deleted_at IS NULL AND (lower(u.email) = lower($1) OR u.phone = $1 OR lower(u.login_id) = lower($1))
        LIMIT 1`,
      [identifier],
    );
    const u = rows[0];
    if (!u) { console.log(`✗ ${identifier} — user not found`); continue; }
    const ok = await verifyPassword(pw, u.password_hash);
    console.log(`${ok ? '✓' : '✗'} ${identifier} → ${u.name} (${u.role_key}, member_id=${u.member_id})`);
  }
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM members)::int AS members,
            (SELECT count(*) FROM member_contributions)::int AS contributions,
            (SELECT count(*) FROM payments)::int AS payments,
            (SELECT count(*) FROM savings)::int AS savings,
            (SELECT count(*) FROM shares)::int AS shares,
            (SELECT count(*) FROM meetings)::int AS meetings,
            (SELECT count(*) FROM attendance)::int AS attendance,
            (SELECT count(*) FROM permissions)::int AS permissions`,
  );
  console.log('counts:', rows[0]);
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

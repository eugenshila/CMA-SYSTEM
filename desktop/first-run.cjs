/**
 * First-run provisioning for the desktop build.
 *
 * If the installation has no users yet, create a `super_admin` account with a
 * freshly generated, policy-compliant password and write the credentials to a
 * text file inside the data directory. The account is created with
 * `must_change_password` so the first sign-in forces a password change.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pg = require('pg');
const bcrypt = require('bcryptjs');

const LOGIN_ID = 'ADMIN';
const EMAIL = 'admin@cma.local';

function generatePassword() {
  // Always satisfies the app's password policy: >= 8 chars, letter(s) + number(s).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let pw = 'Cma@';
  for (let i = 0; i < 12; i += 1) pw += alphabet[bytes[i] % alphabet.length];
  return pw;
}

/**
 * @returns {Promise<{loginId:string,email:string,password:string,credPath:string}|null>}
 *          an object when an admin was created, otherwise null.
 */
async function ensureFirstAdmin(databaseUrl, dataDir, logger = console) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const { rows } = await client.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) {
    await client.end();
    return null;
  }

  const role = await client.query(`SELECT id FROM roles WHERE key = 'super_admin'`);
  if (!role.rows[0]) {
    await client.end();
    throw new Error('roles have not been seeded — run migrations before first-run');
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);

  await client.query(
    `INSERT INTO users
       (role_id, name, email, login_id, password_hash, status, must_change_password, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, 'active', TRUE, now())`,
    [role.rows[0].id, 'System Administrator', EMAIL, LOGIN_ID, passwordHash],
  );
  await client.end();

  const credPath = path.join(dataDir, 'first-run-credentials.txt');
  fs.writeFileSync(
    credPath,
    [
      '============================================================',
      ' CMA SYSTEM — FIRST-RUN ADMINISTRATOR',
      '============================================================',
      '',
      '  Login:    ' + LOGIN_ID,
      '  Email:    ' + EMAIL,
      '  Password: ' + password,
      '',
      'You will be asked to choose a new password on first sign-in.',
      'Keep this file safe, then delete it once you have signed in.',
      '',
      'Data directory: ' + dataDir,
      '============================================================',
      '',
    ].join('\n'),
    'utf8',
  );

  logger.log('[first-run] administrator credentials written to ' + credPath);
  return { loginId: LOGIN_ID, email: EMAIL, password, credPath };
}

module.exports = { ensureFirstAdmin };

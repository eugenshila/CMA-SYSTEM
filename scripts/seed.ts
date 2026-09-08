/**
 * Realistic demonstration data for a parish CMA.
 *
 *   npm run db:seed
 *
 * The script is deterministic (seeded PRNG), idempotent-safe (it refuses to run
 * on a database that already has members unless --force is passed) and writes
 * everything with batched multi-row INSERTs so it runs in a couple of seconds.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../src/lib/env';
import { encryptField, blindIndex } from '../src/lib/crypto';

const FORCE = process.argv.includes('--force');
const DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;

/* ------------------------------------------------------------------ *
 * deterministic pseudo random generator
 * ------------------------------------------------------------------ */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260106);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const chance = (p: number) => rnd() < p;
const r2 = (n: number) => Math.round(n * 100) / 100;
const date = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ts = (y: number, m: number, d: number, hh = 10, mm = 0) => `${date(y, m, d)} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+03`;

/* ------------------------------------------------------------------ *
 * reference content
 * ------------------------------------------------------------------ */
const FIRST = [
  'James','Michael','Robert','John','David','William','Richard','Thomas','Charles','Christopher',
  'Daniel','Matthew','Anthony','Mark','Donald','Steven','Paul','Andrew','Joshua','Kenneth',
  'Kevin','Brian','George','Edward','Ronald','Timothy','Jason','Jeffrey','Ryan','Jacob',
  'Gary','Nicholas','Eric','Jonathan','Stephen','Larry','Justin','Scott','Brandon','Benjamin',
  'Samuel','Gregory','Alexander','Frank','Patrick','Raymond','Jack','Dennis','Jerry','Tyler',
  'Aaron','Jose','Adam','Henry','Nathan','Douglas','Peter','Kyle','Ethan','Walter',
  'Gabriel','Carl','Arthur','Roger','Gerald','Keith','Jeremy','Terry','Christian','Sean',
];
const LAST = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez',
  'Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin',
  'Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson',
  'Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores',
  'Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts',
  'Gomez','Phillips','Evans','Turner','Diaz','Parker','Cruz','Edwards','Collins','Reyes',
];
const OCCUPATIONS = [
  'Teacher','Civil Engineer','Farmer','Businessman','Accountant','Nurse Practitioner','Electrician','Plumber','Bank Officer','Advocate',
  'Driver','Carpenter','Software Developer','Pharmacist','Police Officer','Shop Keeper','Mechanic','Architect','Lecturer','Security Officer',
  'Mason','Warehouse Supervisor','Sales Manager','Agronomist','Doctor','Clerk','Tailor','Boda Boda Rider','Contractor','Catechist',
];
const AREAS = ['Kamakis','Njiru','Ruai','Mihango','Utawala','Kayole','Pipeline','Githurai','Kahawa','Zimmerman','Roysambu','Kasarani','Ruiru','Juja'];
const SCC = ['St. Joseph SCC','Holy Family SCC','St. Monica SCC','Good Shepherd SCC','St. Peter SCC','St. Anthony SCC','Mater Misericordiae SCC','St. Michael SCC'];

/* ------------------------------------------------------------------ *
 * helpers for batched inserts
 * ------------------------------------------------------------------ */
type Row = Record<string, any>;

class Table {
  rows: Row[] = [];
  constructor(public name: string, public columns: string[]) {}
  add(row: Row) {
    this.rows.push(row);
    return row;
  }
}

function q(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function flush(client: pg.Client, table: Table, chunk = 200) {
  if (!table.rows.length) return;
  for (let i = 0; i < table.rows.length; i += chunk) {
    const part = table.rows.slice(i, i + chunk);
    const values = part
      .map((row) => `(${table.columns.map((c) => q(row[c] ?? null)).join(',')})`)
      .join(',\n');
    await client.query(`INSERT INTO ${table.name} (${table.columns.join(',')}) VALUES\n${values}`);
  }
  process.stdout.write(`  ${table.name}: ${table.rows.length} rows\n`);
}

async function setval(client: pg.Client, table: string) {
  await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`);
}

const hash = (pw: string) => bcrypt.hashSync(pw, 10);

/* ------------------------------------------------------------------ *
 * placeholder document files (replicates src/lib/files.ts storeFile)
 * ------------------------------------------------------------------ */
const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'storage/uploads');

/** Build a small, valid single-page PDF used as a placeholder document file. */
function makePdf(title: string, subtitle: string): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content =
    `BT /F1 16 Tf 56 780 Td (${esc(title)}) Tj ET\n` +
    `BT /F1 11 Tf 56 754 Td (${esc(subtitle)}) Tj ET\n` +
    `BT /F1 9 Tf 56 724 Td (Catholic Men Association - demonstration document.) Tj ET\n` +
    `BT /F1 9 Tf 56 710 Td (This placeholder file is generated by the seed script.) Tj ET`;
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];
  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/* ------------------------------------------------------------------ *
 * MAIN
 * ------------------------------------------------------------------ */
async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('[seed] connected');

  const existing = await client.query('SELECT count(*)::int AS c FROM members');
  if (existing.rows[0].c > 0 && !FORCE) {
    console.log(`[seed] database already contains ${existing.rows[0].c} members — skipping.`);
    console.log('[seed] run with --force to wipe and re-seed demo data.');
    if (FORCE) {
      /* handled below */
    } else {
      await client.end();
      return;
    }
  }

  if (existing.rows[0].c > 0 && FORCE) {
    console.log('[seed] --force: truncating demo tables…');
    await client.query(`TRUNCATE TABLE
      audit_logs, notification_logs, notifications, notices, attendance, meetings,
      dividend_allocations, dividends, penalties, loan_repayments, loan_schedules, loan_guarantors,
      loans, loan_applications, share_transactions, shares, savings, sacco_transactions, sacco_accounts,
      project_contributions, special_projects, wedding_payments, wedding_cases, funeral_payments, funeral_cases,
      welfare_payments, welfare_cases, receipts, payment_allocations, mpesa_transactions, payments,
      member_contributions, documents, member_documents, users, user_sessions, otp_codes, login_attempts, members,
      small_christian_communities, churches, parishes, deaneries, dioceses
      RESTART IDENTITY CASCADE`);
    // TRUNCATE … CASCADE also clears reference tables that hold a FK to users/parishes
    // (loan_types.created_by, contribution_types.parish_id/created_by, system_settings.updated_by).
    // Re-apply the idempotent reference-data migration so the seed can read loan_types etc.
    const refSql = await fs.readFile(path.resolve(process.cwd(), 'db/migrations/002_reference_data.sql'), 'utf8');
    await client.query(refSql);
    console.log('[seed] reference data re-applied (loan_types, contribution_types, system_settings)');
  }

  const t0 = Date.now();
  const roles = (await client.query('SELECT id, key FROM roles')).rows;
  const roleId = (key: string) => roles.find((r) => r.key === key)?.id;
  const contributionTypes = (await client.query('SELECT id, key FROM contribution_types')).rows;
  const ctId = (key: string) => contributionTypes.find((c) => c.key === key)?.id;
  const loanTypes = (await client.query('SELECT id, code, interest_rate, interest_method, processing_fee_pct FROM loan_types')).rows;
  const ltId = (code: string) => loanTypes.find((l) => l.code === code)?.id;

  /* ---------------- organisation ---------------- */
  const countryId = (await client.query("SELECT id FROM countries WHERE code='KE'")).rows[0]?.id ?? 1;

  const dioceses = new Table('dioceses', ['id', 'country_id', 'code', 'name', 'type', 'bishop']);
  dioceses.add({ id: 1, country_id: countryId, code: 'ADN', name: 'Archdiocese of Nairobi', type: 'archdiocese', bishop: 'Most Rev. Philip Anyolo' });
  dioceses.add({ id: 2, country_id: countryId, code: 'MUR', name: 'Diocese of Muranga', type: 'diocese', bishop: 'Most Rev. James Wainaina' });

  const deaneries = new Table('deaneries', ['id', 'diocese_id', 'code', 'name']);
  deaneries.add({ id: 1, diocese_id: 1, code: 'DEAN-KMB', name: 'Kamakis Deanery' });
  deaneries.add({ id: 2, diocese_id: 1, code: 'DEAN-NBI', name: 'Nairobi Central Deanery' });

  const parishes = new Table('parishes', [
    'id', 'deanery_id', 'diocese_id', 'code', 'name', 'parish_priest', 'cma_chaplain', 'address', 'phone', 'email',
  ]);
  parishes.add({ id: 1, deanery_id: 1, diocese_id: 1, code: 'STM', name: 'St. Monica Parish, Kamakis', parish_priest: 'Fr. Boniface Wambugu', cma_chaplain: 'Fr. John Otieno', address: 'P.O. Box 1234-00100, Kamakis', phone: '+254712000001', email: 'stmonica@cma.or.ke' });
  parishes.add({ id: 2, deanery_id: 1, diocese_id: 1, code: 'SPC', name: 'St. Peter Claver Parish, Ruai', parish_priest: 'Fr. Anthony Kariuki', cma_chaplain: 'Fr. Peter Njuguna', address: 'P.O. Box 456-00517, Ruai', phone: '+254712000002', email: 'stpeterclaver@cma.or.ke' });
  parishes.add({ id: 3, deanery_id: 2, diocese_id: 1, code: 'HFN', name: 'Holy Family Parish, Nyeri Road', parish_priest: 'Fr. Charles Mbugua', cma_chaplain: 'Fr. Simon Ndungu', address: 'P.O. Box 789-00100, Nairobi', phone: '+254712000003', email: 'holyfamily@cma.or.ke' });

  const churches = new Table('churches', ['id', 'parish_id', 'code', 'name', 'type', 'location']);
  const churchList = [
    { id: 1, parish_id: 1, code: 'STM-MAIN', name: 'St. Monica Parish Church', type: 'parish_church', location: 'Kamakis' },
    { id: 2, parish_id: 1, code: 'STM-NJR', name: 'St. Joseph Njiru Outstation', type: 'outstation', location: 'Njiru' },
    { id: 3, parish_id: 1, code: 'STM-RUA', name: 'Christ the King Ruai Outstation', type: 'outstation', location: 'Ruai' },
    { id: 4, parish_id: 1, code: 'STM-MIH', name: 'St. Monica Mihango Chapel', type: 'chapel', location: 'Mihango' },
    { id: 5, parish_id: 2, code: 'SPC-MAIN', name: 'St. Peter Claver Parish Church', type: 'parish_church', location: 'Ruai' },
    { id: 6, parish_id: 2, code: 'SPC-UTA', name: 'St. Paul Utawala Outstation', type: 'outstation', location: 'Utawala' },
    { id: 7, parish_id: 3, code: 'HFN-MAIN', name: 'Holy Family Parish Church', type: 'parish_church', location: 'Nyeri Road' },
    { id: 8, parish_id: 3, code: 'HFN-KAH', name: 'St. Anthony Kahawa Outstation', type: 'outstation', location: 'Kahawa' },
  ];
  churchList.forEach((c) => churches.add(c));

  const sccs = new Table('small_christian_communities', ['id', 'church_id', 'parish_id', 'code', 'name', 'leader_name']);
  const sccRows: { id: number; church_id: number; parish_id: number; name: string }[] = [];
  let sccId = 0;
  for (const c of churchList.slice(0, 6)) {
    for (let i = 0; i < 2; i++) {
      sccId++;
      const name = `${SCC[(sccId - 1) % SCC.length]} – ${c.location}`;
      sccs.add({ id: sccId, church_id: c.id, parish_id: c.parish_id, code: `${c.code}-SCC${i + 1}`, name, leader_name: `${pick(FIRST)} ${pick(LAST)}` });
      sccRows.push({ id: sccId, church_id: c.id, parish_id: c.parish_id, name });
    }
  }

  /* ---------------- financial years ---------------- */
  const fys = new Table('financial_years', ['id', 'name', 'start_date', 'end_date', 'is_current']);
  fys.add({ id: 1, name: 'FY 2025', start_date: date(2025, 1, 1), end_date: date(2025, 12, 31), is_current: false });
  fys.add({ id: 2, name: 'FY 2026', start_date: date(2026, 1, 1), end_date: date(2026, 12, 31), is_current: true });

  /* ---------------- members ---------------- */
  const members = new Table('members', [
    'id', 'membership_no', 'salutation', 'full_name', 'first_name', 'middle_name', 'last_name', 'gender',
    'national_id_enc', 'national_id_hash', 'national_id_last4', 'phone', 'alt_phone', 'email', 'date_of_birth',
    'marital_status', 'occupation', 'employer', 'residential_area', 'parish_id', 'church_id', 'scc_id',
    'date_joined', 'membership_status', 'membership_type', 'baptism_date', 'next_of_kin', 'next_of_kin_relation',
    'next_of_kin_phone', 'emergency_contact', 'emergency_contact_rel', 'emergency_contact_phone',
    'exempt_monthly', 'exemption_reason', 'created_by', 'created_at',
  ]);

  const MEMBER_COUNT = 64;
  const memberRows: any[] = [];
  for (let i = 1; i <= MEMBER_COUNT; i++) {
    const first = FIRST[(i - 1) % FIRST.length];
    const middle = chance(0.55) ? pick(FIRST) : '';
    const last = LAST[(i * 7) % LAST.length];
    const fullName = [first, middle, last].filter(Boolean).join(' ');
    // 52 members in St. Monica (parish 1), the rest spread across the others
    const parishId = i <= 52 ? 1 : i <= 58 ? 2 : 3;
    const parishChurches = churchList.filter((c) => c.parish_id === parishId);
    const church = parishChurches[i % parishChurches.length];
    const churchSccs = sccRows.filter((s) => s.church_id === church.id);
    const scc = churchSccs.length ? churchSccs[i % churchSccs.length] : sccRows[i % sccRows.length];
    const prefix = { 1: 'STM', 2: 'SPC', 3: 'HFN' }[parishId] as string;
    const membershipNo = `CMA/${prefix}/${String(i).padStart(4, '0')}`;
    const dobYear = int(1962, 2001);
    const dob = date(dobYear, int(1, 12), int(1, 28));
    const joinedYear = int(2014, 2026);
    const joined = date(joinedYear, int(1, 12), int(1, 28));
    const phone = `2547${String(int(10000000, 99999999))}`;
    const status =
      i === 60 ? 'inactive' : i === 61 ? 'suspended' : i === 62 ? 'deceased' : i === 63 ? 'transferred' : i === 64 ? 'pending' : 'active';
    const nationalId = String(int(10000000, 39999999));

    memberRows.push({
      id: i,
      membership_no: membershipNo,
      salutation: 'Mr.',
      full_name: fullName,
      first_name: first,
      middle_name: middle || null,
      last_name: last,
      gender: 'male',
      national_id_enc: encryptField(nationalId),
      national_id_hash: blindIndex(nationalId),
      national_id_last4: nationalId.slice(-4),
      phone,
      alt_phone: chance(0.4) ? `2547${String(int(10000000, 99999999))}` : null,
      email: chance(0.75) ? `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}${i}@gmail.com` : null,
      date_of_birth: dob,
      marital_status: pick(['married', 'married', 'married', 'single', 'widowed']),
      occupation: pick(OCCUPATIONS),
      employer: chance(0.5) ? pick(['Self-employed', 'TSC', 'County Government', 'Safaricom PLC', 'Kenya Power', 'Equity Bank', 'KNBS', 'Private Practice']) : null,
      residential_area: pick(AREAS),
      parish_id: parishId,
      church_id: church.id,
      scc_id: scc.id,
      date_joined: joined,
      membership_status: status,
      membership_type: i === 59 ? 'associate' : 'full',
      baptism_date: date(dobYear + int(1, 12), int(1, 12), int(1, 28)),
      next_of_kin: `${pick(FIRST)} ${last}`,
      next_of_kin_relation: pick(['Wife', 'Brother', 'Sister', 'Father', 'Son']),
      next_of_kin_phone: `2547${String(int(10000000, 99999999))}`,
      emergency_contact: `${pick(FIRST)} ${pick(LAST)}`,
      emergency_contact_rel: pick(['Colleague', 'Neighbour', 'Friend', 'Brother']),
      emergency_contact_phone: `2547${String(int(10000000, 99999999))}`,
      exempt_monthly: status === 'deceased' || i === 55,
      exemption_reason: status === 'deceased' ? 'Deceased member' : i === 55 ? 'Long-term illness — exempted by the executive' : null,
      created_by: null,
      created_at: ts(joinedYear, 1, 5),
    });
    members.add(memberRows[memberRows.length - 1]);
  }

  const activeMembers = memberRows.filter((m) => m.membership_status === 'active' && !m.exempt_monthly);
  const allBilled = memberRows.filter((m) => m.membership_status === 'active');

  /* ---------------- users ---------------- */
  const users = new Table('users', [
    'id', 'member_id', 'role_id', 'scope_parish_id', 'name', 'email', 'phone', 'login_id', 'password_hash',
    'status', 'email_verified_at', 'phone_verified_at', 'password_changed_at', 'created_at',
  ]);

  const staff = [
    { id: 1, role: 'super_admin', name: 'Eng. Peter Ndegwa', email: 'superadmin@cma.or.ke', phone: '254700000001', login: 'SUPER001', pw: 'Cma@Super2026', parish: null },
    { id: 2, role: 'admin', name: 'Mr. Joseph Kamau', email: 'admin@stmonica.or.ke', phone: '254700000002', login: 'ADMIN001', pw: 'Cma@Admin2026', parish: 1 },
    { id: 3, role: 'chairman', name: 'Mr. Patrick Otieno', email: 'chairman@stmonica.or.ke', phone: '254700000003', login: 'CHAIR001', pw: 'Cma@Chair2026', parish: 1 },
    { id: 4, role: 'treasurer', name: 'Mr. Charles Mwangi', email: 'treasurer@stmonica.or.ke', phone: '254700000004', login: 'TRES001', pw: 'Cma@Treas2026', parish: 1 },
    { id: 5, role: 'secretary', name: 'Mr. Michael Kariuki', email: 'secretary@stmonica.or.ke', phone: '254700000005', login: 'SEC001', pw: 'Cma@Sec2026', parish: 1 },
    { id: 6, role: 'sacco_officer', name: 'Mr. Vincent Ndungu', email: 'sacco@stmonica.or.ke', phone: '254700000006', login: 'SDP001', pw: 'Cma@Sacco2026', parish: 1 },
    { id: 7, role: 'loan_committee', name: 'Mr. Francis Waweru', email: 'loans@stmonica.or.ke', phone: '254700000007', login: 'LOAN001', pw: 'Cma@Loan2026', parish: 1 },
    { id: 8, role: 'auditor', name: 'Mr. Bernard Ochieng', email: 'auditor@cma.or.ke', phone: '254700000008', login: 'AUD001', pw: 'Cma@Audit2026', parish: null },
  ];
  staff.forEach((s) =>
    users.add({
      id: s.id,
      member_id: null,
      role_id: roleId(s.role),
      scope_parish_id: s.parish,
      name: s.name,
      email: s.email,
      phone: s.phone,
      login_id: s.login,
      password_hash: hash(s.pw),
      status: 'active',
      email_verified_at: ts(2026, 1, 4),
      phone_verified_at: ts(2026, 1, 4),
      password_changed_at: ts(2026, 1, 4),
      created_at: ts(2026, 1, 4),
    }),
  );

  // Attach the chairman / treasurer / secretary / sacco officer to real member records
  const staffMemberLinks: [number, number][] = [
    [3, 1], [4, 2], [5, 3], [6, 4], [7, 5],
  ];
  staffMemberLinks.forEach(([userId, memberId]) => {
    const u = users.rows.find((x) => x.id === userId)!;
    u.member_id = memberId;
    u.phone = memberRows[memberId - 1].phone;
    memberRows[memberId - 1].full_name = u.name.replace('Mr. ', '').replace('Eng. ', '');
  });

  let nextUserId = staff.length + 1;
  const memberUsers: { userId: number; memberId: number; password: string }[] = [];
  memberRows.forEach((m, idx) => {
    if (staffMemberLinks.some(([, mid]) => mid === m.id)) return;
    if (idx % 4 !== 0 && m.id > 20) return; // only a subset of members hold online accounts in the demo
    const userId = nextUserId++;
    users.add({
      id: userId,
      member_id: m.id,
      role_id: roleId('member'),
      scope_parish_id: m.parish_id,
      name: m.full_name,
      email: m.email,
      phone: m.phone,
      login_id: m.membership_no,
      password_hash: hash('Member@2026'),
      status: 'active',
      email_verified_at: m.email ? ts(2026, 1, 6) : null,
      phone_verified_at: ts(2026, 1, 6),
      password_changed_at: ts(2026, 1, 6),
      created_at: ts(2026, 1, 6),
    });
    memberUsers.push({ userId, memberId: m.id, password: 'Member@2026' });
    m.user_id = userId;
  });

  /* ---------------- sacco accounts ---------------- */
  const accounts = new Table('sacco_accounts', [
    'id', 'account_no', 'member_id', 'parish_id', 'account_type', 'savings_balance', 'share_capital', 'shares_count',
    'total_deposits', 'min_monthly_savings', 'status', 'opened_at', 'updated_at',
  ]);
  memberRows.forEach((m) => {
    accounts.add({
      id: m.id,
      account_no: `SDP-${String(m.id).padStart(5, '0')}`,
      member_id: m.id,
      parish_id: m.parish_id,
      account_type: 'sdp',
      savings_balance: 0,
      share_capital: 0,
      shares_count: 0,
      total_deposits: 0,
      min_monthly_savings: 500,
      status: m.membership_status === 'deceased' ? 'closed' : 'active',
      opened_at: ts(2025, 1, 15),
      updated_at: ts(2026, 8, 1),
    });
  });

  /* ---------------- monthly contributions + payments + receipts ---------------- */
  const MONTHLY = ctId('monthly_contribution')!;
  const periods: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(2026, 7 - i, 1); // Aug 2026 backwards
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const PERIOD_LABEL: Record<string, string> = {};
  periods.forEach((p) => {
    const [y, m] = p.split('-').map(Number);
    PERIOD_LABEL[p] = `${new Date(y, m - 1, 1).toLocaleString('en', { month: 'long' })} ${y}`;
  });

  const memberContributions = new Table('member_contributions', [
    'id', 'member_id', 'contribution_type_id', 'financial_year_id', 'period', 'period_label', 'amount_due',
    'amount_paid', 'penalty', 'due_date', 'status', 'exempted', 'exemption_reason', 'billed_at', 'created_at',
  ]);
  const payments = new Table('payments', [
    'id', 'receipt_no', 'member_id', 'parish_id', 'amount', 'allocated_amount', 'unallocated_amount', 'payment_date',
    'method', 'reference', 'transaction_id', 'status', 'channel', 'category', 'notes', 'recorded_by', 'reconciled', 'created_at',
  ]);
  const allocations = new Table('payment_allocations', [
    'id', 'payment_id', 'member_id', 'allocation_type', 'reference_type', 'reference_id', 'period', 'amount', 'created_at',
  ]);
  const receipts = new Table('receipts', [
    'id', 'receipt_no', 'payment_id', 'member_id', 'organisation', 'parish_name', 'category', 'description', 'amount',
    'payment_method', 'reference', 'issued_by', 'issued_to_name', 'status', 'issued_at',
  ]);
  const savings = new Table('savings', [
    'id', 'sacco_account_id', 'member_id', 'receipt_no', 'transaction_type', 'amount', 'running_balance', 'payment_id',
    'payment_method', 'reference', 'transaction_date', 'period', 'notes', 'recorded_by',
  ]);
  const shares = new Table('shares', [
    'id', 'certificate_no', 'sacco_account_id', 'member_id', 'shares_count', 'value_per_share', 'total_value',
    'issued_date', 'status', 'created_by',
  ]);
  const shareTx = new Table('share_transactions', [
    'id', 'member_id', 'sacco_account_id', 'share_id', 'transaction_type', 'shares_count', 'value_per_share', 'amount',
    'payment_id', 'certificate_no', 'transaction_date', 'notes', 'recorded_by',
  ]);
  const saccoTx = new Table('sacco_transactions', [
    'id', 'sacco_account_id', 'member_id', 'ledger_type', 'direction', 'amount', 'balance_after', 'payment_id',
    'reference_type', 'reference_id', 'description', 'transaction_date', 'recorded_by',
  ]);

  let paymentId = 0;
  let allocationId = 0;
  let receiptId = 0;
  let mcId = 0;
  let savingsId = 0;
  let shareId = 0;
  let shareTxId = 0;
  let saccoTxId = 0;
  const receiptCounter: Record<string, number> = {};
  const nextReceiptNo = (year: number, month: number) => {
    const key = `${year}${String(month).padStart(2, '0')}`;
    receiptCounter[key] = (receiptCounter[key] || 0) + 1;
    return `CMA/${key}/${String(receiptCounter[key]).padStart(4, '0')}`;
  };

  const savingsBalances: Record<number, number> = {};
  const accountTotals: Record<number, { savings: number; deposits: number; shares: number; shareCapital: number }> = {};
  memberRows.forEach((m) => (accountTotals[m.id] = { savings: 0, deposits: 0, shares: 0, shareCapital: 0 }));

  function addPayment(opts: {
    memberId: number;
    amount: number;
    date: Date | string;
    method: string;
    category: string;
    allocations: { type: string; referenceType?: string; referenceId?: number | null; period?: string | null; amount: number }[];
    recordedBy?: number;
    channel?: string;
    reference?: string;
    transactionId?: string;
    notes?: string;
  }) {
    const member = memberRows[opts.memberId - 1];
    paymentId++;
    const d = new Date(opts.date as any);
    const receiptNo = nextReceiptNo(d.getFullYear(), d.getMonth() + 1);
    const iso = typeof opts.date === 'string' ? opts.date : d.toISOString();
    payments.add({
      id: paymentId,
      receipt_no: receiptNo,
      member_id: opts.memberId,
      parish_id: member.parish_id,
      amount: r2(opts.amount),
      allocated_amount: r2(opts.allocations.reduce((a, x) => a + x.amount, 0)),
      unallocated_amount: r2(opts.amount - opts.allocations.reduce((a, x) => a + x.amount, 0)),
      payment_date: iso,
      method: opts.method,
      reference: opts.reference || (opts.method === 'mpesa' ? `${pick(['QF', 'LK', 'MP', 'NH'])}${int(10, 99)}${int(100000, 999999)}` : `CHQ-${int(1000, 9999)}`),
      transaction_id: opts.transactionId || (opts.method === 'mpesa' ? `${pick(['QF', 'LK', 'MP'])}${int(10, 99)}${int(100000, 999999)}` : null),
      status: 'completed',
      channel: opts.channel || (opts.method === 'mpesa' ? 'stk_push' : 'manual'),
      category: opts.category,
      notes: opts.notes || null,
      recorded_by: opts.recordedBy ?? 4,
      reconciled: opts.method === 'mpesa',
      created_at: iso,
    });
    for (const a of opts.allocations) {
      allocationId++;
      allocations.add({
        id: allocationId,
        payment_id: paymentId,
        member_id: opts.memberId,
        allocation_type: a.type,
        reference_type: a.referenceType || null,
        reference_id: a.referenceId ?? null,
        period: a.period ?? null,
        amount: r2(a.amount),
        created_at: iso,
      });
    }
    receiptId++;
    receipts.add({
      id: receiptId,
      receipt_no: receiptNo,
      payment_id: paymentId,
      member_id: opts.memberId,
      organisation: 'Catholic Men Association (CMA)',
      parish_name: { 1: 'St. Monica Parish, Kamakis', 2: 'St. Peter Claver Parish, Ruai', 3: 'Holy Family Parish, Nyeri Road' }[member.parish_id],
      category: opts.category,
      description: opts.allocations
        .map((a) => `${a.type.replace(/_/g, ' ')}${a.period ? ` (${a.period})` : ''}: KSh ${r2(a.amount).toLocaleString()}`)
        .join('; '),
      amount: r2(opts.amount),
      payment_method: opts.method.toUpperCase(),
      reference: opts.reference || null,
      issued_by: opts.recordedBy ?? 4,
      issued_to_name: member.full_name,
      status: 'valid',
      issued_at: iso,
    });
    return { paymentId, receiptNo };
  }

  /* monthly contributions */
  for (const period of periods) {
    const [y, m] = period.split('-').map(Number);
    const dueDate = date(y, m, 10);
    const payDay = (offset = 0) => ts(y, m, Math.min(28, 3 + offset + int(0, 9)));
    for (const member of allBilled) {
      mcId++;
      const exempt = Boolean(member.exempt_monthly);
      const recent = m >= 7 && y === 2026;
      let paidAmount = 200;
      let status = 'paid';
      if (exempt) {
        paidAmount = 0;
        status = 'exempted';
      } else if (recent && member.id % 9 === 0) {
        paidAmount = 0;
        status = m === 8 && y === 2026 ? 'unpaid' : 'overdue';
      } else if (recent && member.id % 11 === 0) {
        paidAmount = 100;
        status = 'partial';
      } else if (member.id === 60 || member.id === 61) {
        paidAmount = chance(0.5) ? 0 : 200;
        status = paidAmount ? 'paid' : 'overdue';
      }
      const penalty = status === 'overdue' ? 50 : 0;
      memberContributions.add({
        id: mcId,
        member_id: member.id,
        contribution_type_id: MONTHLY,
        financial_year_id: y === 2025 ? 1 : 2,
        period,
        period_label: PERIOD_LABEL[period],
        amount_due: exempt ? 0 : 200,
        amount_paid: paidAmount,
        penalty,
        due_date: dueDate,
        status,
        exempted: exempt,
        exemption_reason: exempt ? member.exemption_reason : null,
        billed_at: ts(y, m, 1),
        created_at: ts(y, m, 1),
      });
      if (paidAmount > 0) {
        const method = chance(0.62) ? 'mpesa' : chance(0.5) ? 'cash' : 'bank';
        addPayment({
          memberId: member.id,
          amount: paidAmount,
          date: payDay(member.id % 7),
          method,
          category: 'Monthly CMA contribution',
          allocations: [{ type: 'monthly_contribution', referenceType: 'member_contributions', referenceId: mcId, period, amount: paidAmount }],
          recordedBy: method === 'cash' ? 4 : null,
          notes: `${PERIOD_LABEL[period]} monthly contribution`,
        });
      }
    }
  }

  /* ---------------- SDP / Sacco savings ---------------- */
  const savingsPeriods = periods.slice(0, 10); // last 10 months
  for (const period of savingsPeriods) {
    const [y, m] = period.split('-').map(Number);
    for (const member of activeMembers) {
      if (member.id % 7 === 0 && chance(0.5)) continue; // occasional missed deposit
      const amount = pick([300, 500, 500, 500, 700, 1000, 1000, 1500, 2000, 3000]);
      savingsId++;
      const balance = r2((savingsBalances[member.id] || 0) + amount);
      savingsBalances[member.id] = balance;
      const method = chance(0.55) ? 'mpesa' : 'cash';
      const { paymentId: pid, receiptNo } = addPayment({
        memberId: member.id,
        amount,
        date: ts(y, m, int(4, 24)),
        method,
        category: 'SDP / Sacco savings',
        allocations: [{ type: 'savings', referenceType: 'sacco_accounts', referenceId: member.id, period, amount }],
        recordedBy: method === 'cash' ? 6 : null,
        notes: `${PERIOD_LABEL[period]} savings deposit`,
      });
      savings.add({
        id: savingsId,
        sacco_account_id: member.id,
        member_id: member.id,
        receipt_no: receiptNo,
        transaction_type: 'deposit',
        amount,
        running_balance: balance,
        payment_id: pid,
        payment_method: method,
        reference: null,
        transaction_date: ts(y, m, int(4, 24)),
        period,
        notes: `${PERIOD_LABEL[period]} monthly savings`,
        recorded_by: 6,
      });
      saccoTxId++;
      saccoTx.add({
        id: saccoTxId,
        sacco_account_id: member.id,
        member_id: member.id,
        ledger_type: 'savings',
        direction: 'credit',
        amount,
        balance_after: balance,
        payment_id: pid,
        reference_type: 'savings',
        reference_id: savingsId,
        description: `${PERIOD_LABEL[period]} savings deposit`,
        transaction_date: ts(y, m, int(4, 24)),
        recorded_by: 6,
      });
      accountTotals[member.id].deposits = r2(accountTotals[member.id].deposits + amount);
      accountTotals[member.id].savings = balance;
    }
  }

  /* ---------------- shares ---------------- */
  const VALUE_PER_SHARE = 1000;
  for (const member of activeMembers) {
    const count = member.id % 3 === 0 ? 0 : pick([1, 2, 3, 5, 5, 8, 10, 15, 20]);
    if (!count) continue;
    const purchases = chance(0.4) ? 2 : 1;
    let remaining = count;
    for (let p = 0; p < purchases; p++) {
      const buy = p === purchases - 1 ? remaining : Math.max(1, Math.floor(remaining / 2));
      remaining -= buy;
      const amount = buy * VALUE_PER_SHARE;
      const d = ts(p === 0 ? 2025 : 2026, int(2, 11), int(3, 26));
      const { paymentId: pid } = addPayment({
        memberId: member.id,
        amount,
        date: d,
        method: chance(0.5) ? 'mpesa' : 'bank',
        category: 'Share capital purchase',
        allocations: [{ type: 'shares', referenceType: 'sacco_accounts', referenceId: member.id, amount }],
        recordedBy: 6,
        notes: `Purchase of ${buy} share(s)`,
      });
      shareId++;
      const cert = `CMA/SH/${String(shareId).padStart(5, '0')}`;
      shares.add({
        id: shareId,
        certificate_no: cert,
        sacco_account_id: member.id,
        member_id: member.id,
        shares_count: buy,
        value_per_share: VALUE_PER_SHARE,
        total_value: amount,
        issued_date: d.slice(0, 10),
        status: 'active',
        created_by: 6,
      });
      shareTxId++;
      shareTx.add({
        id: shareTxId,
        member_id: member.id,
        sacco_account_id: member.id,
        share_id: shareId,
        transaction_type: 'purchase',
        shares_count: buy,
        value_per_share: VALUE_PER_SHARE,
        amount,
        payment_id: pid,
        certificate_no: cert,
        transaction_date: d,
        notes: 'Share purchase',
        recorded_by: 6,
      });
      saccoTxId++;
      saccoTx.add({
        id: saccoTxId,
        sacco_account_id: member.id,
        member_id: member.id,
        ledger_type: 'shares',
        direction: 'credit',
        amount,
        balance_after: null,
        payment_id: pid,
        reference_type: 'shares',
        reference_id: shareId,
        description: `Purchase of ${buy} share(s) @ KSh 1,000 — ${cert}`,
        transaction_date: d,
        recorded_by: 6,
      });
      accountTotals[member.id].shares += buy;
      accountTotals[member.id].shareCapital = r2(accountTotals[member.id].shareCapital + amount);
    }
  }

  /* ---------------- welfare / funeral / wedding / projects ---------------- */
  const welfareCases = new Table('welfare_cases', [
    'id', 'case_no', 'member_id', 'beneficiary_name', 'beneficiary_relationship', 'category', 'nature_of_assistance',
    'hospital', 'ward', 'admission_date', 'target_amount', 'amount_per_member', 'opening_date', 'deadline',
    'amount_collected', 'amount_disbursed', 'disbursed_at', 'scope_type', 'parish_id', 'church_id', 'status', 'notes', 'created_by', 'created_at',
  ]);
  const funeralCases = new Table('funeral_cases', [
    'id', 'case_no', 'member_id', 'deceased_name', 'relationship', 'date_of_death', 'funeral_date', 'burial_place',
    'mortuary', 'amount_per_member', 'deadline', 'total_expected', 'amount_collected', 'amount_disbursed',
    'disbursed_at', 'scope_type', 'parish_id', 'status', 'notes', 'created_by', 'created_at',
  ]);
  const weddingCases = new Table('wedding_cases', [
    'id', 'case_no', 'member_id', 'spouse_name', 'wedding_date', 'venue', 'amount_per_member', 'target_amount',
    'deadline', 'amount_collected', 'amount_disbursed', 'disbursed_at', 'scope_type', 'parish_id', 'status', 'notes', 'created_by', 'created_at',
  ]);
  const projects = new Table('special_projects', [
    'id', 'project_no', 'name', 'category', 'description', 'target_amount', 'amount_per_member', 'start_date',
    'deadline', 'event_date', 'amount_collected', 'amount_disbursed', 'scope_type', 'parish_id', 'status', 'committee', 'notes', 'created_by', 'created_at',
  ]);
  const welfarePayments = new Table('welfare_payments', ['id', 'welfare_case_id', 'member_id', 'payment_id', 'amount', 'paid_at', 'recorded_by', 'created_at']);
  const funeralPayments = new Table('funeral_payments', ['id', 'funeral_case_id', 'member_id', 'payment_id', 'amount', 'paid_at', 'recorded_by', 'created_at']);
  const weddingPayments = new Table('wedding_payments', ['id', 'wedding_case_id', 'member_id', 'payment_id', 'amount', 'paid_at', 'recorded_by', 'created_at']);
  const projectContributions = new Table('project_contributions', [
    'id', 'project_id', 'member_id', 'payment_id', 'amount_pledged', 'amount_paid', 'status', 'paid_at', 'recorded_by', 'created_at',
  ]);

  const welfareData = [
    {
      id: 1, case_no: 'WEL/2026/0001', member: 9, category: 'hospitalisation', nature: 'Pneumonia complicated with pleural effusion — admitted for 9 days',
      hospital: 'Kenyatta National Hospital', ward: 'Male Medical Ward 4B', admission: date(2026, 6, 12), target: 60000, per: 300,
      opening: date(2026, 6, 13), deadline: date(2026, 7, 13), status: 'disbursed', disbursed: 52000, disbursedAt: ts(2026, 7, 15),
    },
    {
      id: 2, case_no: 'WEL/2026/0002', member: 21, category: 'surgery', nature: 'Elective orthopaedic surgery after a road accident',
      hospital: 'Mater Misericordiae Hospital', ward: 'Orthopaedic Ward', admission: date(2026, 8, 2), target: 120000, per: 500,
      opening: date(2026, 8, 3), deadline: date(2026, 9, 3), status: 'open', disbursed: 0, disbursedAt: null,
    },
    {
      id: 3, case_no: 'WEL/2026/0003', member: 34, category: 'sickness', nature: 'Malaria and typhoid — outpatient treatment and medication',
      hospital: 'Kamakis Catholic Hospital', ward: null, admission: date(2026, 8, 20), target: 25000, per: 200,
      opening: date(2026, 8, 21), deadline: date(2026, 9, 20), status: 'open', disbursed: 0, disbursedAt: null,
    },
  ];
  let welfareCollected: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  let wpId = 0;
  welfareData.forEach((c) => {
    const member = memberRows[c.member - 1];
    welfareCases.add({
      id: c.id, case_no: c.case_no, member_id: c.member, beneficiary_name: member.full_name, beneficiary_relationship: 'Member',
      category: c.category, nature_of_assistance: c.nature, hospital: c.hospital, ward: c.ward, admission_date: c.admission,
      target_amount: c.target, amount_per_member: c.per, opening_date: c.opening, deadline: c.deadline, amount_collected: 0,
      amount_disbursed: c.disbursed, disbursed_at: c.disbursedAt, scope_type: 'parish', parish_id: member.parish_id,
      church_id: member.church_id, status: c.status, notes: 'Visitation team assigned; prayers offered at the Sunday Mass.',
      created_by: 5, created_at: ts(2026, Number(c.opening.slice(5, 7)), Number(c.opening.slice(8, 10))),
    });
    allBilled.filter((m) => m.id !== c.member).forEach((m, idx) => {
      const willPay = c.status === 'disbursed' ? idx % 8 !== 0 : idx % 5 !== 0;
      if (!willPay) return;
      const d = ts(2026, Number(c.opening.slice(5, 7)), Math.min(28, Number(c.opening.slice(8, 10)) + 1 + (idx % 20)));
      const { paymentId: pid } = addPayment({
        memberId: m.id, amount: c.per, date: d, method: chance(0.6) ? 'mpesa' : 'cash',
        category: 'Sick member (welfare) contribution',
        allocations: [{ type: 'welfare', referenceType: 'welfare_cases', referenceId: c.id, amount: c.per }],
        recordedBy: 4, notes: `${c.case_no} welfare contribution`,
      });
      wpId++;
      welfarePayments.add({ id: wpId, welfare_case_id: c.id, member_id: m.id, payment_id: pid, amount: c.per, paid_at: d, recorded_by: 4, created_at: d });
      welfareCollected[c.id] = r2(welfareCollected[c.id] + c.per);
    });
  });

  const funeralData = [
    { id: 1, case_no: 'FUN/2026/0001', member: 12, deceased: 'Mama Teresia Wanjiru Kamau', relationship: 'spouse', dod: date(2026, 5, 4), funeral: date(2026, 5, 9), burial: 'Kiambu — family home', mortuary: 'Lee Funeral Home', per: 1000, deadline: date(2026, 5, 8), status: 'disbursed', disbursed: 46000 },
    { id: 2, case_no: 'FUN/2026/0002', member: 28, deceased: 'Mzee Patrick Odhiambo', relationship: 'parent', dod: date(2026, 8, 18), funeral: date(2026, 8, 24), burial: 'Kisumu — Nyando', mortuary: 'Nairobi Mortuary', per: 800, deadline: date(2026, 8, 23), status: 'open', disbursed: 0 },
  ];
  let funeralCollected: Record<number, number> = { 1: 0, 2: 0 };
  let fpId = 0;
  funeralData.forEach((c) => {
    const member = memberRows[c.member - 1];
    funeralCases.add({
      id: c.id, case_no: c.case_no, member_id: c.member, deceased_name: c.deceased, relationship: c.relationship,
      date_of_death: c.dod, funeral_date: c.funeral, burial_place: c.burial, mortuary: c.mortuary, amount_per_member: c.per,
      deadline: c.deadline, total_expected: r2(allBilled.length * c.per), amount_collected: 0, amount_disbursed: c.disbursed,
      disbursed_at: c.disbursed ? ts(2026, Number(c.funeral.slice(5, 7)), Number(c.funeral.slice(8, 10))) : null,
      scope_type: 'parish', parish_id: member.parish_id, status: c.status,
      notes: 'CMA delegation attended the funeral and a wreath was laid on behalf of the association.',
      created_by: 5, created_at: ts(2026, Number(c.dod.slice(5, 7)), Number(c.dod.slice(8, 10))),
    });
    allBilled.filter((m) => m.id !== c.member).forEach((m, idx) => {
      const willPay = c.status === 'disbursed' ? idx % 6 !== 0 : idx % 4 !== 0;
      if (!willPay) return;
      const d = ts(2026, Number(c.dod.slice(5, 7)), Math.min(28, Number(c.dod.slice(8, 10)) + 1 + (idx % 5)));
      const { paymentId: pid } = addPayment({
        memberId: m.id, amount: c.per, date: d, method: chance(0.5) ? 'mpesa' : 'cash',
        category: 'Funeral contribution',
        allocations: [{ type: 'funeral', referenceType: 'funeral_cases', referenceId: c.id, amount: c.per }],
        recordedBy: 4, notes: `${c.case_no} bereavement contribution`,
      });
      fpId++;
      funeralPayments.add({ id: fpId, funeral_case_id: c.id, member_id: m.id, payment_id: pid, amount: c.per, paid_at: d, recorded_by: 4, created_at: d });
      funeralCollected[c.id] = r2(funeralCollected[c.id] + c.per);
    });
  });

  const weddingData = [
    { id: 1, case_no: 'WED/2026/0001', member: 16, spouse: 'Grace Achieng', wedding: date(2026, 7, 18), venue: 'St. Monica Parish Church', per: 500, target: 30000, deadline: date(2026, 7, 15), status: 'disbursed', disbursed: 24000 },
    { id: 2, case_no: 'WED/2026/0002', member: 41, spouse: 'Mary Wambui', wedding: date(2026, 10, 10), venue: 'St. Joseph Njiru Outstation', per: 500, target: 30000, deadline: date(2026, 10, 5), status: 'open', disbursed: 0 },
  ];
  let weddingCollected: Record<number, number> = { 1: 0, 2: 0 };
  let wedpId = 0;
  weddingData.forEach((c) => {
    const member = memberRows[c.member - 1];
    weddingCases.add({
      id: c.id, case_no: c.case_no, member_id: c.member, spouse_name: c.spouse, wedding_date: c.wedding, venue: c.venue,
      amount_per_member: c.per, target_amount: c.target, deadline: c.deadline, amount_collected: 0, amount_disbursed: c.disbursed,
      disbursed_at: c.disbursed ? ts(2026, Number(c.wedding.slice(5, 7)), Number(c.wedding.slice(8, 10))) : null,
      scope_type: 'parish', parish_id: member.parish_id, church_id: member.church_id, status: c.status,
      notes: 'CMA choir and ushering team assigned for the wedding Mass.', created_by: 5,
      created_at: ts(2026, Number(c.wedding.slice(5, 7)) - 1, 12),
    });
    const payerPool = c.status === 'open' ? allBilled.slice(0, 30) : allBilled;
    payerPool.filter((m) => m.id !== c.member).forEach((m, idx) => {
      if (idx % 5 === 0) return;
      const base = new Date(c.wedding);
      const d = ts(base.getFullYear(), base.getMonth() + 1, Math.max(1, base.getDate() - 20 + (idx % 18)));
      const { paymentId: pid } = addPayment({
        memberId: m.id, amount: c.per, date: d, method: chance(0.55) ? 'mpesa' : 'cash',
        category: 'Wedding contribution',
        allocations: [{ type: 'wedding', referenceType: 'wedding_cases', referenceId: c.id, amount: c.per }],
        recordedBy: 4, notes: `${c.case_no} wedding support`,
      });
      wedpId++;
      weddingPayments.add({ id: wedpId, wedding_case_id: c.id, member_id: m.id, payment_id: pid, amount: c.per, paid_at: d, recorded_by: 4, created_at: d });
      weddingCollected[c.id] = r2(weddingCollected[c.id] + c.per);
    });
  });

  const projectData = [
    { id: 1, no: 'PRJ/2026/0001', name: 'CMA Annual Day & Fundraiser', category: 'annual_function', desc: 'Annual CMA day with a fundraiser for the association’s activities.', target: 250000, per: 1000, start: date(2026, 3, 1), deadline: date(2026, 5, 30), event: date(2026, 6, 14), status: 'completed', disbursed: 178000 },
    { id: 2, no: 'PRJ/2026/0002', name: 'Parish Church Hall Roofing', category: 'parish_project', desc: 'Contribution towards roofing of the new parish hall.', target: 500000, per: 2000, start: date(2026, 5, 1), deadline: date(2026, 10, 31), event: null, status: 'open', disbursed: 0 },
    { id: 3, no: 'PRJ/2026/0003', name: 'Diocesan Pilgrimage to Subukia', category: 'pilgrimage', desc: 'Men’s pilgrimage to the Subukia Marian Shrine.', target: 120000, per: 3000, start: date(2026, 7, 1), deadline: date(2026, 9, 15), event: date(2026, 9, 26), status: 'open', disbursed: 0 },
    { id: 4, no: 'PRJ/2025/0004', name: 'CMA Uniforms & Regalia', category: 'uniform', desc: 'Purchase of CMA uniforms, berets and badges for members.', target: 180000, per: 3500, start: date(2025, 9, 1), deadline: date(2025, 12, 20), event: null, status: 'completed', disbursed: 165000 },
  ];
  let projectCollected: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let pcId = 0;
  projectData.forEach((p) => {
    projects.add({
      id: p.id, project_no: p.no, name: p.name, category: p.category, description: p.desc, target_amount: p.target,
      amount_per_member: p.per, start_date: p.start, deadline: p.deadline, event_date: p.event, amount_collected: 0,
      amount_disbursed: p.disbursed, scope_type: 'parish', parish_id: 1, status: p.status,
      committee: 'Project committee chaired by the CMA Vice-Chairman', notes: null, created_by: 2,
      created_at: ts(Number(p.start.slice(0, 4)), Number(p.start.slice(5, 7)), Number(p.start.slice(8, 10))),
    });
    const pool = allBilled.filter((m) => m.parish_id === 1);
    pool.forEach((m, idx) => {
      const pledged = p.per;
      let paid = 0;
      if (p.status === 'completed') paid = idx % 7 === 0 ? r2(p.per * 0.5) : p.per;
      else paid = idx % 3 === 0 ? 0 : idx % 4 === 0 ? r2(p.per * 0.5) : p.per;
      let pid: number | null = null;
      let paidAt: string | null = null;
      if (paid > 0) {
        const startMonth = Number(p.start.slice(5, 7));
        const d = ts(Number(p.start.slice(0, 4)), Math.min(12, startMonth + (idx % 3)), int(3, 26));
        const res = addPayment({
          memberId: m.id, amount: paid, date: d, method: chance(0.5) ? 'mpesa' : 'cash',
          category: `Project — ${p.name}`,
          allocations: [{ type: 'project', referenceType: 'special_projects', referenceId: p.id, amount: paid }],
          recordedBy: 4, notes: p.name,
        });
        pid = res.paymentId;
        paidAt = d;
        projectCollected[p.id] = r2(projectCollected[p.id] + paid);
      }
      pcId++;
      projectContributions.add({
        id: pcId, project_id: p.id, member_id: m.id, payment_id: pid, amount_pledged: pledged, amount_paid: paid,
        status: paid >= pledged ? 'paid' : paid > 0 ? 'partial' : 'pending', paid_at: paidAt, recorded_by: 4,
        created_at: ts(Number(p.start.slice(0, 4)), Number(p.start.slice(5, 7)), 2),
      });
    });
  });

  /* ---------------- loans ---------------- */
  const applications = new Table('loan_applications', [
    'id', 'application_no', 'member_id', 'loan_type_id', 'amount_requested', 'purpose', 'repayment_months',
    'interest_rate', 'interest_method', 'monthly_repayment', 'total_interest', 'total_repayable', 'processing_fee',
    'savings_balance', 'shares_value', 'shares_count', 'outstanding_loans', 'eligibility_json', 'eligibility_passed',
    'status', 'applied_at', 'reviewed_by', 'reviewed_at', 'review_notes', 'approved_amount', 'approved_at', 'approved_by',
    'rejection_reason', 'disbursement_date', 'disbursement_method', 'disbursement_reference', 'loan_id', 'parish_id', 'created_by', 'updated_at',
  ]);
  const loans = new Table('loans', [
    'id', 'loan_no', 'application_id', 'member_id', 'loan_type_id', 'sacco_account_id', 'principal', 'interest_rate',
    'interest_method', 'term_months', 'processing_fee', 'monthly_repayment', 'total_interest', 'total_repayable',
    'amount_paid', 'principal_paid', 'interest_paid', 'penalties_charged', 'penalties_paid', 'outstanding_balance',
    'outstanding_principal', 'arrears', 'next_due_date', 'first_due_date', 'maturity_date', 'disbursed_at',
    'disbursed_amount', 'disbursement_method', 'disbursement_reference', 'completed_at', 'status', 'created_by', 'updated_at',
  ]);
  const schedules = new Table('loan_schedules', [
    'id', 'loan_id', 'member_id', 'installment_no', 'due_date', 'opening_balance', 'principal', 'interest', 'total_due',
    'amount_paid', 'balance_after', 'paid_at', 'status',
  ]);
  const repayments = new Table('loan_repayments', [
    'id', 'loan_id', 'member_id', 'payment_id', 'receipt_no', 'amount', 'principal_portion', 'interest_portion',
    'penalty_portion', 'balance_after', 'repayment_date', 'is_early', 'method', 'notes', 'recorded_by',
  ]);
  const guarantors = new Table('loan_guarantors', [
    'id', 'loan_application_id', 'loan_id', 'member_id', 'guarantor_member_id', 'amount_guaranteed', 'guarantor_share_pct',
    'status', 'requested_at', 'responded_at', 'response_notes', 'notified_at',
  ]);
  const penalties = new Table('penalties', [
    'id', 'member_id', 'penalty_type', 'reference_type', 'reference_id', 'period', 'amount', 'amount_paid', 'reason',
    'status', 'payment_id', 'created_by', 'created_at',
  ]);

  function amortise(principal: number, monthlyPct: number, months: number, method: string, firstDue: Date) {
    const r = monthlyPct / 100;
    const rows: any[] = [];
    let balance = principal;
    const payment =
      method === 'flat'
        ? (principal + principal * r * months) / months
        : r === 0
          ? principal / months
          : (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
    for (let i = 1; i <= months; i++) {
      const opening = r2(balance);
      let interest = 0;
      let principalPart = 0;
      if (method === 'flat') {
        interest = r2((principal * r * months) / months);
        principalPart = i === months ? opening : r2(principal / months);
      } else {
        interest = r2(opening * r);
        principalPart = i === months ? opening : r2(payment - interest);
        if (principalPart > opening) principalPart = opening;
      }
      balance = r2(opening - principalPart);
      const due = new Date(firstDue.getFullYear(), firstDue.getMonth() + (i - 1), firstDue.getDate());
      rows.push({
        installment_no: i,
        due_date: date(due.getFullYear(), due.getMonth() + 1, due.getDate()),
        opening_balance: opening,
        principal: principalPart,
        interest,
        total_due: r2(principalPart + interest),
        balance_after: balance,
      });
    }
    return rows;
  }

  const loanSeed = [
    { app: 1, no: 'LA/2026/0001', member: 6, type: 'SCH', amount: 80000, months: 10, purpose: 'School fees for two children (Term 3)', status: 'disbursed', applied: ts(2026, 6, 3), loanNo: 'LN/2026/0001', disbursed: ts(2026, 6, 18), guarantors: [7, 8], firstDue: new Date(2026, 6, 20) },
    { app: 2, no: 'LA/2026/0002', member: 11, type: 'DEV', amount: 350000, months: 36, purpose: 'Completion of a rental unit at Ruiru', status: 'disbursed', applied: ts(2026, 4, 12), loanNo: 'LN/2026/0002', disbursed: ts(2026, 5, 6), guarantors: [13, 14, 15], firstDue: new Date(2026, 5, 10) },
    { app: 3, no: 'LA/2026/0003', member: 19, type: 'EMG', amount: 30000, months: 5, purpose: 'Emergency medical bills for a dependant', status: 'disbursed', applied: ts(2026, 7, 8), loanNo: 'LN/2026/0003', disbursed: ts(2026, 7, 15), guarantors: [20], firstDue: new Date(2026, 7, 20) },
    { app: 4, no: 'LA/2025/0004', member: 24, type: 'BIZ', amount: 250000, months: 24, purpose: 'Stock for a hardware shop in Kamakis', status: 'disbursed', applied: ts(2025, 10, 2), loanNo: 'LN/2025/0004', disbursed: ts(2025, 11, 4), guarantors: [25, 26, 27], firstDue: new Date(2025, 11, 10) },
    { app: 5, no: 'LA/2025/0005', member: 31, type: 'AST', amount: 120000, months: 18, purpose: 'Purchase of a water tank and a motorised pump', status: 'disbursed', applied: ts(2025, 8, 14), loanNo: 'LN/2025/0005', disbursed: ts(2025, 9, 2), guarantors: [32, 33], firstDue: new Date(2025, 9, 10) },
    { app: 6, no: 'LA/2026/0006', member: 37, type: 'MED', amount: 60000, months: 12, purpose: 'Surgery for a chronic condition', status: 'committee_review', applied: ts(2026, 8, 22), loanNo: null, disbursed: null, guarantors: [38, 39], firstDue: null },
    { app: 7, no: 'LA/2026/0007', member: 43, type: 'SHT', amount: 25000, months: 3, purpose: 'Salary bridging — school requirements', status: 'guarantor_pending', applied: ts(2026, 8, 28), loanNo: null, disbursed: null, guarantors: [44], firstDue: null },
    { app: 8, no: 'LA/2026/0008', member: 47, type: 'DEV', amount: 600000, months: 48, purpose: 'Land purchase at Kangundo Road', status: 'rejected', applied: ts(2026, 7, 20), loanNo: null, disbursed: null, guarantors: [48, 49], firstDue: null, rejection: 'Requested amount exceeds three times the applicant’s savings; insufficient share capital.' },
  ];

  let loanId = 0;
  const appLoanMap: [number, number][] = [];
  let scheduleId = 0;
  let repaymentId = 0;
  let guarantorId = 0;
  let penaltyId = 0;

  for (const l of loanSeed) {
    const member = memberRows[l.member - 1];
    const lt = loanTypes.find((x) => x.code === l.type)!;
    const rate = num(lt.interest_rate);
    const method = lt.interest_method;
    const processingFee = r2((l.amount * num(lt.processing_fee_pct)) / 100 + 300);
    const plan = amortise(l.amount, rate, l.months, method, l.firstDue || new Date(2026, 8, 10));
    const totalInterest = r2(plan.reduce((a, x) => a + x.interest, 0));
    const monthly = r2(plan.reduce((a, x) => a + x.total_due, 0) / plan.length);
    const savingsBalance = accountTotals[member.id]?.savings || 0;
    const sharesValue = accountTotals[member.id]?.shareCapital || 0;

    let currentLoanId: number | null = null;
    if (l.loanNo) {
      loanId++;
      currentLoanId = loanId;
      appLoanMap.push([l.app, currentLoanId]);

      // repayments made so far
      let paidCount = 0;
      if (l.app === 4) paidCount = 9;
      else if (l.app === 5) paidCount = 11;
      else if (l.app === 1) paidCount = 2;
      else if (l.app === 2) paidCount = 3;
      else if (l.app === 3) paidCount = 1;

      let amountPaid = 0;
      let principalPaid = 0;
      let interestPaid = 0;
      for (let i = 0; i < paidCount; i++) {
        const row = plan[i];
        const due = new Date(row.due_date);
        const late = l.app === 4 && i >= 7;
        const payDate = new Date(due.getFullYear(), due.getMonth(), late ? due.getDate() + int(10, 25) : due.getDate() - int(0, 4));
        const res = addPayment({
          memberId: member.id,
          amount: row.total_due,
          date: ts(payDate.getFullYear(), payDate.getMonth() + 1, Math.min(28, payDate.getDate())),
          method: chance(0.6) ? 'mpesa' : 'cash',
          category: `Loan repayment ${l.loanNo}`,
          allocations: [{ type: 'loan', referenceType: 'loans', referenceId: currentLoanId, amount: row.total_due }],
          recordedBy: 6,
          notes: `Instalment ${row.installment_no} of ${l.months}`,
        });
        repaymentId++;
        amountPaid = r2(amountPaid + row.total_due);
        principalPaid = r2(principalPaid + row.principal);
        interestPaid = r2(interestPaid + row.interest);
        repayments.add({
          id: repaymentId,
          loan_id: currentLoanId,
          member_id: member.id,
          payment_id: res.paymentId,
          receipt_no: res.receiptNo,
          amount: row.total_due,
          principal_portion: row.principal,
          interest_portion: row.interest,
          penalty_portion: 0,
          balance_after: r2(l.amount + totalInterest - amountPaid),
          repayment_date: ts(payDate.getFullYear(), payDate.getMonth() + 1, Math.min(28, payDate.getDate())),
          is_early: false,
          method: 'mpesa',
          notes: `Instalment ${row.installment_no}`,
          recorded_by: 6,
        });
      }

      const outstanding = r2(l.amount + totalInterest - amountPaid);
      const arrears = l.app === 4 ? r2(plan.slice(paidCount, paidCount + 2).reduce((a, x) => a + x.total_due, 0)) : 0;
      const nextDue = plan[paidCount]?.due_date || null;

      loans.add({
        id: currentLoanId,
        loan_no: l.loanNo,
        application_id: l.app,
        member_id: member.id,
        loan_type_id: lt.id,
        sacco_account_id: member.id,
        principal: l.amount,
        interest_rate: rate,
        interest_method: method,
        term_months: l.months,
        processing_fee: processingFee,
        monthly_repayment: monthly,
        total_interest: totalInterest,
        total_repayable: r2(l.amount + totalInterest + processingFee),
        amount_paid: amountPaid,
        principal_paid: principalPaid,
        interest_paid: interestPaid,
        penalties_charged: arrears ? 500 : 0,
        penalties_paid: 0,
        outstanding_balance: outstanding,
        outstanding_principal: r2(l.amount - principalPaid),
        arrears,
        next_due_date: nextDue,
        first_due_date: plan[0].due_date,
        maturity_date: plan[plan.length - 1].due_date,
        disbursed_at: l.disbursed,
        disbursed_amount: l.amount,
        disbursement_method: 'bank',
        disbursement_reference: `RTGS-${int(100000, 999999)}`,
        completed_at: null,
        status: arrears > 0 ? 'defaulted' : 'active',
        created_by: 6,
        updated_at: ts(2026, 8, 28),
      });

      plan.forEach((row) => {
        scheduleId++;
        const idx = row.installment_no - 1;
        const paid = idx < paidCount;
        schedules.add({
          id: scheduleId,
          loan_id: currentLoanId,
          member_id: member.id,
          installment_no: row.installment_no,
          due_date: row.due_date,
          opening_balance: row.opening_balance,
          principal: row.principal,
          interest: row.interest,
          total_due: row.total_due,
          amount_paid: paid ? row.total_due : 0,
          balance_after: row.balance_after,
          paid_at: paid ? ts(Number(row.due_date.slice(0, 4)), Number(row.due_date.slice(5, 7)), Number(row.due_date.slice(8, 10))) : null,
          status: paid ? 'paid' : new Date(row.due_date) < new Date(2026, 8, 6) ? (arrears && idx < paidCount + 2 ? 'overdue' : 'overdue') : 'pending',
        });
      });

      saccoTxId++;
      saccoTx.add({
        id: saccoTxId, sacco_account_id: member.id, member_id: member.id, ledger_type: 'loan', direction: 'credit',
        amount: l.amount, balance_after: null, payment_id: null, reference_type: 'loans', reference_id: currentLoanId,
        description: `Loan ${l.loanNo} disbursed`, transaction_date: l.disbursed, recorded_by: 6,
      });

      if (arrears > 0) {
        penaltyId++;
        penalties.add({
          id: penaltyId, member_id: member.id, penalty_type: 'late_loan', reference_type: 'loans', reference_id: currentLoanId,
          period: '2026-08', amount: 500, amount_paid: 0, reason: `Late loan repayment penalty on ${l.loanNo}`,
          status: 'pending', payment_id: null, created_by: 6, created_at: ts(2026, 8, 5),
        });
      }
      if (processingFee > 0) {
        penaltyId++;
        penalties.add({
          id: penaltyId, member_id: member.id, penalty_type: 'other', reference_type: 'loans', reference_id: currentLoanId,
          period: l.disbursed!.slice(0, 7), amount: processingFee, amount_paid: 0,
          reason: `${l.type} loan processing fee`, status: 'pending', payment_id: null, created_by: 6, created_at: l.disbursed,
        });
      }
    }

    applications.add({
      id: l.app,
      application_no: l.no,
      member_id: member.id,
      loan_type_id: lt.id,
      amount_requested: l.amount,
      purpose: l.purpose,
      repayment_months: l.months,
      interest_rate: rate,
      interest_method: method,
      monthly_repayment: monthly,
      total_interest: totalInterest,
      total_repayable: r2(l.amount + totalInterest + processingFee),
      processing_fee: processingFee,
      savings_balance: savingsBalance,
      shares_value: sharesValue,
      shares_count: accountTotals[member.id]?.shares || 0,
      outstanding_loans: 0,
      eligibility_json: { checks: [{ key: 'seed', label: 'Seeded application', passed: true, detail: 'Demo data' }], passed: true },
      eligibility_passed: true,
      status: l.status,
      applied_at: l.applied,
      reviewed_by: ['committee_review', 'approved', 'disbursed', 'rejected'].includes(l.status) ? 7 : null,
      reviewed_at: ['committee_review', 'approved', 'disbursed', 'rejected'].includes(l.status) ? l.applied : null,
      review_notes: l.status === 'rejected' ? 'Committee declined the request.' : 'Documents verified and member is in good standing.',
      approved_amount: currentLoanId ? l.amount : null,
      approved_at: currentLoanId ? l.disbursed : null,
      approved_by: currentLoanId ? 7 : null,
      rejection_reason: l.rejection || null,
      disbursement_date: currentLoanId ? l.disbursed!.slice(0, 10) : null,
      disbursement_method: currentLoanId ? 'bank' : null,
      disbursement_reference: currentLoanId ? `RTGS-${int(100000, 999999)}` : null,
      loan_id: null,
      parish_id: member.parish_id,
      created_by: member.user_id || 6,
      updated_at: l.applied,
    });

    const share = r2(l.amount / l.guarantors.length);
    l.guarantors.forEach((gid, idx) => {
      guarantorId++;
      const accepted = ['disbursed', 'committee_review', 'rejected'].includes(l.status) || idx < l.guarantors.length - 1;
      guarantors.add({
        id: guarantorId,
        loan_application_id: l.app,
        loan_id: currentLoanId,
        member_id: member.id,
        guarantor_member_id: gid,
        amount_guaranteed: share,
        guarantor_share_pct: r2(100 / l.guarantors.length),
        status: accepted ? 'accepted' : l.status === 'rejected' ? 'released' : 'pending',
        requested_at: l.applied,
        responded_at: accepted ? l.applied : null,
        response_notes: accepted ? 'I confirm my capacity to guarantee this loan.' : null,
        notified_at: l.applied,
      });
    });
  }

  // Late monthly contribution penalties
  for (const row of memberContributions.rows.filter((r) => r.status === 'overdue')) {
    penaltyId++;
    penalties.add({
      id: penaltyId,
      member_id: row.member_id,
      penalty_type: 'late_contribution',
      reference_type: 'member_contributions',
      reference_id: row.id,
      period: row.period,
      amount: 50,
      amount_paid: 0,
      reason: `Late ${row.period_label} monthly contribution`,
      status: 'pending',
      payment_id: null,
      created_by: null,
      created_at: ts(Number(row.period.slice(0, 4)), Number(row.period.slice(5, 7)), 15),
    });
  }

  /* ---------------- meetings & attendance ---------------- */
  const meetings = new Table('meetings', [
    'id', 'title', 'meeting_type', 'meeting_date', 'start_time', 'end_time', 'venue', 'parish_id', 'church_id',
    'chairperson', 'secretary', 'agenda', 'attendance_open', 'status', 'recorded_by', 'created_at',
  ]);
  const attendance = new Table('attendance', [
    'id', 'meeting_id', 'member_id', 'status', 'check_in_time', 'method', 'remarks', 'recorded_by', 'created_at',
  ]);
  let meetingId = 0;
  let attendanceId = 0;
  for (let i = 11; i >= 0; i--) {
    const d = new Date(2026, 7 - i, 14);
    if (d > new Date(2026, 8, 6)) continue;
    meetingId++;
    const type = d.getMonth() % 3 === 0 ? 'general_assembly' : 'monthly';
    meetings.add({
      id: meetingId,
      title: `${type === 'general_assembly' ? 'General Assembly' : 'Monthly CMA Meeting'} — ${d.toLocaleString('en', { month: 'long' })} ${d.getFullYear()}`,
      meeting_type: type,
      meeting_date: date(d.getFullYear(), d.getMonth() + 1, d.getDate()),
      start_time: '10:00:00',
      end_time: '12:30:00',
      venue: type === 'general_assembly' ? 'Parish Pastoral Hall' : 'St. Monica Parish Church Hall',
      parish_id: 1,
      church_id: 1,
      chairperson: 'Mr. Patrick Otieno',
      secretary: 'Mr. Michael Kariuki',
      agenda: '1. Opening prayer\n2. Roll call\n3. Minutes of the previous meeting\n4. Financial report\n5. Welfare & bereavement matters\n6. SDP/Sacco report\n7. Projects\n8. AOB\n9. Closing prayer',
      attendance_open: false,
      status: 'completed',
      recorded_by: 5,
      created_at: ts(d.getFullYear(), d.getMonth() + 1, 5),
    });
    allBilled.filter((m) => m.parish_id === 1).forEach((m, idx) => {
      const roll = rnd();
      const status = roll > 0.22 ? (roll > 0.93 ? 'late' : 'present') : roll > 0.12 ? 'apology' : 'absent';
      attendanceId++;
      attendance.add({
        id: attendanceId,
        meeting_id: meetingId,
        member_id: m.id,
        status,
        check_in_time: ['present', 'late'].includes(status) ? ts(d.getFullYear(), d.getMonth() + 1, d.getDate(), status === 'late' ? 10 : 9, int(5, 55)) : null,
        method: idx % 3 === 0 ? 'qr' : 'manual',
        remarks: status === 'apology' ? 'Sent apologies — away on duty' : null,
        recorded_by: 5,
        created_at: ts(d.getFullYear(), d.getMonth() + 1, d.getDate()),
      });
    });
  }

  /* ---------------- notifications & notices ---------------- */
  const notifications = new Table('notifications', [
    'id', 'user_id', 'member_id', 'title', 'body', 'category', 'priority', 'channels', 'link', 'reference_type',
    'reference_id', 'read_at', 'created_at',
  ]);
  let notifId = 0;
  const addNotif = (n: Partial<Row> & { member_id?: number; title: string; body: string; category: string; created_at: string }) => {
    notifId++;
    const memberUser = memberUsers.find((u) => u.memberId === n.member_id);
    notifications.add({
      id: notifId,
      user_id: memberUser?.userId ?? null,
      member_id: n.member_id ?? null,
      title: n.title,
      body: n.body,
      category: n.category,
      priority: n.priority || 'normal',
      channels: n.channels || ['in_system'],
      link: n.link || null,
      reference_type: n.reference_type || null,
      reference_id: n.reference_id || null,
      read_at: n.read_at ?? (chance(0.5) ? ts(2026, 8, 20) : null),
      created_at: n.created_at,
    });
  };

  for (const m of allBilled.slice(0, 25)) {
    addNotif({
      member_id: m.id,
      title: 'September 2026 CMA contribution',
      body: `Your September 2026 monthly CMA contribution of KSh 200 is due on 10 September 2026. Use Pay Now to send it by M-Pesa.`,
      category: 'contribution',
      priority: 'normal',
      channels: ['in_system', 'sms'],
      link: '/contributions',
      created_at: ts(2026, 9, 1),
    });
  }
  for (const m of memberContributions.rows.filter((r) => r.status === 'overdue').slice(0, 20)) {
    addNotif({
      member_id: m.member_id,
      title: `Outstanding contribution — ${m.period_label}`,
      body: `Your ${m.period_label} contribution of KSh ${num(m.amount_due) - num(m.amount_paid)} is still outstanding. A penalty of KSh 50 applies.`,
      category: 'contribution',
      priority: 'high',
      channels: ['in_system', 'sms'],
      link: '/contributions',
      created_at: ts(2026, 8, 15),
    });
  }
  addNotif({ title: 'New welfare case: WEL/2026/0003', body: 'A member has been admitted at Kamakis Catholic Hospital. A contribution of KSh 200 per member is requested by 20 September 2026.', category: 'welfare', priority: 'high', channels: ['in_system', 'sms'], link: '/welfare/3', created_at: ts(2026, 8, 21), member_id: 2 });
  addNotif({ title: 'Funeral contribution: FUN/2026/0002', body: 'Condolences to a member on the loss of his father. KSh 800 per member is due before the funeral on 24 August 2026.', category: 'funeral', priority: 'urgent', channels: ['in_system', 'sms'], link: '/funerals/2', created_at: ts(2026, 8, 18), member_id: 3 });
  addNotif({ title: 'Loan application received', body: 'Your loan application LA/2026/0006 has been forwarded to the loan committee for review.', category: 'loan', priority: 'normal', channels: ['in_system'], link: '/loans', created_at: ts(2026, 8, 23), member_id: 37 });
  addNotif({ title: 'Guarantee request', body: 'You have been asked to guarantee a loan of KSh 12,500. Please accept or decline the request.', category: 'loan', priority: 'high', channels: ['in_system', 'sms'], link: '/loans/guarantor-requests', created_at: ts(2026, 8, 28), member_id: 44 });
  addNotif({ title: 'Sacco savings reminder', body: 'Your SDP/Sacco savings deposit for August 2026 has not been received. Minimum monthly savings is KSh 500.', category: 'sacco', priority: 'normal', channels: ['in_system', 'sms'], link: '/sacco/savings', created_at: ts(2026, 9, 2), member_id: 7 });
  addNotif({ title: 'Monthly CMA meeting', body: 'The September monthly CMA meeting will be held on 14 September 2026 at 10:00am in the Parish Hall.', category: 'meeting', priority: 'normal', channels: ['in_system'], link: '/attendance', created_at: ts(2026, 9, 3), member_id: 1 });

  const notices = new Table('notices', ['id', 'title', 'body', 'category', 'audience', 'parish_id', 'pinned', 'publish_from', 'published_by', 'status', 'created_at']);
  notices.add({ id: 1, title: 'CMA Annual Day — 14 June 2026', body: 'All members are invited to the CMA Annual Day and fundraiser. Contribution of KSh 1,000 per member applies.', category: 'event', audience: 'all', parish_id: 1, pinned: false, publish_from: ts(2026, 4, 20), published_by: 5, status: 'published', created_at: ts(2026, 4, 20) });
  notices.add({ id: 2, title: 'SDP/Sacco dividend declaration', body: 'The board has declared a dividend of KSh 120 per share for FY2025. Dividends will be credited to members’ savings accounts.', category: 'sacco', audience: 'all', parish_id: 1, pinned: true, publish_from: ts(2026, 3, 30), published_by: 6, status: 'published', created_at: ts(2026, 3, 30) });
  notices.add({ id: 3, title: 'Monthly contributions due by the 10th', body: 'Kindly remit your monthly CMA contribution of KSh 200 on or before the 10th of every month to avoid a KSh 50 penalty.', category: 'contribution', audience: 'all', parish_id: 1, pinned: true, publish_from: ts(2026, 1, 5), published_by: 4, status: 'published', created_at: ts(2026, 1, 5) });

  /* ---------------- M-Pesa (Daraja) records ---------------- */
  const mpesa = new Table('mpesa_transactions', [
    'id', 'member_id', 'payment_id', 'provider', 'transaction_type', 'checkout_request_id', 'merchant_request_id',
    'mpesa_receipt_no', 'phone_number', 'amount', 'account_reference', 'description', 'result_code', 'result_desc',
    'status', 'allocation_type', 'reference_type', 'reference_id', 'requested_by', 'created_at', 'updated_at',
  ]);
  mpesa.add({
    id: 1, member_id: 9, payment_id: null, provider: 'mpesa', transaction_type: 'stk_push',
    checkout_request_id: 'ws_CO_01092026000000001', merchant_request_id: 'ws_M_01092026000000001', mpesa_receipt_no: null,
    phone_number: memberRows[8].phone, amount: 200, account_reference: 'CMA200', description: 'September monthly contribution',
    result_code: null, result_desc: 'Awaiting customer PIN entry', status: 'pending', allocation_type: 'monthly_contribution',
    reference_type: null, reference_id: null, requested_by: 9, created_at: ts(2026, 9, 4, 9, 12), updated_at: ts(2026, 9, 4, 9, 12),
  });
  mpesa.add({
    id: 2, member_id: 14, payment_id: null, provider: 'mpesa', transaction_type: 'stk_push',
    checkout_request_id: 'ws_CO_02092026000000002', merchant_request_id: 'ws_M_02092026000000002', mpesa_receipt_no: null,
    phone_number: memberRows[13].phone, amount: 500, account_reference: 'SAVINGS', description: 'Sacco savings deposit',
    result_code: null, result_desc: 'Awaiting customer PIN entry', status: 'pending', allocation_type: 'savings',
    reference_type: null, reference_id: null, requested_by: 6, created_at: ts(2026, 9, 5, 14, 30), updated_at: ts(2026, 9, 5, 14, 30),
  });
  mpesa.rows.push(
    ...payments.rows.slice(0, 6).map((p, i) => ({
      id: 100 + i,
      member_id: p.member_id,
      payment_id: p.id,
      provider: 'mpesa',
      transaction_type: 'stk_push',
      checkout_request_id: `ws_CO_01082026000000${100 + i}`,
      merchant_request_id: `ws_M_01082026000000${100 + i}`,
      mpesa_receipt_no: p.transaction_id,
      phone_number: memberRows[p.member_id - 1].phone,
      amount: p.amount,
      account_reference: p.category === 'SDP / Sacco savings' ? 'SAVINGS' : 'CMA200',
      description: p.category,
      result_code: 0,
      result_desc: 'Accepted',
      status: 'success',
      allocation_type: allocations.rows.find((a) => a.payment_id === p.id)?.allocation_type || null,
      reference_type: 'payments',
      reference_id: p.id,
      requested_by: 4,
      created_at: p.payment_date,
      updated_at: p.payment_date,
    })),
  );

  /* ---------------- audit trail ---------------- */
  const auditLogs = new Table('audit_logs', [
    'id', 'user_id', 'user_name', 'action', 'entity_type', 'entity_id', 'entity_label', 'description', 'old_values',
    'new_values', 'ip_address', 'user_agent', 'severity', 'created_at',
  ]);
  let auditId = 0;
  const addAudit = (a: any) => {
    auditId++;
    auditLogs.add({ id: auditId, ...a });
  };
  addAudit({ user_id: 1, user_name: 'Eng. Peter Ndegwa', action: 'system.initialised', entity_type: 'system', entity_id: null, entity_label: 'CMA System', description: 'System initialised for St. Monica Parish, Kamakis', old_values: null, new_values: null, ip_address: '41.90.112.14', user_agent: 'Mozilla/5.0', severity: 'info', created_at: ts(2026, 1, 4, 8, 0) });
  addAudit({ user_id: 2, user_name: 'Mr. Joseph Kamau', action: 'member.created', entity_type: 'member', entity_id: 64, entity_label: 'CMA/STM/0064', description: 'Registered new CMA member', old_values: null, new_values: { membership_no: 'CMA/STM/0064' }, ip_address: '41.90.112.20', user_agent: 'Mozilla/5.0', severity: 'info', created_at: ts(2026, 2, 12, 11, 20) });
  addAudit({ user_id: 4, user_name: 'Mr. Charles Mwangi', action: 'payment.recorded', entity_type: 'payment', entity_id: 1, entity_label: 'CMA/202509/0001', description: 'Recorded monthly contribution payment', old_values: null, new_values: { amount: 200, method: 'mpesa' }, ip_address: '41.90.112.31', user_agent: 'Mozilla/5.0', severity: 'info', created_at: ts(2025, 9, 5, 15, 10) });
  addAudit({ user_id: 7, user_name: 'Mr. Francis Waweru', action: 'loan.status_approved', entity_type: 'loan_application', entity_id: 3, entity_label: 'LA/2026/0003', description: 'Loan committee approved KSh 30,000 emergency loan', old_values: { status: 'committee_review' }, new_values: { status: 'approved' }, ip_address: '41.90.112.44', user_agent: 'Mozilla/5.0', severity: 'warning', created_at: ts(2026, 7, 14, 16, 40) });
  addAudit({ user_id: 6, user_name: 'Mr. Vincent Ndungu', action: 'loan.disbursed', entity_type: 'loan', entity_id: 3, entity_label: 'LN/2026/0003', description: 'Disbursed KSh 30,000 to member', old_values: null, new_values: { principal: 30000 }, ip_address: '41.90.112.50', user_agent: 'Mozilla/5.0', severity: 'warning', created_at: ts(2026, 7, 15, 10, 5) });
  addAudit({ user_id: 5, user_name: 'Mr. Michael Kariuki', action: 'member.status_updated', entity_type: 'member', entity_id: 61, entity_label: 'CMA/STM/0061', description: 'Membership status changed to suspended', old_values: { membership_status: 'active' }, new_values: { membership_status: 'suspended' }, ip_address: '41.90.112.61', user_agent: 'Mozilla/5.0', severity: 'warning', created_at: ts(2026, 6, 20, 9, 30) });
  addAudit({ user_id: 8, user_name: 'Mr. Bernard Ochieng', action: 'report.exported', entity_type: 'report', entity_id: null, entity_label: 'Loan portfolio', description: 'Exported loan portfolio report to Excel', old_values: null, new_values: null, ip_address: '41.90.112.72', user_agent: 'Mozilla/5.0', severity: 'info', created_at: ts(2026, 8, 30, 14, 0) });

  /* ---------------- member documents (placeholder PDF files) ---------------- */
  console.log('[seed] generating member document files…');
  const memberDocs = new Table('member_documents', [
    'id', 'member_id', 'doc_type', 'title', 'file_name', 'file_url', 'mime_type',
    'size_bytes', 'checksum', 'verified', 'verified_by', 'uploaded_by', 'created_at',
  ]);
  const DOC_EXTRAS = [
    { type: 'membership_card', title: 'CMA membership card' },
    { type: 'photo', title: 'Passport photo' },
    { type: 'baptism_certificate', title: 'Baptism certificate' },
    { type: 'marriage_certificate', title: 'Marriage certificate' },
    { type: 'passport', title: 'Passport' },
    { type: 'payslip', title: 'Latest payslip' },
  ];
  let docId = 0;
  const docMembers = memberRows.filter((m) => m.membership_status === 'active').slice(0, 26);
  for (const m of docMembers) {
    const extras = DOC_EXTRAS.slice();
    const chosen: { type: string; title: string }[] = [{ type: 'national_id', title: 'National ID' }];
    const extraCount = Math.floor(rnd() * 3); // 0..2 extra documents
    for (let k = 0; k < extraCount && extras.length; k++) chosen.push(extras.splice(Math.floor(rnd() * extras.length), 1)[0]);
    for (const d of chosen) {
      docId++;
      const verified = rnd() < 0.6;
      const mm = 1 + Math.floor(rnd() * 8);
      const dd = 1 + Math.floor(rnd() * 27);
      const buf = makePdf(d.title, `${m.full_name} - ${m.membership_no}`);
      const folder = `members/${m.id}/${d.type}`;
      const stamp = `2026${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}`;
      const unique = `${stamp}-${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`;
      const fileName = `${d.type}.pdf`;
      const rel = `${folder}/${unique}-${fileName}`;
      const abs = path.join(UPLOAD_ROOT, rel);
      try {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, buf, { mode: 0o600 });
      } catch (err: any) {
        console.warn(`[seed] could not write ${rel}: ${err?.message}`);
      }
      memberDocs.add({
        id: docId,
        member_id: m.id,
        doc_type: d.type,
        title: d.title,
        file_name: fileName,
        file_url: `/api/files/${rel}`,
        mime_type: 'application/pdf',
        size_bytes: buf.length,
        checksum: crypto.createHash('sha256').update(buf).digest('hex'),
        verified,
        verified_by: verified ? (rnd() < 0.5 ? 2 : 5) : null,
        uploaded_by: rnd() < 0.7 ? 5 : 2,
        created_at: ts(2026, mm, dd, 9 + Math.floor(rnd() * 8), Math.floor(rnd() * 60)),
      });
    }
  }

  /* ---------------- write everything ---------------- */
  console.log('[seed] writing tables…');
  await client.query('BEGIN');
  try {
    for (const table of [
      dioceses, deaneries, parishes, churches, sccs, fys, members, users, accounts,
      memberContributions, payments, allocations, receipts, savings, shares, shareTx, saccoTx,
      welfareCases, welfarePayments, funeralCases, funeralPayments, weddingCases, weddingPayments,
      projects, projectContributions, applications, loans, schedules, repayments, guarantors, penalties,
      meetings, attendance, notifications, notices, mpesa, auditLogs, memberDocs,
    ]) {
      await flush(client, table);
    }

    // resolve the circular FK between loan_applications and loans
    for (const [appId, lId] of appLoanMap) {
      await client.query('UPDATE loan_applications SET loan_id = $2 WHERE id = $1', [appId, lId]);
    }

    // keep case totals consistent with the payments just written
    await client.query(`UPDATE welfare_cases SET amount_collected = COALESCE((SELECT SUM(amount) FROM welfare_payments WHERE welfare_case_id = welfare_cases.id),0)`);
    await client.query(`UPDATE funeral_cases SET amount_collected = COALESCE((SELECT SUM(amount) FROM funeral_payments WHERE funeral_case_id = funeral_cases.id),0)`);
    await client.query(`UPDATE wedding_cases SET amount_collected = COALESCE((SELECT SUM(amount) FROM wedding_payments WHERE wedding_case_id = wedding_cases.id),0)`);
    await client.query(`UPDATE special_projects SET amount_collected = COALESCE((SELECT SUM(amount_paid) FROM project_contributions WHERE project_id = special_projects.id),0)`);

    // sync sacco account balances with the ledgers
    await client.query(`UPDATE sacco_accounts sa SET
        savings_balance = COALESCE((SELECT running_balance FROM savings s WHERE s.sacco_account_id = sa.id ORDER BY id DESC LIMIT 1),0),
        total_deposits = COALESCE((SELECT SUM(amount) FROM savings s WHERE s.sacco_account_id = sa.id AND transaction_type='deposit'),0),
        shares_count = COALESCE((SELECT SUM(shares_count) FROM shares sh WHERE sh.sacco_account_id = sa.id AND sh.status='active'),0),
        share_capital = COALESCE((SELECT SUM(total_value) FROM shares sh WHERE sh.sacco_account_id = sa.id AND sh.status='active'),0),
        loan_outstanding = COALESCE((SELECT SUM(outstanding_balance) FROM loans l WHERE l.member_id = sa.member_id AND l.status IN ('active','defaulted')),0)`);

    // link members to their user accounts
    await client.query(`UPDATE members m SET user_id = u.id FROM users u WHERE u.member_id = m.id`);

    // reconcile payments
    await client.query(`UPDATE payments SET allocated_amount = COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id = payments.id),0), unallocated_amount = amount - COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id = payments.id),0)`);

    for (const t of [
      'dioceses', 'deaneries', 'parishes', 'churches', 'small_christian_communities', 'financial_years', 'members',
      'users', 'sacco_accounts', 'member_contributions', 'payments', 'payment_allocations', 'receipts', 'savings',
      'shares', 'share_transactions', 'sacco_transactions', 'welfare_cases', 'welfare_payments', 'funeral_cases',
      'funeral_payments', 'wedding_cases', 'wedding_payments', 'special_projects', 'project_contributions',
      'loan_applications', 'loans', 'loan_schedules', 'loan_repayments', 'loan_guarantors', 'penalties', 'meetings',
      'attendance', 'notifications', 'notices', 'mpesa_transactions', 'audit_logs', 'member_documents',
    ]) {
      await setval(client, t);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  const counts = await client.query(
    `SELECT (SELECT count(*) FROM members) AS members, (SELECT count(*) FROM users) AS users,
            (SELECT count(*) FROM payments) AS payments, (SELECT count(*) FROM receipts) AS receipts,
            (SELECT count(*) FROM savings) AS savings, (SELECT count(*) FROM shares) AS shares,
            (SELECT count(*) FROM loans) AS loans, (SELECT count(*) FROM attendance) AS attendance,
            (SELECT count(*) FROM member_documents) AS documents,
            (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='completed') AS total_collected`,
  );
  console.log('[seed] summary:', counts.rows[0]);
  console.log(`[seed] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('\n[seed] demo logins (password in brackets):');
  staff.forEach((s) => {
    const u = users.rows.find((x) => x.id === s.id)!;
    console.log(`  ${s.role.padEnd(14)} login: ${String(u.login_id).padEnd(13)} email: ${String(u.email).padEnd(26)} phone: ${u.phone}  [${s.pw}]`);
  });
  console.log(`  member         ${memberRows[5].phone} (CMA/STM/0006)  [Member@2026]`);
  console.log(`  member         ${memberRows[8].phone} (CMA/STM/0009)  [Member@2026]`);

  await client.end();
  void savingsBalances;
  void num;
}

function num(v: any): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

main().catch((e) => {
  console.error('[seed] FAILED:', e.message);
  if (e.position) console.error('[seed] near SQL position', e.position);
  process.exit(1);
});

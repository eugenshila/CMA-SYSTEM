import 'server-only';
import { one, query, execute } from '@/lib/db';
import { encryptField, blindIndex, hashPassword } from '@/lib/crypto';
import { normalisePhone } from '@/lib/money';
import { ensureSaccoAccount } from '@/lib/sacco';
import { logAudit, diffObjects } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { sqlDate, toDate } from '@/lib/dates';

export async function nextMembershipNumber(parishCode: string, prefix = 'CMA'): Promise<string> {
  const like = `${prefix}/${parishCode}/%`;
  const row = await one<{ c: number }>(
    `SELECT count(*)::int AS c FROM members WHERE membership_no LIKE $1`,
    [like],
  );
  const maxRow = await one<{ m: string }>(
    `SELECT max(membership_no) AS m FROM members WHERE membership_no LIKE $1`,
    [like],
  );
  const lastSeq = maxRow?.m ? parseInt(String(maxRow.m).split('/').pop() || '0', 10) : 0;
  const next = Math.max(row?.c ?? 0, lastSeq) + 1;
  return `${prefix}/${parishCode}/${String(next).padStart(4, '0')}`;
}

export interface MemberInput {
  membership_no?: string | null;
  salutation?: string | null;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  gender?: string;
  national_id?: string | null;
  document_type?: 'national_id' | 'passport';
  phone: string;
  alt_phone?: string | null;
  email?: string | null;
  date_of_birth?: string | null;
  marital_status?: string;
  occupation?: string | null;
  employer?: string | null;
  residential_area?: string | null;
  kra_pin?: string | null;
  parish_id: number;
  church_id?: number | null;
  scc_id?: number | null;
  date_joined: string;
  membership_status?: string;
  membership_type?: string;
  baptism_date?: string | null;
  next_of_kin?: string | null;
  next_of_kin_relation?: string | null;
  next_of_kin_phone?: string | null;
  emergency_contact?: string | null;
  emergency_contact_rel?: string | null;
  emergency_contact_phone?: string | null;
  exempt_monthly?: boolean;
  exemption_reason?: string | null;
  notes?: string | null;
}

export async function createMemberRecord(opts: {
  data: MemberInput;
  actor: { id: number | null; name: string };
  createLogin?: { password: string; ip?: string | null; userAgent?: string | null; roleKey?: string };
}) {
  const d = opts.data;
  const fullName = [d.first_name, d.middle_name, d.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const parish = await one<any>('SELECT * FROM parishes WHERE id = $1', [d.parish_id]);
  if (!parish) throw new Error('Select a valid parish.');

  const phone = normalisePhone(d.phone);
  if (!phone) throw new Error('Enter a valid mobile phone number.');

  const duplicate = await one<{ id: number; full_name: string }>(
    'SELECT id, full_name FROM members WHERE phone = $1 AND deleted_at IS NULL',
    [phone],
  );
  if (duplicate) throw new Error(`${duplicate.full_name} is already registered with this phone number.`);

  const membershipNo = (d.membership_no || '').trim() || (await nextMembershipNumber(parish.code));
  const noExists = await one<{ id: number }>('SELECT id FROM members WHERE membership_no = $1', [membershipNo]);
  if (noExists) throw new Error(`CMA number ${membershipNo} is already in use.`);

  if (d.email) {
    const emailDup = await one<{ id: number }>('SELECT id FROM members WHERE lower(email) = lower($1)', [d.email]);
    if (emailDup) throw new Error('Another member is already registered with this email address.');
  }

  const nationalId = d.national_id?.trim() || null;
  const isPassport = d.document_type === 'passport';

  const member = await one<any>(
    `INSERT INTO members
      (membership_no, salutation, full_name, first_name, middle_name, last_name, gender,
       national_id_enc, national_id_hash, national_id_last4, passport_enc, passport_hash,
       phone, alt_phone, email, date_of_birth, marital_status, occupation, employer, residential_area, kra_pin,
       parish_id, church_id, scc_id, date_joined, membership_status, membership_type, baptism_date,
       next_of_kin, next_of_kin_relation, next_of_kin_phone, emergency_contact, emergency_contact_rel,
       emergency_contact_phone, exempt_monthly, exemption_reason, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
             $29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
     RETURNING *`,
    [
      membershipNo,
      d.salutation || 'Mr.',
      fullName,
      d.first_name,
      d.middle_name || null,
      d.last_name,
      d.gender || 'male',
      isPassport ? null : encryptField(nationalId),
      isPassport ? null : blindIndex(nationalId),
      nationalId ? nationalId.slice(-4) : null,
      isPassport ? encryptField(nationalId) : null,
      isPassport ? blindIndex(nationalId) : null,
      phone,
      normalisePhone(d.alt_phone || '') || null,
      d.email || null,
      sqlDate(d.date_of_birth),
      d.marital_status || 'single',
      d.occupation || null,
      d.employer || null,
      d.residential_area || null,
      d.kra_pin || null,
      d.parish_id,
      d.church_id || null,
      d.scc_id || null,
      sqlDate(d.date_joined) || sqlDate(new Date()),
      d.membership_status || 'active',
      d.membership_type || 'full',
      sqlDate(d.baptism_date),
      d.next_of_kin || null,
      d.next_of_kin_relation || null,
      normalisePhone(d.next_of_kin_phone || '') || d.next_of_kin_phone || null,
      d.emergency_contact || null,
      d.emergency_contact_rel || null,
      normalisePhone(d.emergency_contact_phone || '') || d.emergency_contact_phone || null,
      Boolean(d.exempt_monthly),
      d.exempt_monthly ? d.exemption_reason || 'Exempted' : null,
      d.notes || null,
      opts.actor.id,
    ],
  );

  // every CMA member automatically receives an SDP / Sacco account
  await ensureSaccoAccount(member.id, { createdBy: opts.actor.id });

  if (opts.createLogin?.password) {
    const role = await one<{ id: number }>('SELECT id FROM roles WHERE key = $1', [opts.createLogin.roleKey || 'member']);
    const user = await one<any>(
      `INSERT INTO users (member_id, role_id, scope_parish_id, name, email, phone, login_id, password_hash, status, password_changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active', now()) RETURNING *`,
      [
        member.id,
        role!.id,
        member.parish_id,
        fullName,
        member.email,
        phone,
        membershipNo,
        await hashPassword(opts.createLogin.password),
      ],
    );
    await execute('UPDATE members SET user_id = $2 WHERE id = $1', [member.id, user.id]);
    member.user_id = user.id;
  }

  await logAudit({
    userId: opts.actor.id,
    userName: opts.actor.name,
    action: 'member.created',
    entityType: 'member',
    entityId: member.id,
    entityLabel: membershipNo,
    description: `Registered member ${fullName} (${membershipNo})`,
    newValues: {
      membership_no: membershipNo,
      full_name: fullName,
      parish: parish.name,
      status: member.membership_status,
    },
    ip: opts.createLogin?.ip,
    userAgent: opts.createLogin?.userAgent,
  });

  await notify({
    memberId: member.id,
    title: 'Welcome to the CMA family',
    body: `Your CMA membership number is ${membershipNo}. You can now view your contributions, savings, shares and loans online.`,
    category: 'membership',
    priority: 'high',
    channels: ['in_system', 'sms'],
    link: '/dashboard',
    referenceType: 'member',
    referenceId: member.id,
  });

  return { ...member, full_name: fullName, membership_no: membershipNo, parish_name: parish.name };
}

const EDITABLE = [
  'salutation', 'first_name', 'middle_name', 'last_name', 'gender', 'phone', 'alt_phone', 'email', 'date_of_birth',
  'marital_status', 'occupation', 'employer', 'residential_area', 'kra_pin', 'parish_id', 'church_id', 'scc_id',
  'date_joined', 'membership_status', 'membership_type', 'baptism_date', 'next_of_kin', 'next_of_kin_relation',
  'next_of_kin_phone', 'emergency_contact', 'emergency_contact_rel', 'emergency_contact_phone', 'notes',
  'exemption_reason',
] as const;

const DATE_FIELDS = new Set(['date_of_birth', 'date_joined', 'baptism_date']);

export async function updateMemberRecord(opts: {
  memberId: number;
  data: Record<string, any>;
  actor: { id: number | null; name: string };
  nationalId?: string | null;
  documentType?: 'national_id' | 'passport';
}) {
  const before = await one<any>('SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL', [opts.memberId]);
  if (!before) throw new Error('Member not found.');

  const sets: string[] = [];
  const params: any[] = [];
  const push = (column: string, value: any) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  for (const field of EDITABLE) {
    if (!(field in opts.data)) continue;
    let value = opts.data[field];
    if (DATE_FIELDS.has(field)) value = sqlDate(value);
    else if (['phone', 'alt_phone', 'next_of_kin_phone', 'emergency_contact_phone'].includes(field)) {
      value = normalisePhone(String(value || '')) || null;
    } else if (['parish_id', 'church_id', 'scc_id'].includes(field)) value = value ? Number(value) : null;
    else if (typeof value === 'string') value = value.trim() || null;
    push(field, value);
  }

  if (opts.data.full_name === undefined && (opts.data.first_name || opts.data.last_name)) {
    const fullName = [opts.data.first_name ?? before.first_name, opts.data.middle_name ?? before.middle_name, opts.data.last_name ?? before.last_name]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    push('full_name', fullName);
  }

  if (opts.data.exempt_monthly !== undefined) {
    const exempt = Boolean(opts.data.exempt_monthly);
    push('exempt_monthly', exempt);
    if (!exempt) push('exemption_reason', null);
  }

  if (opts.nationalId !== undefined && opts.nationalId !== null) {
    const id = String(opts.nationalId).trim();
    const isPassport = opts.documentType === 'passport';
    if (id) {
      const dup = await one<{ id: number }>(
        'SELECT id FROM members WHERE national_id_hash = $1 AND id <> $2',
        [blindIndex(id), opts.memberId],
      );
      if (dup) throw new Error('Another member is already registered with this ID/passport number.');
      push(isPassport ? 'passport_enc' : 'national_id_enc', encryptField(id));
      push(isPassport ? 'passport_hash' : 'national_id_hash', blindIndex(id));
      push('national_id_last4', id.slice(-4));
    }
  }

  if (!sets.length) return before;

  params.push(opts.memberId);
  const updated = await one<any>(
    `UPDATE members SET ${sets.join(', ')}, updated_by = $${params.length}, updated_at = now()
      WHERE id = $${params.length} RETURNING *`,
    params,
  );

  // keep the linked user account in sync
  if (updated.user_id) {
    await execute('UPDATE users SET name = $2, email = $3, phone = $4 WHERE id = $1', [
      updated.user_id,
      updated.full_name,
      updated.email,
      updated.phone,
    ]);
  }

  const { old, new: newValues, changed } = diffObjects(before, updated);
  if (changed.length) {
    await logAudit({
      userId: opts.actor.id,
      userName: opts.actor.name,
      action: 'member.updated',
      entityType: 'member',
      entityId: opts.memberId,
      entityLabel: updated.membership_no,
      description: `Updated member record (${changed.slice(0, 6).join(', ')}${changed.length > 6 ? '…' : ''})`,
      oldValues: old,
      newValues,
    });
  }

  if (before.membership_status !== updated.membership_status) {
    await notify({
      memberId: updated.id,
      title: 'CMA membership status updated',
      body: `Your CMA membership status is now "${updated.membership_status}". Contact the Secretary if this is an error.`,
      category: 'membership',
      priority: 'high',
      channels: ['in_system', 'sms'],
      link: '/my-profile',
      referenceType: 'member',
      referenceId: updated.id,
    });
  }

  return updated;
}

export async function memberById(id: number) {
  return one<any>(
    `SELECT m.*, p.name AS parish_name, c.name AS church_name, s.name AS scc_name, d.name AS diocese_name,
            dn.name AS deanery_name, u.email AS user_email, u.status AS user_status, r.name AS role_name
       FROM members m
       LEFT JOIN parishes p ON p.id = m.parish_id
       LEFT JOIN churches c ON c.id = m.church_id
       LEFT JOIN small_christian_communities s ON s.id = m.scc_id
       LEFT JOIN dioceses d ON d.id = p.diocese_id
       LEFT JOIN deaneries dn ON dn.id = p.deanery_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE m.id = $1`,
    [id],
  );
}

export async function memberDocuments(memberId: number) {
  return query<any>(
    `SELECT md.*, u.name AS uploaded_by_name
       FROM member_documents md LEFT JOIN users u ON u.id = md.uploaded_by
      WHERE md.member_id = $1 AND md.deleted_at IS NULL ORDER BY md.created_at DESC`,
    [memberId],
  );
}

'use server';

import { revalidatePath } from 'next/cache';
import { one, query, execute } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { notify, notifyMembers } from '@/lib/notify';
import { CASE_TABLES, CASE_LABELS, nextCaseNumber, membersInScope, caseProgress, type CaseType } from '@/lib/contributions';
import { num, round2 } from '@/lib/money';
import { sqlDate, isoDate } from '@/lib/dates';
import {
  welfareCaseSchema,
  funeralCaseSchema,
  weddingCaseSchema,
  projectSchema,
  firstError,
  formDataToObject,
} from '@/lib/validators';
import { storeFile, toBuffer } from '@/lib/files';
import type { ActionResult } from './auth';

const PERMISSION: Record<CaseType, string> = {
  welfare: 'welfare',
  funeral: 'funerals',
  wedding: 'weddings',
  project: 'projects',
};

const ROUTES: Record<CaseType, string> = {
  welfare: '/welfare',
  funeral: '/funerals',
  wedding: '/weddings',
  project: '/projects',
};

function revalidateCase(type: CaseType, id?: number) {
  revalidatePath(ROUTES[type]);
  if (id) revalidatePath(`${ROUTES[type]}/${id}`);
  revalidatePath('/dashboard');
  revalidatePath('/reports');
}

async function actor() {
  const user = await requireUser();
  return user;
}

/* ------------------------------------------------------------------ *
 * CREATE
 * ------------------------------------------------------------------ */
export async function createCaseAction(type: CaseType, _prev: any, formData: FormData): Promise<ActionResult> {
  const user = await actor();
  if (!can(user, `${PERMISSION[type]}.create`)) {
    return { ok: false, error: `You do not have permission to create ${CASE_LABELS[type].toLowerCase()} records.` };
  }

  const raw = formDataToObject(formData);
  const schema =
    type === 'welfare' ? welfareCaseSchema : type === 'funeral' ? funeralCaseSchema : type === 'wedding' ? weddingCaseSchema : projectSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed) || 'Please correct the highlighted fields.' };
  const data: any = parsed.data;

  const member = type === 'project' ? null : await one<any>('SELECT * FROM members WHERE id = $1', [data.member_id]);
  if (type !== 'project' && !member) return { ok: false, error: 'Select a valid CMA member.' };
  const parishId = member?.parish_id ?? user.scope_parish_id ?? (await one<any>('SELECT id FROM parishes ORDER BY id LIMIT 1'))?.id;

  const prefix = { welfare: 'WEL', funeral: 'FUN', wedding: 'WED', project: 'PRJ' }[type];
  const caseNo = await nextCaseNumber(type, prefix);
  const table = CASE_TABLES[type];
  const scopeMembers = await membersInScope({
    scope_type: data.scope_type,
    parish_id: parishId,
    church_id: data.church_id || member?.church_id || null,
    scc_id: data.scc_id || member?.scc_id || null,
  });
  const expected = round2(scopeMembers.length * num(data.amount_per_member));

  let id: number;
  if (type === 'welfare') {
    const row = await one<any>(
      `INSERT INTO welfare_cases
        (case_no, member_id, beneficiary_name, beneficiary_relationship, category, nature_of_assistance, hospital, ward,
         admission_date, target_amount, amount_per_member, opening_date, deadline, scope_type, parish_id, church_id, scc_id,
         status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'open',$18,$19) RETURNING *`,
      [
        caseNo, data.member_id, data.beneficiary_name || member.full_name, data.beneficiary_relationship || 'Member',
        data.category, data.nature_of_assistance, data.hospital || null, data.ward || null, sqlDate(data.admission_date),
        round2(num(data.target_amount) || expected), num(data.amount_per_member), sqlDate(data.opening_date), sqlDate(data.deadline),
        data.scope_type, parishId, data.church_id || member.church_id || null, data.scc_id || member.scc_id || null,
        data.notes || null, user.id,
      ],
    );
    id = row.id;
  } else if (type === 'funeral') {
    const row = await one<any>(
      `INSERT INTO funeral_cases
        (case_no, member_id, deceased_name, relationship, relationship_other, date_of_death, funeral_date, burial_place,
         mortuary, amount_per_member, deadline, total_expected, scope_type, parish_id, church_id, scc_id, status, notes,
         in_kind_support, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'open',$17,$18,$19) RETURNING *`,
      [
        caseNo, data.member_id, data.deceased_name, data.relationship, data.relationship_other || null,
        sqlDate(data.date_of_death), sqlDate(data.funeral_date), data.burial_place || null, data.mortuary || null,
        num(data.amount_per_member), sqlDate(data.deadline), expected, data.scope_type, parishId,
        member.church_id || null, member.scc_id || null, data.notes || null, data.in_kind_support || null, user.id,
      ],
    );
    id = row.id;
  } else if (type === 'wedding') {
    const row = await one<any>(
      `INSERT INTO wedding_cases
        (case_no, member_id, spouse_name, wedding_date, venue, amount_per_member, target_amount, deadline,
         scope_type, parish_id, church_id, scc_id, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open',$13,$14) RETURNING *`,
      [
        caseNo, data.member_id, data.spouse_name || null, sqlDate(data.wedding_date), data.venue || null,
        num(data.amount_per_member), round2(num(data.target_amount) || expected), sqlDate(data.deadline),
        data.scope_type, parishId, member.church_id || null, member.scc_id || null, data.notes || null, user.id,
      ],
    );
    id = row.id;
  } else {
    const row = await one<any>(
      `INSERT INTO special_projects
        (project_no, name, category, description, target_amount, amount_per_member, start_date, deadline, event_date,
         scope_type, parish_id, church_id, scc_id, status, committee, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',$14,$15,$16) RETURNING *`,
      [
        caseNo, data.name, data.category, data.description || null, round2(num(data.target_amount) || expected),
        num(data.amount_per_member), sqlDate(data.start_date), sqlDate(data.deadline), sqlDate(data.event_date),
        data.scope_type, parishId, data.church_id || null, data.scc_id || null, data.committee || null, data.notes || null, user.id,
      ],
    );
    id = row.id;
  }

  // supporting documents
  const files = formData.getAll('documents') as File[];
  for (const file of files) {
    if (!file || !(file as any).size) continue;
    try {
      const stored = await storeFile({
        buffer: await toBuffer(file),
        fileName: (file as any).name,
        mimeType: (file as any).type,
        folder: `${type}-cases/${id}`,
      });
      await execute(
        `INSERT INTO documents (entity_type, entity_id, doc_type, title, file_name, file_url, mime_type, size_bytes, uploaded_by)
         VALUES ($1,$2,'supporting',$3,$4,$5,$6,$7,$8)`,
        [`${type}_case`, id, (file as any).name, stored.file_name, stored.file_url, stored.mime_type, stored.size_bytes, user.id],
      );
    } catch (e: any) {
      console.error('[cases] document upload failed', e?.message);
    }
  }

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: `${type}.case_created`,
    entityType: table.cases,
    entityId: id,
    entityLabel: caseNo,
    description: `Created ${CASE_LABELS[type]} ${caseNo} — KSh ${num(data.amount_per_member).toLocaleString()} per member (${scopeMembers.length} members, expected KSh ${expected.toLocaleString()})`,
    newValues: { case_no: caseNo, per_member: data.amount_per_member, deadline: data.deadline },
  });

  // notify the members who are expected to contribute
  const targets = scopeMembers.filter((m) => m.id !== data.member_id).map((m) => m.id);
  const titles: Record<CaseType, string> = {
    welfare: `Sick member assistance — ${caseNo}`,
    funeral: `Funeral contribution — ${caseNo}`,
    wedding: `Wedding contribution — ${caseNo}`,
    project: `Special contribution — ${data.name || caseNo}`,
  };
  const bodies: Record<CaseType, string> = {
    welfare: `A CMA member has been hospitalised (${data.nature_of_assistance}). A contribution of KSh ${num(data.amount_per_member).toLocaleString()} per member is requested by ${data.deadline ? isoDate(data.deadline) : 'the stated deadline'}.`,
    funeral: `Condolences to a CMA member on the loss of ${data.deceased_name} (${data.relationship}). A contribution of KSh ${num(data.amount_per_member).toLocaleString()} per member is requested before ${data.funeral_date ? isoDate(data.funeral_date) : 'the funeral'}.`,
    wedding: `A CMA member is getting married on ${isoDate(data.wedding_date)}. A contribution of KSh ${num(data.amount_per_member).toLocaleString()} per member is requested by ${data.deadline ? isoDate(data.deadline) : 'the wedding date'}.`,
    project: `${data.name}: a contribution of KSh ${num(data.amount_per_member).toLocaleString()} per member is requested by ${data.deadline ? isoDate(data.deadline) : 'the stated deadline'}.`,
  };
  await notifyMembers(targets, {
    title: titles[type],
    body: bodies[type],
    category: type,
    priority: type === 'funeral' ? 'urgent' : 'high',
    channels: ['in_system', 'sms'],
    link: `${ROUTES[type]}/${id}`,
    referenceType: table.cases,
    referenceId: id,
  });

  revalidateCase(type, id);
  return { ok: true, message: `${CASE_LABELS[type]} ${caseNo} created and ${targets.length} member(s) notified.`, data: { id } };
}

/* ------------------------------------------------------------------ *
 * UPDATE / STATUS / DISBURSEMENT
 * ------------------------------------------------------------------ */
export async function setCaseStatusAction(type: CaseType, id: number, status: string): Promise<ActionResult> {
  const user = await actor();
  if (!can(user, `${PERMISSION[type]}.update`)) return { ok: false, error: 'You do not have permission to update this record.' };
  const table = CASE_TABLES[type];
  const before = await one<any>(`SELECT * FROM ${table.cases} WHERE id = $1`, [id]);
  if (!before) return { ok: false, error: 'Record not found.' };

  await execute(`UPDATE ${table.cases} SET status = $2, updated_by = $3 WHERE id = $1`, [id, status, user.id]);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: `${type}.status_updated`,
    entityType: table.cases,
    entityId: id,
    entityLabel: before.case_no || before.project_no,
    description: `${CASE_LABELS[type]} status changed from ${before.status} to ${status}`,
    oldValues: { status: before.status },
    newValues: { status },
  });
  revalidateCase(type, id);
  return { ok: true, message: `Status updated to ${status}.` };
}

export async function disburseCaseAction(
  type: CaseType,
  id: number,
  amount: number,
  reference?: string,
  notes?: string,
): Promise<ActionResult> {
  const user = await actor();
  if (!can(user, `${PERMISSION[type]}.approve`) && !can(user, 'payments.create')) {
    return { ok: false, error: 'You do not have permission to disburse funds.' };
  }
  const value = round2(num(amount));
  if (value <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };

  const table = CASE_TABLES[type];
  const record = await one<any>(`SELECT * FROM ${table.cases} WHERE id = $1`, [id]);
  if (!record) return { ok: false, error: 'Record not found.' };
  if (value > num(record.amount_collected) - num(record.amount_disbursed) + 0.01) {
    return {
      ok: false,
      error: `Only KSh ${round2(num(record.amount_collected) - num(record.amount_disbursed)).toLocaleString()} collected is available for disbursement.`,
    };
  }

  await execute(
    `UPDATE ${table.cases}
        SET amount_disbursed = amount_disbursed + $2,
            disbursed_at = now(),
            disbursement_reference = COALESCE($3, disbursement_reference),
            notes = COALESCE(notes,'') || COALESCE($4,''),
            status = $6,
            updated_by = $5
      WHERE id = $1`,
    [id, value, reference || null, notes ? ` | Disbursement note: ${notes}` : null, user.id, type === 'project' ? 'completed' : 'disbursed'],
  );

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: `${type}.disbursed`,
    entityType: table.cases,
    entityId: id,
    entityLabel: record.case_no || record.project_no,
    description: `Disbursed KSh ${value.toLocaleString()} from ${CASE_LABELS[type]} ${record.case_no || record.project_no}`,
    newValues: { amount, reference },
    severity: 'warning',
  });

  if (type !== 'project' && record.member_id) {
    await notify({
      memberId: record.member_id,
      title: `${CASE_LABELS[type]} funds disbursed`,
      body: `KSh ${value.toLocaleString()} has been disbursed to you from ${record.case_no || record.project_no}.${reference ? ` Reference: ${reference}` : ''}`,
      category: type,
      priority: 'high',
      channels: ['in_system', 'sms'],
      link: `${ROUTES[type]}/${id}`,
      referenceType: table.cases,
      referenceId: id,
    });
  }

  revalidateCase(type, id);
  return { ok: true, message: `KSh ${value.toLocaleString()} disbursed successfully.` };
}

export async function remindNonPayersAction(type: CaseType, id: number): Promise<ActionResult> {
  const user = await actor();
  if (!can(user, `${PERMISSION[type]}.view`) && !can(user, 'notifications.create')) {
    return { ok: false, error: 'You do not have permission to send reminders.' };
  }
  const progress = await caseProgress(type, id);
  const targets = progress.non_contributors.filter((m: any) => m.outstanding > 0).map((m: any) => m.id);
  if (!targets.length) return { ok: false, error: 'Every member in scope has already contributed.' };

  const label = progress.case.case_no || progress.case.project_no;
  const title = progress.case.name || CASE_LABELS[type];
  await notifyMembers(targets, {
    title: `Reminder — ${title} (${label})`,
    body: `You have an outstanding contribution of KSh ${num(progress.per_member).toLocaleString()} towards ${title}. Deadline: ${progress.case.deadline ? isoDate(progress.case.deadline) : 'as soon as possible'}.`,
    category: type,
    priority: 'high',
    channels: ['in_system', 'sms'],
    link: `${ROUTES[type]}/${id}`,
    referenceType: CASE_TABLES[type].cases,
    referenceId: id,
  });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: `${type}.reminders_sent`,
    entityType: CASE_TABLES[type].cases,
    entityId: id,
    entityLabel: label,
    description: `Sent reminders to ${targets.length} member(s) with outstanding contributions`,
  });
  revalidateCase(type, id);
  return { ok: true, message: `Reminders sent to ${targets.length} member(s).` };
}

/* ------------------------------------------------------------------ *
 * PROJECT CATEGORIES (unlimited, administrator managed)
 * ------------------------------------------------------------------ */
export async function createProjectCategoryAction(name: string, description?: string): Promise<ActionResult> {
  const user = await actor();
  if (!can(user, 'projects.create')) return { ok: false, error: 'You do not have permission to manage project categories.' };
  const clean = String(name || '').trim();
  if (clean.length < 3) return { ok: false, error: 'Category name must be at least 3 characters.' };
  const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  await execute(
    `INSERT INTO project_categories (key, name, description) VALUES ($1,$2,$3)
     ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, active = TRUE`,
    [key, clean, description || null],
  );
  await logAudit({ userId: user.id, userName: user.name, action: 'project_category.created', entityType: 'project_categories', entityLabel: clean, description: `Created project category "${clean}"` });
  revalidatePath('/projects');
  revalidatePath('/projects/new');
  return { ok: true, message: `Category "${clean}" added.` };
}

export async function deleteProjectCategoryAction(id: number): Promise<ActionResult> {
  const user = await actor();
  if (!can(user, 'projects.delete')) return { ok: false, error: 'You do not have permission to delete project categories.' };
  const inUse = await one<{ c: number }>('SELECT count(*)::int AS c FROM special_projects WHERE category = (SELECT key FROM project_categories WHERE id = $1)', [id]);
  if (num(inUse?.c) > 0) return { ok: false, error: 'This category is used by existing projects and cannot be removed. Deactivate it instead.' };
  await execute('UPDATE project_categories SET active = FALSE WHERE id = $1', [id]);
  await logAudit({ userId: user.id, userName: user.name, action: 'project_category.deactivated', entityType: 'project_categories', entityId: id, description: 'Project category deactivated' });
  revalidatePath('/projects');
  return { ok: true, message: 'Category deactivated.' };
}

export { query };

import 'server-only';
import type { PoolClient } from 'pg';
import { one, query, execute } from './db';
import { num, round2 } from './money';
import { dueDateFor, isoDate, periodKey, periodLabel, sqlDate, toDate } from './dates';
import { getContributionSettings } from './settings';
import { notify } from './notify';

export type ContributionStatus = 'paid' | 'partial' | 'unpaid' | 'overdue' | 'exempted';

/* ------------------------------------------------------------------ *
 * MONTHLY CONTRIBUTION BILLING
 * ------------------------------------------------------------------ */

export async function monthlyContributionType() {
  return one<any>(`SELECT * FROM contribution_types WHERE key = 'monthly_contribution' LIMIT 1`);
}

/** Member scope used by case based (welfare / funeral / wedding / project) collections. */
export async function membersInScope(scope: {
  scope_type?: string;
  parish_id?: number | null;
  church_id?: number | null;
  scc_id?: number | null;
}) {
  const clauses = [`m.deleted_at IS NULL`, `m.membership_status = 'active'`, `m.exempt_monthly = FALSE`];
  const params: any[] = [];
  if (scope.scope_type === 'church' && scope.church_id) {
    params.push(scope.church_id);
    clauses.push(`m.church_id = $${params.length}`);
  } else if (scope.scope_type === 'scc' && scope.scc_id) {
    params.push(scope.scc_id);
    clauses.push(`m.scc_id = $${params.length}`);
  } else if (scope.parish_id) {
    params.push(scope.parish_id);
    clauses.push(`m.parish_id = $${params.length}`);
  }
  return query<any>(
    `SELECT m.id, m.membership_no, m.full_name, m.phone FROM members m
      WHERE ${clauses.join(' AND ')} ORDER BY m.membership_no`,
    params,
  );
}

export function statusFor(row: {
  amount_due: any;
  amount_paid: any;
  due_date: any;
  exempted?: boolean;
}): ContributionStatus {
  if (row.exempted) return 'exempted';
  const due = num(row.amount_due);
  const paid = num(row.amount_paid);
  if (due <= 0) return 'paid';
  if (paid >= due - 0.005) return 'paid';
  if (paid > 0) return 'partial';
  return toDate(row.due_date) && toDate(row.due_date)! < new Date() ? 'overdue' : 'unpaid';
}

export async function getOrCreateContribution(opts: {
  memberId: number;
  typeId: number;
  period: string;
  amountDue?: number | null;
  dueDate?: Date | string | null;
  exempted?: boolean;
  client?: PoolClient;
}) {
  const client = opts.client;
  const settings = await getContributionSettings();
  const existing = await one<any>(
    `SELECT * FROM member_contributions WHERE member_id = $1 AND contribution_type_id = $2 AND period = $3`,
    [opts.memberId, opts.typeId, opts.period],
    client,
  );
  if (existing) return existing;

  const type = await one<any>('SELECT * FROM contribution_types WHERE id = $1', [opts.typeId], client);
  const amountDue = round2(
    num(opts.amountDue ?? type?.default_amount ?? settings.monthly_amount),
  );
  const dueDay = num(type?.due_day ?? settings.due_day) || 10;
  const member = await one<any>('SELECT exempt_monthly, exemption_reason FROM members WHERE id = $1', [opts.memberId], client);
  const exempted = Boolean(opts.exempted ?? member?.exempt_monthly);

  const fy = await one<{ id: number }>(
    `SELECT id FROM financial_years WHERE $1::date BETWEEN start_date AND end_date ORDER BY parish_id NULLS LAST LIMIT 1`,
    [sqlDate(dueDateFor(opts.period, dueDay))],
    client,
  );

  const created = await one<any>(
    `INSERT INTO member_contributions
       (member_id, contribution_type_id, financial_year_id, period, period_label, amount_due, due_date, status, exempted, exemption_reason, billed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (member_id, contribution_type_id, period) DO UPDATE SET amount_due = EXCLUDED.amount_due
     RETURNING *`,
    [
      opts.memberId,
      opts.typeId,
      fy?.id ?? null,
      opts.period,
      periodLabel(opts.period),
      amountDue,
      sqlDate(opts.dueDate ? toDate(opts.dueDate)! : dueDateFor(opts.period, dueDay)),
      exempted ? 'exempted' : 'unpaid',
      exempted,
      exempted ? member?.exemption_reason || 'Exempted' : null,
    ],
    client,
  );
  return created;
}

export async function recalcContribution(contributionId: number, client?: PoolClient) {
  const row = await one<any>('SELECT * FROM member_contributions WHERE id = $1', [contributionId], client);
  if (!row) return null;
  const settings = await getContributionSettings();
  const penalty =
    settings.penalty_enabled && statusFor(row) === 'overdue' && num(row.penalty) === 0
      ? round2(settings.penalty_amount)
      : num(row.penalty);

  const status = statusFor({ ...row, exempted: row.exempted });
  await execute(
    `UPDATE member_contributions SET status = $2, penalty = $3 WHERE id = $1`,
    [contributionId, status, penalty],
    client,
  );
  return { ...row, status, penalty };
}

export async function applyContributionPayment(opts: {
  memberId: number;
  typeId: number;
  period: string;
  amount: number;
  paymentId?: number | null;
  date?: Date | string | null;
  client?: PoolClient;
}) {
  const client = opts.client;
  const contribution = await getOrCreateContribution({
    memberId: opts.memberId,
    typeId: opts.typeId,
    period: opts.period,
    client,
  });
  await execute(
    `UPDATE member_contributions SET amount_paid = amount_paid + $2 WHERE id = $1`,
    [contribution.id, round2(num(opts.amount))],
    client,
  );
  return recalcContribution(contribution.id, client);
}

/** Generate the monthly bill for every member in scope. */
export async function billMonthlyContributions(opts: {
  period?: string;
  amount?: number | null;
  dueDay?: number | null;
  typeId?: number | null;
  parishId?: number | null;
  actor?: { id: number; name: string } | null;
  notifyMembers?: boolean;
}) {
  const settings = await getContributionSettings();
  const type = await one<any>('SELECT * FROM contribution_types WHERE id = $1', [
    opts.typeId ?? (await monthlyContributionType())!.id,
  ]);
  const period = opts.period || periodKey(new Date());
  const amount = round2(num(opts.amount ?? settings.monthly_amount));
  const dueDay = num(opts.dueDay ?? settings.due_day) || 10;
  const dueDate = dueDateFor(period, dueDay);

  const members = await query<any>(
    `SELECT id, full_name, membership_no, exempt_monthly, exemption_reason FROM members
      WHERE deleted_at IS NULL AND membership_status = 'active'
        ${opts.parishId ? 'AND parish_id = $1' : ''}
      ORDER BY membership_no`,
    opts.parishId ? [opts.parishId] : [],
  );

  let created = 0;
  let exempted = 0;
  for (const m of members) {
    const existing = await one<{ id: number }>(
      `SELECT id FROM member_contributions WHERE member_id = $1 AND contribution_type_id = $2 AND period = $3`,
      [m.id, type.id, period],
    );
    if (existing) continue;
    const isExempt = Boolean(m.exempt_monthly);
    await execute(
      `INSERT INTO member_contributions
         (member_id, contribution_type_id, period, period_label, amount_due, due_date, status, exempted, exemption_reason, billed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
      [
        m.id,
        type.id,
        period,
        periodLabel(period),
        isExempt ? 0 : amount,
        sqlDate(dueDate),
        isExempt ? 'exempted' : 'unpaid',
        isExempt,
        isExempt ? m.exemption_reason || 'Exempted by the CMA executive' : null,
      ],
    );
    if (isExempt) exempted++;
    else created++;
  }

  if (opts.notifyMembers !== false && created > 0) {
    const targets = await query<any>(
      `SELECT mc.member_id FROM member_contributions mc
        WHERE mc.period = $1 AND mc.contribution_type_id = $2 AND mc.exempted = FALSE`,
      [period, type.id],
    );
    for (const t of targets.slice(0, 500)) {
      await notify({
        memberId: t.member_id,
        title: `${periodLabel(period)} CMA contribution`,
        body: `Your ${periodLabel(period)} monthly CMA contribution of KSh ${amount.toLocaleString()} is due on ${isoDate(dueDate)}. Pay via M-Pesa Pay Now or at the CMA office.`,
        category: 'contribution',
        link: '/contributions',
        channels: ['in_system', 'sms'],
        referenceType: 'member_contribution_period',
        referenceId: null,
      });
    }
  }

  return { period, created, exempted, amount, due_date: isoDate(dueDate) };
}

/** Recompute statuses/penalties for a whole period (used by the nightly job & dashboard). */
export async function refreshContributionStatuses(period?: string) {
  const settings = await getContributionSettings();
  const params: any[] = [];
  let where = `mc.exempted = FALSE AND mc.amount_due > 0`;
  if (period) {
    params.push(period);
    where += ` AND mc.period = $1`;
  }
  const rows = await query<any>(
    `SELECT mc.* FROM member_contributions mc WHERE ${where}`,
    params,
  );
  let updated = 0;
  for (const row of rows) {
    const overdue = toDate(row.due_date)! < new Date();
    const paid = num(row.amount_paid);
    const due = num(row.amount_due);
    let status: ContributionStatus = 'unpaid';
    if (paid >= due - 0.005) status = 'paid';
    else if (paid > 0) status = overdue ? 'overdue' : 'partial';
    else if (overdue) status = 'overdue';

    let penalty = num(row.penalty);
    if (settings.penalty_enabled && status === 'overdue' && penalty === 0) {
      penalty = round2(settings.penalty_amount);
      // record the penalty once against the member
      const exists = await one<{ c: number }>(
        `SELECT count(*)::int AS c FROM penalties
          WHERE member_id = $1 AND penalty_type = 'late_contribution' AND reference_type = 'member_contributions' AND reference_id = $2`,
        [row.member_id, row.id],
      );
      if (!exists?.c) {
        await execute(
          `INSERT INTO penalties (member_id, penalty_type, reference_type, reference_id, period, amount, reason, status)
           VALUES ($1,'late_contribution','member_contributions',$2,$3,$4,$5,'pending')`,
          [row.member_id, row.id, row.period, penalty, `Late ${periodLabel(row.period)} monthly contribution`],
        );
      }
    }
    if (status !== row.status || penalty !== num(row.penalty)) {
      await execute(`UPDATE member_contributions SET status = $2, penalty = $3 WHERE id = $1`, [row.id, status, penalty]);
      updated++;
    }
  }
  return { scanned: rows.length, updated };
}

/* ------------------------------------------------------------------ *
 * CASE BASED COLLECTIONS (welfare / funeral / wedding / project)
 * ------------------------------------------------------------------ */
export type CaseType = 'welfare' | 'funeral' | 'wedding' | 'project';

export const CASE_TABLES: Record<CaseType, { cases: string; payments: string; noField: string }> = {
  welfare: { cases: 'welfare_cases', payments: 'welfare_payments', noField: 'case_no' },
  funeral: { cases: 'funeral_cases', payments: 'funeral_payments', noField: 'case_no' },
  wedding: { cases: 'wedding_cases', payments: 'wedding_payments', noField: 'case_no' },
  project: { cases: 'special_projects', payments: 'project_contributions', noField: 'project_no' },
};

export const CASE_LABELS: Record<CaseType, string> = {
  welfare: 'Sick member (welfare)',
  funeral: 'Funeral / bereavement',
  wedding: 'Wedding support',
  project: 'Special project',
};

export async function nextCaseNumber(type: CaseType, prefix: string) {
  const table = CASE_TABLES[type].cases;
  const field = CASE_TABLES[type].noField;
  const year = new Date().getFullYear();
  const row = await one<{ c: number }>(`SELECT count(*)::int AS c FROM ${table} WHERE ${field} LIKE $1`, [
    `${prefix}/${year}/%`,
  ]);
  return `${prefix}/${year}/${String((row?.c ?? 0) + 1).padStart(4, '0')}`;
}

export async function caseProgress(type: CaseType, caseId: number) {
  const info = CASE_TABLES[type];
  const theCase = await one<any>(`SELECT * FROM ${info.cases} WHERE id = $1`, [caseId]);
  if (!theCase) throw new Error('Case not found.');

  const scopeMembers = await membersInScope({
    scope_type: theCase.scope_type,
    parish_id: theCase.parish_id,
    church_id: theCase.church_id,
    scc_id: theCase.scc_id,
  });

  const perMember = num(
    type === 'project' ? theCase.amount_per_member : theCase.amount_per_member,
  );

  let paidRows: any[] = [];
  if (type === 'project') {
    paidRows = await query<any>(
      `SELECT pc.member_id, m.full_name, m.membership_no, m.phone,
              SUM(pc.amount_paid) AS paid, MAX(pc.paid_at) AS last_paid
         FROM project_contributions pc JOIN members m ON m.id = pc.member_id
        WHERE pc.project_id = $1
        GROUP BY pc.member_id, m.full_name, m.membership_no, m.phone`,
      [caseId],
    );
  } else {
    const caseField = `${type}_case_id`;
    paidRows = await query<any>(
      `SELECT p.member_id, m.full_name, m.membership_no, m.phone,
              SUM(p.amount) AS paid, MAX(p.paid_at) AS last_paid
         FROM ${info.payments} p JOIN members m ON m.id = p.member_id
        WHERE p.${caseField} = $1
        GROUP BY p.member_id, m.full_name, m.membership_no, m.phone`,
      [caseId],
    );
  }

  const paidMap = new Map<number, any>(paidRows.map((r) => [Number(r.member_id), r]));
  const contributors = scopeMembers
    .filter((m) => paidMap.has(m.id))
    .map((m) => ({ ...m, paid: num(paidMap.get(m.id).paid), last_paid: paidMap.get(m.id).last_paid }));
  const nonContributors = scopeMembers
    .filter((m) => !paidMap.has(m.id) || num(paidMap.get(m.id).paid) < perMember)
    .map((m) => ({
      ...m,
      paid: num(paidMap.get(m.id)?.paid ?? 0),
      outstanding: round2(Math.max(0, perMember - num(paidMap.get(m.id)?.paid ?? 0))),
    }));

  const collected = round2(paidRows.reduce((a, r) => a + num(r.paid), 0));
  const expected = round2(scopeMembers.length * perMember);

  return {
    case: theCase,
    scope_members: scopeMembers.length,
    per_member: perMember,
    expected,
    collected,
    outstanding: round2(Math.max(0, expected - collected)),
    disbursed: num(theCase.amount_disbursed),
    contributors,
    non_contributors: nonContributors,
    progress: expected ? Math.min(100, Math.round((collected / expected) * 100)) : 0,
  };
}

export async function refreshCaseTotals(type: CaseType, caseId: number, client?: PoolClient) {
  const info = CASE_TABLES[type];
  let collected = 0;
  if (type === 'project') {
    const row = await one<{ total: number }>(
      `SELECT COALESCE(SUM(amount_paid),0) AS total FROM project_contributions WHERE project_id = $1`,
      [caseId],
      client,
    );
    collected = num(row?.total);
  } else {
    const caseField = `${type}_case_id`;
    const row = await one<{ total: number }>(
      `SELECT COALESCE(SUM(amount),0) AS total FROM ${info.payments} WHERE ${caseField} = $1`,
      [caseId],
      client,
    );
    collected = num(row?.total);
  }
  await execute(`UPDATE ${info.cases} SET amount_collected = $2 WHERE id = $1`, [caseId, round2(collected)], client);
  return round2(collected);
}

/** Cases a specific member still owes money on. */
export async function memberCaseOutstanding(memberId: number) {
  const out: {
    type: CaseType;
    id: number;
    reference: string;
    title: string;
    expected: number;
    paid: number;
    outstanding: number;
    deadline: string | null;
  }[] = [];

  const welfare = await query<any>(
    `SELECT c.id, c.case_no, c.amount_per_member, c.deadline, c.status, m.full_name,
            COALESCE((SELECT SUM(p.amount) FROM welfare_payments p WHERE p.welfare_case_id = c.id AND p.member_id = $1),0) AS paid
       FROM welfare_cases c JOIN members m ON m.id = c.member_id
      WHERE c.status = 'open' AND m.id <> $1
        AND (c.parish_id = (SELECT parish_id FROM members WHERE id = $1) OR c.parish_id IS NULL)`,
    [memberId],
  );
  for (const c of welfare) {
    const outstanding = round2(num(c.amount_per_member) - num(c.paid));
    if (outstanding > 0)
      out.push({
        type: 'welfare',
        id: c.id,
        reference: c.case_no,
        title: `Welfare — ${c.full_name}`,
        expected: num(c.amount_per_member),
        paid: num(c.paid),
        outstanding,
        deadline: c.deadline ? isoDate(c.deadline) : null,
      });
  }

  const funerals = await query<any>(
    `SELECT c.id, c.case_no, c.amount_per_member, c.deadline, c.status, c.deceased_name, c.relationship,
            COALESCE((SELECT SUM(p.amount) FROM funeral_payments p WHERE p.funeral_case_id = c.id AND p.member_id = $1),0) AS paid
       FROM funeral_cases c
      WHERE c.status = 'open' AND c.member_id <> $1
        AND (c.parish_id = (SELECT parish_id FROM members WHERE id = $1) OR c.parish_id IS NULL)`,
    [memberId],
  );
  for (const c of funerals) {
    const outstanding = round2(num(c.amount_per_member) - num(c.paid));
    if (outstanding > 0)
      out.push({
        type: 'funeral',
        id: c.id,
        reference: c.case_no,
        title: `Funeral — ${c.deceased_name} (${c.relationship})`,
        expected: num(c.amount_per_member),
        paid: num(c.paid),
        outstanding,
        deadline: c.deadline ? isoDate(c.deadline) : null,
      });
  }

  const weddings = await query<any>(
    `SELECT c.id, c.case_no, c.amount_per_member, c.deadline, c.wedding_date, m.full_name,
            COALESCE((SELECT SUM(p.amount) FROM wedding_payments p WHERE p.wedding_case_id = c.id AND p.member_id = $1),0) AS paid
       FROM wedding_cases c JOIN members m ON m.id = c.member_id
      WHERE c.status = 'open' AND c.member_id <> $1
        AND (c.parish_id = (SELECT parish_id FROM members WHERE id = $1) OR c.parish_id IS NULL)`,
    [memberId],
  );
  for (const c of weddings) {
    const outstanding = round2(num(c.amount_per_member) - num(c.paid));
    if (outstanding > 0)
      out.push({
        type: 'wedding',
        id: c.id,
        reference: c.case_no,
        title: `Wedding — ${c.full_name}`,
        expected: num(c.amount_per_member),
        paid: num(c.paid),
        outstanding,
        deadline: c.deadline ? isoDate(c.deadline) : null,
      });
  }

  const projects = await query<any>(
    `SELECT p.id, p.project_no, p.name, p.amount_per_member, p.deadline,
            COALESCE((SELECT SUM(pc.amount_paid) FROM project_contributions pc WHERE pc.project_id = p.id AND pc.member_id = $1),0) AS paid
       FROM special_projects p
      WHERE p.status = 'open'
        AND (p.parish_id = (SELECT parish_id FROM members WHERE id = $1) OR p.parish_id IS NULL)`,
    [memberId],
  );
  for (const p of projects) {
    const outstanding = round2(num(p.amount_per_member) - num(p.paid));
    if (outstanding > 0)
      out.push({
        type: 'project',
        id: p.id,
        reference: p.project_no,
        title: `Project — ${p.name}`,
        expected: num(p.amount_per_member),
        paid: num(p.paid),
        outstanding,
        deadline: p.deadline ? isoDate(p.deadline) : null,
      });
  }

  return out;
}

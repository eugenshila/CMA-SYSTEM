'use server';

import { revalidatePath } from 'next/cache';
import { one, execute, query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { notify, notifyMembers } from '@/lib/notify';
import { billMonthlyContributions, refreshContributionStatuses, monthlyContributionType } from '@/lib/contributions';
import { getContributionSettings, setSetting } from '@/lib/settings';
import { num, round2 } from '@/lib/money';
import { periodKey, periodLabel, sqlDate } from '@/lib/dates';
import type { ActionResult } from './auth';

function revalidateContributions() {
  revalidatePath('/contributions');
  revalidatePath('/dashboard');
  revalidatePath('/reports/contributions');
  revalidatePath('/members');
}

export async function saveContributionSettingsAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'contributions.manage') && !can(user, 'settings.update')) {
    return { ok: false, error: 'You do not have permission to change contribution settings.' };
  }
  const before = await getContributionSettings();
  const monthlyAmount = round2(num(formData.get('monthly_amount')));
  const dueDay = Math.min(28, Math.max(1, Math.floor(num(formData.get('due_day')) || 10)));
  const penaltyAmount = round2(num(formData.get('penalty_amount')));

  if (monthlyAmount <= 0) return { ok: false, error: 'Monthly contribution amount must be greater than zero.' };

  const next = {
    ...before,
    monthly_amount: monthlyAmount,
    due_day: dueDay,
    penalty_enabled: formData.get('penalty_enabled') === 'on',
    penalty_amount: penaltyAmount,
    penalty_after_days: Math.max(0, Math.floor(num(formData.get('penalty_after_days')) || 7)),
    auto_bill: formData.get('auto_bill') === 'on',
    financial_year_start_month: Math.min(12, Math.max(1, Math.floor(num(formData.get('financial_year_start_month')) || 1))),
    sacco_min_monthly_savings: round2(num(formData.get('sacco_min_monthly_savings')) || before.sacco_min_monthly_savings),
  };
  await setSetting('contributions', next, { updatedBy: user.id, groupName: 'finance' });

  const type = await monthlyContributionType();
  if (type) {
    await execute('UPDATE contribution_types SET default_amount = $2, penalty_amount = $3, due_day = $4 WHERE id = $1', [
      type.id,
      monthlyAmount,
      penaltyAmount,
      dueDay,
    ]);
  }

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'settings.updated',
    entityType: 'system_settings',
    entityLabel: 'contributions',
    description: `Monthly contribution settings updated: KSh ${monthlyAmount.toLocaleString()} due on day ${dueDay}, penalty KSh ${penaltyAmount.toLocaleString()}`,
    oldValues: before,
    newValues: next,
    severity: 'warning',
  });

  revalidateContributions();
  revalidatePath('/admin/settings');
  return { ok: true, message: 'Contribution settings saved.' };
}

export async function billPeriodAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'contributions.create') && !can(user, 'contributions.manage')) {
    return { ok: false, error: 'You do not have permission to generate contribution bills.' };
  }
  const period = String(formData.get('period') || periodKey(new Date()));
  const amount = formData.get('amount') ? round2(num(formData.get('amount'))) : null;
  const dueDay = formData.get('due_day') ? Math.floor(num(formData.get('due_day'))) : null;
  const parishId = formData.get('parish_id') ? Number(formData.get('parish_id')) : null;
  const sendNotifications = formData.get('notify') === 'on';

  try {
    const result = await billMonthlyContributions({
      period,
      amount,
      dueDay,
      parishId,
      actor: { id: user.id, name: user.name },
      notifyMembers: sendNotifications,
    });
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'contributions.billed',
      entityType: 'member_contributions',
      description: `Generated ${periodLabel(period)} bills for ${result.created} member(s) at KSh ${result.amount.toLocaleString()} (due ${result.due_date})`,
      newValues: result,
    });
    revalidateContributions();
    return {
      ok: true,
      message: `${result.created} bill(s) created for ${periodLabel(period)} (${result.exempted} member(s) exempted).`,
      data: result,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not generate the contribution bills.' };
  }
}

export async function billYearAction(year: number, notifyMembersFlag = false): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'contributions.manage')) return { ok: false, error: 'You do not have permission to generate annual bills.' };
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const period = `${year}-${String(m).padStart(2, '0')}`;
    const result = await billMonthlyContributions({ period, actor: { id: user.id, name: user.name }, notifyMembers: notifyMembersFlag });
    total += result.created;
  }
  await execute(
    `INSERT INTO financial_years (name, start_date, end_date, is_current)
     VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`,
    [
      `FY ${year}`,
      sqlDate(new Date(year, 0, 1)),
      sqlDate(new Date(year, 11, 31)),
      year === new Date().getFullYear(),
    ],
  );
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'contributions.billed_year',
    entityType: 'financial_years',
    entityLabel: `FY ${year}`,
    description: `Generated ${total} monthly contribution bills for FY ${year}`,
    severity: 'warning',
  });
  revalidateContributions();
  return { ok: true, message: `FY ${year} billed: ${total} contribution record(s) created.` };
}

export async function setExemptionAction(memberId: number, exempt: boolean, reason?: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'contributions.update') && !can(user, 'members.update')) {
    return { ok: false, error: 'You do not have permission to grant exemptions.' };
  }
  const member = await one<any>('SELECT * FROM members WHERE id = $1', [memberId]);
  if (!member) return { ok: false, error: 'Member not found.' };
  if (exempt && (!reason || reason.trim().length < 3)) return { ok: false, error: 'Provide a reason for the exemption.' };

  await execute('UPDATE members SET exempt_monthly = $2, exemption_reason = $3 WHERE id = $1', [
    memberId,
    exempt,
    exempt ? reason!.trim() : null,
  ]);
  await execute(
    `UPDATE member_contributions
        SET exempted = $2, exemption_reason = $3,
            status = CASE WHEN $2 THEN 'exempted' WHEN amount_paid >= amount_due THEN 'paid' ELSE status END,
            amount_due = CASE WHEN $2 THEN 0 ELSE amount_due END
      WHERE member_id = $1 AND status <> 'paid'`,
    [memberId, exempt, exempt ? reason!.trim() : null],
  );
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: exempt ? 'contribution.exempted' : 'contribution.exemption_removed',
    entityType: 'member',
    entityId: memberId,
    entityLabel: member.membership_no,
    description: `${exempt ? 'Exempted' : 'Removed exemption for'} ${member.full_name}${reason ? ` — ${reason}` : ''}`,
    oldValues: { exempt_monthly: member.exempt_monthly },
    newValues: { exempt_monthly: exempt, reason },
    severity: 'warning',
  });
  await notify({
    memberId,
    title: exempt ? 'Monthly contribution exemption granted' : 'Monthly contribution exemption removed',
    body: exempt
      ? `You have been exempted from the monthly CMA contribution. Reason: ${reason}`
      : 'Your monthly CMA contribution exemption has been removed. Normal contributions now apply.',
    category: 'contribution',
    priority: 'high',
    channels: ['in_system', 'sms'],
    link: '/contributions',
  });
  revalidateContributions();
  revalidatePath(`/members/${memberId}`);
  return { ok: true, message: exempt ? 'Member exempted from monthly contributions.' : 'Exemption removed.' };
}

export async function updateContributionAction(
  contributionId: number,
  patch: { amount_due?: number; due_date?: string; exempted?: boolean; reason?: string },
): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'contributions.update')) return { ok: false, error: 'You do not have permission to edit contributions.' };
  const before = await one<any>('SELECT * FROM member_contributions WHERE id = $1', [contributionId]);
  if (!before) return { ok: false, error: 'Contribution record not found.' };

  const sets: string[] = [];
  const params: any[] = [];
  if (patch.amount_due !== undefined) {
    params.push(round2(num(patch.amount_due)));
    sets.push(`amount_due = $${params.length}`);
  }
  if (patch.due_date) {
    params.push(sqlDate(patch.due_date));
    sets.push(`due_date = $${params.length}`);
  }
  if (patch.exempted !== undefined) {
    params.push(Boolean(patch.exempted));
    sets.push(`exempted = $${params.length}`);
    sets.push(`status = CASE WHEN $${params.length} THEN 'exempted' ELSE status END`);
    params.push(patch.reason || null);
    sets.push(`exemption_reason = $${params.length}`);
  }
  if (!sets.length) return { ok: false, error: 'Nothing to update.' };

  params.push(contributionId);
  await execute(`UPDATE member_contributions SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  const after = await one<any>('SELECT * FROM member_contributions WHERE id = $1', [contributionId]);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'contribution.updated',
    entityType: 'member_contributions',
    entityId: contributionId,
    entityLabel: `${before.period}`,
    description: `Adjusted contribution bill for period ${before.period_label || before.period}`,
    oldValues: before,
    newValues: after,
    severity: 'warning',
  });
  revalidateContributions();
  return { ok: true, message: 'Contribution record updated.' };
}

export async function refreshContributionStatusesAction(): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'contributions.update') && !can(user, 'contributions.manage')) {
    return { ok: false, error: 'You do not have permission to refresh contribution statuses.' };
  }
  const result = await refreshContributionStatuses();
  await logAudit({ userId: user.id, userName: user.name, action: 'contributions.refreshed', entityType: 'member_contributions', description: `Recalculated ${result.scanned} contribution record(s), ${result.updated} updated` });
  revalidateContributions();
  return { ok: true, message: `${result.updated} of ${result.scanned} contribution record(s) updated.` };
}

export async function remindUnpaidMembersAction(period: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'notifications.create') && !can(user, 'contributions.update')) {
    return { ok: false, error: 'You do not have permission to send reminders.' };
  }
  const rows = await query<any>(
    `SELECT member_id, amount_due - amount_paid AS outstanding FROM member_contributions
      WHERE period = $1 AND status IN ('unpaid','partial','overdue')`,
    [period],
  );
  const amount = (await getContributionSettings()).monthly_amount;
  const sent = await notifyMembers(rows.map((r) => r.member_id), {
    title: `Reminder — ${periodLabel(period)} CMA contribution`,
    body: `Your ${periodLabel(period)} contribution of KSh ${amount.toLocaleString()} is still outstanding. Please pay via M-Pesa Pay Now or at the CMA office to avoid a penalty.`,
    category: 'contribution',
    priority: 'high',
    channels: ['in_system', 'sms'],
    link: '/contributions',
  });
  await logAudit({ userId: user.id, userName: user.name, action: 'contributions.reminders_sent', entityType: 'member_contributions', description: `Sent ${sent} reminder(s) for ${periodLabel(period)}` });
  revalidateContributions();
  return { ok: true, message: `Reminders sent to ${sent} member(s).` };
}


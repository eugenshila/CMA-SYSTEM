'use server';

import { revalidatePath } from 'next/cache';
import { one, query, execute } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import {
  createLoanApplication,
  setGuarantors,
  respondToGuarantee,
  updateApplicationStatus,
  disburseLoan,
  checkLoanEligibility,
  guarantorExposure,
  computeRepayment,
  refreshLoanStatuses,
  chargeLoanPenalties,
  LOAN_WORKFLOW,
} from '@/lib/loans';
import { recordPayment } from '@/lib/payments';
import { num, round2 } from '@/lib/money';
import { sqlDate } from '@/lib/dates';
import { loanApplicationSchema, loanTypeSchema, firstError, formDataToObject } from '@/lib/validators';
import { storeFile, toBuffer } from '@/lib/files';
import type { ActionResult } from './auth';

function revalidateLoans(memberId?: number, applicationId?: number) {
  revalidatePath('/loans');
  revalidatePath('/loans/approvals');
  revalidatePath('/loans/guarantor-requests');
  revalidatePath('/dashboard');
  revalidatePath('/reports');
  if (memberId) {
    revalidatePath(`/members/${memberId}`);
    revalidatePath('/statements');
  }
  if (applicationId) revalidatePath(`/loans/applications/${applicationId}`);
}

/* ------------------------------------------------------------------ *
 * APPLICATION
 * ------------------------------------------------------------------ */
export async function applyLoanAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const raw = formDataToObject(formData);
  const onBehalf = user.member_id !== Number(raw.member_id);
  if (onBehalf && !can(user, 'loans.create')) {
    return { ok: false, error: 'You may only apply for a loan on your own behalf.' };
  }
  if (!onBehalf && !can(user, 'loans.apply') && !can(user, 'loans.create')) {
    return { ok: false, error: 'You do not have permission to apply for a loan.' };
  }

  const parsed = loanApplicationSchema.safeParse({
    ...raw,
    guarantors: (formData.getAll('guarantors') as string[]).map((g) => Number(g)).filter(Boolean),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed) || 'Please correct the application details.' };
  const data = parsed.data;

  try {
    const eligibility = await checkLoanEligibility({
      memberId: data.member_id,
      loanTypeId: data.loan_type_id,
      amount: data.amount,
      months: data.months,
    });
    if (!eligibility.passed) {
      const failed = eligibility.checks.filter((c) => !c.passed).map((c) => `${c.label} (${c.detail})`);
      return { ok: false, error: `You do not qualify for this loan: ${failed.join('; ')}` };
    }

    const result = await createLoanApplication({
      memberId: data.member_id,
      loanTypeId: data.loan_type_id,
      amount: data.amount,
      months: data.months,
      purpose: data.purpose,
      guarantors: data.guarantors,
      actor: { id: user.id, name: user.name },
      parishId: user.scope_parish_id,
    });

    const files = formData.getAll('documents') as File[];
    for (const file of files) {
      if (!file || !(file as any).size) continue;
      try {
        const stored = await storeFile({
          buffer: await toBuffer(file),
          fileName: (file as any).name,
          mimeType: (file as any).type,
          folder: `loan-applications/${result.application.id}`,
        });
        await execute(
          `INSERT INTO documents (entity_type, entity_id, doc_type, title, file_name, file_url, mime_type, size_bytes, uploaded_by)
           VALUES ('loan_application',$1,'supporting',$2,$3,$4,$5,$6,$7)`,
          [result.application.id, (file as any).name, stored.file_name, stored.file_url, stored.mime_type, stored.size_bytes, user.id],
        );
      } catch (e: any) {
        console.error('[loans] document upload failed', e?.message);
      }
    }

    await notify({
      memberId: data.member_id,
      title: `Loan application received — ${result.application.application_no}`,
      body: `Your application for KSh ${num(data.amount).toLocaleString()} (${result.application.repayment_months} months) has been received. Monthly repayment will be KSh ${num(result.plan.monthly_repayment).toLocaleString()}.`,
      category: 'loan',
      priority: 'high',
      channels: ['in_system', 'sms'],
      link: `/loans/applications/${result.application.id}`,
      referenceType: 'loan_application',
      referenceId: result.application.id,
    });

    revalidateLoans(data.member_id, result.application.id);
    return {
      ok: true,
      message: `Application ${result.application.application_no} submitted. Monthly repayment KSh ${num(result.plan.monthly_repayment).toLocaleString()}, total repayable KSh ${num(result.plan.total_repayable).toLocaleString()}.`,
      data: { id: result.application.id, application_no: result.application.application_no },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not submit the loan application.' };
  }
}

export async function previewLoanAction(loanTypeId: number, amount: number, months: number) {
  const loanType = await one<any>('SELECT * FROM loan_types WHERE id = $1', [loanTypeId]);
  if (!loanType) return { ok: false as const, error: 'Loan product not found.' };
  const processingFee = round2((num(amount) * num(loanType.processing_fee_pct)) / 100 + num(loanType.processing_fee_fixed));
  const plan = computeRepayment({
    principal: num(amount),
    ratePercent: num(loanType.interest_rate),
    interestPeriod: loanType.interest_period,
    method: loanType.interest_method,
    months: Math.max(1, Math.floor(num(months))),
    processingFee,
  });
  return { ok: true as const, plan, processingFee, loanType };
}

/* ------------------------------------------------------------------ *
 * GUARANTORS
 * ------------------------------------------------------------------ */
export async function addGuarantorsAction(applicationId: number, guarantorIds: number[]): Promise<ActionResult> {
  const user = await requireUser();
  const app = await one<any>('SELECT * FROM loan_applications WHERE id = $1', [applicationId]);
  if (!app) return { ok: false, error: 'Loan application not found.' };
  const isOwner = user.member_id === app.member_id;
  if (!isOwner && !can(user, 'loans.update')) {
    return { ok: false, error: 'You do not have permission to change guarantors for this application.' };
  }
  try {
    await setGuarantors(applicationId, app.member_id, guarantorIds, num(app.amount_requested), { id: user.id, name: user.name });
    revalidateLoans(app.member_id, applicationId);
    return { ok: true, message: `${guarantorIds.length} guarantor(s) notified for approval.` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not add guarantors.' };
  }
}

export async function respondGuaranteeAction(guarantorId: number, accept: boolean, notes?: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.member_id) return { ok: false, error: 'This account is not linked to a member record.' };
  if (!can(user, 'guarantors.respond') && !can(user, 'guarantors.update')) {
    return { ok: false, error: 'You do not have permission to respond to guarantee requests.' };
  }
  try {
    await respondToGuarantee({ guarantorId, accept, notes, actor: { id: user.id, name: user.name, memberId: user.member_id } });
    revalidateLoans();
    return { ok: true, message: accept ? 'You have accepted the guarantee request.' : 'You have declined the guarantee request.' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not update the guarantee request.' };
  }
}

/* ------------------------------------------------------------------ *
 * WORKFLOW
 * ------------------------------------------------------------------ */
export async function setApplicationStatusAction(
  applicationId: number,
  status: string,
  opts: { notes?: string; approvedAmount?: number; rejectionReason?: string; committeeMembers?: string[] } = {},
): Promise<ActionResult> {
  const user = await requireUser();
  const app = await one<any>('SELECT * FROM loan_applications WHERE id = $1', [applicationId]);
  if (!app) return { ok: false, error: 'Loan application not found.' };

  const isOwner = user.member_id === app.member_id;
  if (isOwner && !['withdrawn', 'cancelled'].includes(status)) {
    return { ok: false, error: 'You can only withdraw your own application.' };
  }
  if (!isOwner && !can(user, 'loan_approvals.approve') && !can(user, 'loans.update')) {
    return { ok: false, error: 'You do not have permission to review loan applications.' };
  }
  if (!LOAN_WORKFLOW[app.status]?.next?.includes(status)) {
    return { ok: false, error: `An application in "${app.status}" cannot be moved to "${status}".` };
  }

  try {
    await updateApplicationStatus({
      applicationId,
      status,
      notes: opts.notes,
      approvedAmount: opts.approvedAmount,
      rejectionReason: opts.rejectionReason,
      committeeMembers: opts.committeeMembers,
      actor: { id: user.id, name: user.name },
    });
    revalidateLoans(app.member_id, applicationId);
    return { ok: true, message: `Application ${app.application_no} is now "${status.replace(/_/g, ' ')}".` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not update the application.' };
  }
}

export async function disburseLoanAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'loans.approve') && !can(user, 'payments.create')) {
    return { ok: false, error: 'You do not have permission to disburse loans.' };
  }
  const applicationId = Number(formData.get('application_id'));
  const amount = round2(num(formData.get('amount')));
  const method = String(formData.get('method') || 'bank');
  const reference = String(formData.get('reference') || '');
  const firstDueDate = String(formData.get('first_due_date') || '');

  try {
    const result = await disburseLoan({
      applicationId,
      amount: amount || undefined,
      method,
      reference: reference || undefined,
      firstDueDate: firstDueDate || undefined,
      actor: { id: user.id, name: user.name },
    });
    revalidateLoans(result.loan.member_id, applicationId);
    revalidatePath('/sacco');
    return {
      ok: true,
      message: `Loan ${result.loanNo} disbursed. First instalment KSh ${num(result.plan.schedule[0]?.total_due).toLocaleString()} due ${result.plan.schedule[0]?.due_date}.`,
      data: { loanId: result.loan.id, loanNo: result.loanNo },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not disburse the loan.' };
  }
}

export async function repayLoanAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const loanId = Number(formData.get('loan_id'));
  const amount = round2(num(formData.get('amount')));
  const method = String(formData.get('method') || 'cash') as any;
  const date = String(formData.get('repayment_date') || '') || new Date().toISOString().slice(0, 10);
  const reference = String(formData.get('reference') || '');
  const notes = String(formData.get('notes') || '');

  const loan = await one<any>('SELECT * FROM loans WHERE id = $1', [loanId]);
  if (!loan) return { ok: false, error: 'Loan not found.' };
  const selfService = user.member_id === loan.member_id;
  if (selfService && method === 'mpesa') {
    const { quickPayAction } = await import('./payments');
    return quickPayAction({
      memberId: loan.member_id,
      amount,
      allocationType: 'loan',
      referenceId: loan.id,
      method: 'mpesa',
      note: `Loan repayment ${loan.loan_no}`,
    });
  }
  if (!can(user, 'payments.create') && !can(user, 'sacco.create')) {
    return { ok: false, error: 'You do not have permission to record loan repayments.' };
  }
  if (amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };

  try {
    const result = await recordPayment({
      memberId: loan.member_id,
      amount,
      method,
      allocations: [{ type: 'loan', amount, referenceId: loan.id, note: notes || `Repayment for ${loan.loan_no}` }],
      paymentDate: date,
      reference: reference || null,
      notes: notes || null,
      actor: { id: user.id, name: user.name },
    });
    revalidateLoans(loan.member_id);
    revalidatePath(`/loans/${loanId}`);
    return {
      ok: true,
      message: `Repayment of KSh ${amount.toLocaleString()} recorded (receipt ${result.receiptNo}). Outstanding balance KSh ${num(
        (await one<any>('SELECT outstanding_balance FROM loans WHERE id = $1', [loanId]))?.outstanding_balance,
      ).toLocaleString()}.`,
      data: result,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not record the repayment.' };
  }
}

/* ------------------------------------------------------------------ *
 * LOAN PRODUCTS (configuration)
 * ------------------------------------------------------------------ */
export async function saveLoanTypeAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'loans.manage') && !can(user, 'settings.update')) {
    return { ok: false, error: 'You do not have permission to configure loan products.' };
  }
  const raw = formDataToObject(formData);
  const parsed = loanTypeSchema.safeParse({
    ...raw,
    requires_collateral: formData.get('requires_collateral') === 'on',
    active: formData.get('active') === 'on',
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed) || 'Please correct the loan product details.' };
  const data = parsed.data;

  if (data.min_amount > data.max_amount) return { ok: false, error: 'Minimum amount cannot exceed the maximum amount.' };
  if (data.min_repayment_months > data.max_repayment_months) return { ok: false, error: 'Minimum repayment period cannot exceed the maximum.' };

  const values = {
    code: data.code.toUpperCase(),
    name: data.name,
    description: data.description || null,
    min_amount: data.min_amount,
    max_amount: data.max_amount,
    interest_rate: data.interest_rate,
    interest_period: data.interest_period,
    interest_method: data.interest_method,
    max_repayment_months: data.max_repayment_months,
    min_repayment_months: data.min_repayment_months,
    min_savings_required: data.min_savings_required,
    savings_multiplier: data.savings_multiplier,
    min_shares_required: data.min_shares_required,
    shares_multiplier: data.shares_multiplier,
    guarantors_required: data.guarantors_required,
    processing_fee_pct: data.processing_fee_pct,
    processing_fee_fixed: data.processing_fee_fixed,
    penalty_rate_pct: data.penalty_rate_pct,
    penalty_fixed: data.penalty_fixed,
    grace_days: data.grace_days,
    min_membership_months: data.min_membership_months,
    max_active_loans: data.max_active_loans,
    requires_collateral: Boolean(data.requires_collateral),
    active: data.active !== false,
  };

  const keys = Object.keys(values);
  if (data.id) {
    const before = await one<any>('SELECT * FROM loan_types WHERE id = $1', [data.id]);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await execute(`UPDATE loan_types SET ${sets}, updated_at = now() WHERE id = $1`, [
      data.id,
      ...keys.map((k) => (values as any)[k]),
    ]);
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'loan_type.updated',
      entityType: 'loan_types',
      entityId: data.id,
      entityLabel: values.name,
      description: `Updated loan product ${values.name}`,
      oldValues: before,
      newValues: values,
    });
    revalidatePath('/loans/types');
    return { ok: true, message: `Loan product "${values.name}" updated.` };
  }

  const created = await one<any>(
    `INSERT INTO loan_types (${keys.join(',')}, created_by) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}, $${keys.length + 1}) RETURNING *`,
    [...keys.map((k) => (values as any)[k]), user.id],
  );
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'loan_type.created',
    entityType: 'loan_types',
    entityId: created.id,
    entityLabel: values.name,
    description: `Created loan product ${values.name} (${values.code})`,
    newValues: values,
  });
  revalidatePath('/loans/types');
  revalidatePath('/loans/apply');
  return { ok: true, message: `Loan product "${values.name}" created.`, data: created };
}

export async function toggleLoanTypeAction(id: number, active: boolean): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'loans.manage') && !can(user, 'settings.update')) {
    return { ok: false, error: 'You do not have permission to configure loan products.' };
  }
  await execute('UPDATE loan_types SET active = $2 WHERE id = $1', [active, id]);
  await logAudit({ userId: user.id, userName: user.name, action: 'loan_type.toggled', entityType: 'loan_types', entityId: id, description: `Loan product ${active ? 'activated' : 'deactivated'}` });
  revalidatePath('/loans/types');
  return { ok: true, message: `Loan product ${active ? 'activated' : 'deactivated'}.` };
}

/* ------------------------------------------------------------------ *
 * PENALTIES & HOUSEKEEPING
 * ------------------------------------------------------------------ */
export async function waivePenaltyAction(penaltyId: number, reason: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'payments.reverse') && !can(user, 'loans.approve')) {
    return { ok: false, error: 'You do not have permission to waive penalties.' };
  }
  if (!reason || reason.trim().length < 4) return { ok: false, error: 'Provide a reason for the waiver.' };
  const penalty = await one<any>('SELECT * FROM penalties WHERE id = $1', [penaltyId]);
  if (!penalty) return { ok: false, error: 'Penalty not found.' };
  await execute(`UPDATE penalties SET status = 'waived', waived_by = $2, waiver_reason = $3 WHERE id = $1`, [
    penaltyId,
    user.id,
    reason.trim(),
  ]);
  if (penalty.reference_type === 'member_contributions') {
    await execute('UPDATE member_contributions SET penalty = 0 WHERE id = $1', [penalty.reference_id]);
  }
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'penalty.waived',
    entityType: 'penalties',
    entityId: penaltyId,
    description: `Waived penalty of KSh ${num(penalty.amount).toLocaleString()} — ${reason}`,
    oldValues: { status: penalty.status },
    newValues: { status: 'waived', reason },
    severity: 'warning',
  });
  await notify({
    memberId: penalty.member_id,
    title: 'Penalty waived',
    body: `A penalty of KSh ${num(penalty.amount).toLocaleString()} (${penalty.reason}) has been waived. Reason: ${reason}`,
    category: 'payment',
    link: '/statements',
    referenceType: 'penalties',
    referenceId: penaltyId,
  });
  revalidatePath('/payments/penalties');
  revalidatePath(`/members/${penalty.member_id}`);
  revalidatePath('/dashboard');
  return { ok: true, message: 'Penalty waived.' };
}

export async function recordPenaltyAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'payments.create') && !can(user, 'loans.update')) {
    return { ok: false, error: 'You do not have permission to record penalties.' };
  }
  const memberId = Number(formData.get('member_id'));
  const amount = round2(num(formData.get('amount')));
  const type = String(formData.get('penalty_type') || 'other');
  const reason = String(formData.get('reason') || '');
  const period = String(formData.get('period') || '');
  if (!memberId || amount <= 0) return { ok: false, error: 'Select a member and enter an amount.' };
  await execute(
    `INSERT INTO penalties (member_id, penalty_type, period, amount, reason, status, created_by)
     VALUES ($1,$2,$3,$4,$5,'pending',$6)`,
    [memberId, type, period || null, amount, reason || 'Manual penalty', user.id],
  );
  await logAudit({ userId: user.id, userName: user.name, action: 'penalty.recorded', entityType: 'penalties', entityId: memberId, description: `Penalty of KSh ${amount.toLocaleString()} recorded — ${reason}` });
  await notify({
    memberId,
    title: 'Penalty applied',
    body: `A penalty of KSh ${amount.toLocaleString()} has been applied to your account. ${reason}`,
    category: 'payment',
    priority: 'high',
    channels: ['in_system', 'sms'],
    link: '/statements',
  });
  revalidatePath(`/members/${memberId}`);
  revalidatePath('/payments/penalties');
  return { ok: true, message: `Penalty of KSh ${amount.toLocaleString()} recorded.` };
}

export async function runLoanHousekeepingAction(): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'loans.update') && !can(user, 'loans.manage')) {
    return { ok: false, error: 'You do not have permission to run loan housekeeping.' };
  }
  const statuses = await refreshLoanStatuses({ id: user.id, name: user.name });
  const penalties = await chargeLoanPenalties({ id: user.id, name: user.name });
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'loans.housekeeping',
    entityType: 'loans',
    description: `Refreshed loan statuses (${statuses.overdue} in arrears, ${statuses.defaulted} defaulted) and raised ${penalties} penalty(ies)`,
  });
  revalidateLoans();
  return {
    ok: true,
    message: `Loan housekeeping complete: ${statuses.overdue} loan(s) in arrears, ${statuses.defaulted} marked defaulted, ${penalties} penalty(ies) raised.`,
  };
}

export { checkLoanEligibility, guarantorExposure, computeRepayment, sqlDate };

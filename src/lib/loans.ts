import 'server-only';
import type { PoolClient } from 'pg';
import { one, query, execute } from './db';
import { num, round2 } from './money';
import { addDays, addMonths, isoDate, sqlDate, toDate } from './dates';
import { ensureSaccoAccount, memberShares } from './sacco';
import { notify, notifyRole } from './notify';
import { logAudit } from './audit';
import { getLoanSettings, getGuarantorSettings } from './settings';

export type InterestMethod = 'flat' | 'reducing' | 'straight' | 'amortised';

export interface ScheduleRow {
  installment_no: number;
  due_date: string;
  opening_balance: number;
  principal: number;
  interest: number;
  total_due: number;
  balance_after: number;
}

/* ------------------------------------------------------------------ *
 * LOAN MATHEMATICS
 * ------------------------------------------------------------------ */
export function monthlyRate(ratePercent: number, interestPeriod: string): number {
  const r = num(ratePercent);
  if (interestPeriod === 'annual') return r / 100 / 12;
  if (interestPeriod === 'daily') return (r / 100) * 30;
  return r / 100;
}

export interface RepaymentPlan {
  monthly_repayment: number;
  total_interest: number;
  total_repayable: number;
  processing_fee: number;
  schedule: ScheduleRow[];
}

export function computeRepayment(opts: {
  principal: number;
  ratePercent: number;
  interestPeriod?: string;
  method?: InterestMethod;
  months: number;
  firstDueDate?: Date | string | null;
  processingFee?: number;
}): RepaymentPlan {
  const principal = round2(num(opts.principal));
  const months = Math.max(1, Math.floor(num(opts.months)));
  const method = (opts.method || 'reducing') as InterestMethod;
  const r = monthlyRate(opts.ratePercent, opts.interestPeriod || 'monthly');
  const firstDue = toDate(opts.firstDueDate) || addMonths(new Date(), 1);
  const schedule: ScheduleRow[] = [];
  let balance = principal;
  let totalInterest = 0;
  let equalPayment = 0;

  if (method === 'reducing' || method === 'amortised') {
    equalPayment =
      r === 0
        ? principal / months
        : (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  } else if (method === 'flat') {
    totalInterest = round2(principal * r * months);
    equalPayment = (principal + totalInterest) / months;
  } else if (method === 'straight') {
    equalPayment = principal * r; // interest only, principal at maturity
  }

  for (let i = 1; i <= months; i++) {
    const opening = round2(balance);
    let interest = 0;
    let principalPart = 0;

    if (method === 'reducing' || method === 'amortised') {
      interest = round2(opening * r);
      principalPart = i === months ? opening : round2(equalPayment - interest);
      if (principalPart > opening) principalPart = opening;
    } else if (method === 'flat') {
      interest = round2((principal * r * months) / months);
      principalPart = i === months ? opening : round2(principal / months);
    } else {
      // straight: interest only each month, bullet principal in the last instalment
      interest = round2(opening * r);
      principalPart = i === months ? opening : 0;
    }

    const total = round2(principalPart + interest);
    balance = round2(opening - principalPart);
    totalInterest = round2(totalInterest + (method === 'flat' ? 0 : interest));

    schedule.push({
      installment_no: i,
      due_date: isoDate(addMonths(firstDue, i - 1)),
      opening_balance: opening,
      principal: principalPart,
      interest,
      total_due: total,
      balance_after: balance,
    });
  }

  if (method === 'flat') totalInterest = round2(principal * r * months);
  else totalInterest = round2(schedule.reduce((a, s) => a + s.interest, 0));

  const monthlyRepayment = round2(
    schedule.length ? schedule.reduce((a, s) => a + s.total_due, 0) / schedule.length : 0,
  );

  return {
    monthly_repayment: monthlyRepayment,
    total_interest: totalInterest,
    total_repayable: round2(principal + totalInterest + num(opts.processingFee)),
    processing_fee: round2(num(opts.processingFee)),
    schedule,
  };
}

/* ------------------------------------------------------------------ *
 * ELIGIBILITY
 * ------------------------------------------------------------------ */
export interface EligibilityCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export async function checkLoanEligibility(opts: {
  memberId: number;
  loanTypeId: number;
  amount: number;
  months: number;
}): Promise<{ passed: boolean; checks: EligibilityCheck[]; maxAmount: number; data: any }> {
  const loanType = await one<any>('SELECT * FROM loan_types WHERE id = $1 AND active', [opts.loanTypeId]);
  if (!loanType) throw new Error('Loan product not found or inactive.');

  const member = await one<any>(
    'SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL',
    [opts.memberId],
  );
  const account = await one<any>('SELECT * FROM sacco_accounts WHERE member_id = $1', [opts.memberId]);
  const shares = await memberShares(opts.memberId);
  const savings = num(account?.savings_balance);
  const outstanding = await one<{ bal: number }>(
    `SELECT COALESCE(SUM(outstanding_balance),0) AS bal FROM loans
      WHERE member_id = $1 AND status IN ('active','defaulted','restructured')`,
    [opts.memberId],
  );
  const activeLoans = await one<{ c: number }>(
    `SELECT count(*)::int AS c FROM loans WHERE member_id = $1 AND status IN ('active','defaulted','restructured')`,
    [opts.memberId],
  );
  const settings = await getLoanSettings();

  const amount = round2(num(opts.amount));
  const savingsCap = round2(savings * num(loanType.savings_multiplier || settings.max_loan_to_savings_ratio));
  const sharesCap =
    num(loanType.shares_multiplier) > 0 ? round2(shares.total_value * num(loanType.shares_multiplier)) : Infinity;
  const maxAmount = Math.min(
    num(loanType.max_amount),
    loanType.savings_multiplier > 0 ? savingsCap : num(loanType.max_amount),
    Number.isFinite(sharesCap) ? sharesCap : num(loanType.max_amount),
  );

  const membershipMonths = member?.date_joined
    ? Math.max(0, Math.floor((Date.now() - new Date(member.date_joined).getTime()) / (30.44 * 864e5)))
    : 0;

  const checks: EligibilityCheck[] = [
    {
      key: 'membership_status',
      label: 'Membership status',
      passed: member?.membership_status === 'active',
      detail: member ? `Status: ${member.membership_status}` : 'Member record not found',
    },
    {
      key: 'membership_age',
      label: `Minimum ${loanType.min_membership_months} months of CMA membership`,
      passed: membershipMonths >= num(loanType.min_membership_months),
      detail: `${membershipMonths} month(s) since joining CMA`,
    },
    {
      key: 'amount_min',
      label: `Minimum loan amount KSh ${num(loanType.min_amount).toLocaleString()}`,
      passed: amount >= num(loanType.min_amount),
      detail: `Requested KSh ${amount.toLocaleString()}`,
    },
    {
      key: 'amount_max',
      label: `Maximum loan amount KSh ${num(loanType.max_amount).toLocaleString()}`,
      passed: amount <= num(loanType.max_amount),
      detail: `Requested KSh ${amount.toLocaleString()}`,
    },
    {
      key: 'savings_minimum',
      label: `Minimum savings KSh ${num(loanType.min_savings_required).toLocaleString()}`,
      passed: savings >= num(loanType.min_savings_required),
      detail: `Savings balance KSh ${savings.toLocaleString()}`,
    },
    {
      key: 'savings_multiplier',
      label: `Loan limited to ${num(loanType.savings_multiplier)}× savings`,
      passed: !loanType.savings_multiplier || amount <= savingsCap,
      detail: `Savings-based ceiling KSh ${savingsCap.toLocaleString()}`,
    },
    {
      key: 'shares_minimum',
      label: `Minimum ${num(loanType.min_shares_required)} shares`,
      passed: shares.shares_count >= num(loanType.min_shares_required),
      detail: `${shares.shares_count} shares held (KSh ${shares.total_value.toLocaleString()})`,
    },
    {
      key: 'active_loans',
      label: `Maximum ${num(loanType.max_active_loans)} active loan(s)`,
      passed: (activeLoans?.c ?? 0) < num(loanType.max_active_loans),
      detail: `${activeLoans?.c ?? 0} active loan(s), outstanding KSh ${num(outstanding?.bal).toLocaleString()}`,
    },
    {
      key: 'term',
      label: `Repayment period ${loanType.min_repayment_months}–${loanType.max_repayment_months} months`,
      passed: opts.months >= num(loanType.min_repayment_months) && opts.months <= num(loanType.max_repayment_months),
      detail: `Requested ${opts.months} month(s)`,
    },
    {
      key: 'arrears',
      label: 'No loan in arrears beyond grace period',
      passed: true,
      detail: 'Checked by the loan committee at review stage',
    },
  ];

  return {
    passed: checks.every((c) => c.passed),
    checks,
    maxAmount: round2(Math.max(0, maxAmount)),
    data: { loanType, member, account, shares, savings, outstanding: num(outstanding?.bal), membershipMonths },
  };
}

/* ------------------------------------------------------------------ *
 * GUARANTORS
 * ------------------------------------------------------------------ */
export async function guarantorExposure(memberId: number) {
  const settings = await getGuarantorSettings();
  const account = await one<any>('SELECT * FROM sacco_accounts WHERE member_id = $1', [memberId]);
  const shares = await memberShares(memberId);
  const savings = num(account?.savings_balance);
  const sharesValue = num(shares.total_value);

  const guaranteed = await one<any>(
    `SELECT COALESCE(SUM(g.amount_guaranteed),0) AS amount, count(*)::int AS count
       FROM loan_guarantors g
       JOIN loan_applications a ON a.id = g.loan_application_id
      WHERE g.guarantor_member_id = $1
        AND g.status IN ('pending','accepted')
        AND a.status NOT IN ('rejected','cancelled','withdrawn','completed')`,
    [memberId],
  );
  const guaranteedAmount = num(guaranteed?.amount);
  const base = settings.count_savings_as_capacity ? savings + sharesValue : sharesValue;
  const capacity = round2(Math.max(0, base * num(settings.max_exposure_multiple) - guaranteedAmount));

  return {
    savings,
    shares_value: sharesValue,
    shares_count: shares.shares_count,
    guaranteed_amount: guaranteedAmount,
    active_guarantees: Number(guaranteed?.count ?? 0),
    max_guarantees: settings.max_guarantees_active,
    max_exposure: round2(base * num(settings.max_exposure_multiple)),
    remaining_capacity: capacity,
  };
}

export async function validateGuarantor(guarantorMemberId: number, borrowerMemberId: number, amount: number) {
  if (guarantorMemberId === borrowerMemberId) {
    return { ok: false, reason: 'A member cannot guarantee their own loan.' };
  }
  const member = await one<any>(
    'SELECT id, full_name, membership_status FROM members WHERE id = $1 AND deleted_at IS NULL',
    [guarantorMemberId],
  );
  if (!member) return { ok: false, reason: 'Guarantor not found.' };
  if (member.membership_status !== 'active') {
    return { ok: false, reason: `${member.full_name} is not an active CMA member.` };
  }
  const exposure = await guarantorExposure(guarantorMemberId);
  if (exposure.active_guarantees >= exposure.max_guarantees) {
    return { ok: false, reason: `${member.full_name} already guarantees ${exposure.active_guarantees} loan(s) — the limit is ${exposure.max_guarantees}.` };
  }
  if (num(amount) > exposure.remaining_capacity) {
    return {
      ok: false,
      reason: `${member.full_name} has only KSh ${exposure.remaining_capacity.toLocaleString()} of guarantee capacity left.`,
    };
  }
  return { ok: true, exposure };
}

/* ------------------------------------------------------------------ *
 * APPLICATIONS & WORKFLOW
 * ------------------------------------------------------------------ */
export const LOAN_WORKFLOW: Record<string, { next: string[]; label: string }> = {
  draft: { next: ['submitted', 'cancelled'], label: 'Draft' },
  submitted: { next: ['under_review', 'rejected', 'withdrawn'], label: 'Submitted' },
  under_review: { next: ['guarantor_pending', 'committee_review', 'approved', 'rejected'], label: 'Under review' },
  guarantor_pending: { next: ['committee_review', 'rejected'], label: 'Awaiting guarantors' },
  committee_review: { next: ['approved', 'rejected'], label: 'Loan committee' },
  approved: { next: ['disbursed', 'cancelled'], label: 'Approved' },
  rejected: { next: [], label: 'Rejected' },
  disbursed: { next: ['completed'], label: 'Disbursed' },
  cancelled: { next: [], label: 'Cancelled' },
  withdrawn: { next: [], label: 'Withdrawn' },
  completed: { next: [], label: 'Completed' },
};

export async function nextApplicationNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const row = await one<{ c: number }>(
    `SELECT count(*)::int AS c FROM loan_applications WHERE application_no LIKE $1`,
    [`LA/${year}/%`],
  );
  return `LA/${year}/${String((row?.c ?? 0) + 1).padStart(4, '0')}`;
}

export async function createLoanApplication(input: {
  memberId: number;
  loanTypeId: number;
  amount: number;
  months: number;
  purpose: string;
  guarantors?: number[];
  documents?: { title: string; file_url: string; file_name: string; mime_type?: string }[];
  actor: { id: number; name: string };
  parishId?: number | null;
}) {
  const loanType = await one<any>('SELECT * FROM loan_types WHERE id = $1', [input.loanTypeId]);
  if (!loanType) throw new Error('Unknown loan product.');

  const eligibility = await checkLoanEligibility({
    memberId: input.memberId,
    loanTypeId: input.loanTypeId,
    amount: input.amount,
    months: input.months,
  });

  const processingFee = round2(
    (num(input.amount) * num(loanType.processing_fee_pct)) / 100 + num(loanType.processing_fee_fixed),
  );
  const plan = computeRepayment({
    principal: input.amount,
    ratePercent: num(loanType.interest_rate),
    interestPeriod: loanType.interest_period,
    method: loanType.interest_method,
    months: input.months,
    processingFee,
  });

  const account = await one<any>('SELECT * FROM sacco_accounts WHERE member_id = $1', [input.memberId]);
  const shares = await memberShares(input.memberId);
  const outstanding = await one<{ bal: number }>(
    `SELECT COALESCE(SUM(outstanding_balance),0) AS bal FROM loans WHERE member_id = $1 AND status = 'active'`,
    [input.memberId],
  );

  const applicationNo = await nextApplicationNumber();
  const app = await one<any>(
    `INSERT INTO loan_applications
      (application_no, member_id, loan_type_id, amount_requested, purpose, repayment_months, interest_rate,
       interest_method, monthly_repayment, total_interest, total_repayable, processing_fee, savings_balance,
       shares_value, shares_count, outstanding_loans, eligibility_json, eligibility_passed, status, parish_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'submitted',$19,$20)
     RETURNING *`,
    [
      applicationNo,
      input.memberId,
      input.loanTypeId,
      round2(input.amount),
      input.purpose,
      input.months,
      num(loanType.interest_rate),
      loanType.interest_method,
      plan.monthly_repayment,
      plan.total_interest,
      plan.total_repayable,
      processingFee,
      num(account?.savings_balance),
      shares.total_value,
      shares.shares_count,
      num(outstanding?.bal),
      JSON.stringify({ checks: eligibility.checks, passed: eligibility.passed, maxAmount: eligibility.maxAmount }),
      eligibility.passed,
      input.parishId ?? null,
      input.actor.id,
    ],
  );

  for (const doc of input.documents || []) {
    await execute(
      `INSERT INTO documents (entity_type, entity_id, doc_type, title, file_name, file_url, mime_type, uploaded_by)
       VALUES ('loan_application',$1,'supporting',$2,$3,$4,$5,$6)`,
      [app.id, doc.title, doc.file_name, doc.file_url, doc.mime_type || null, input.actor.id],
    );
  }

  if (input.guarantors?.length) {
    await setGuarantors(app.id, input.memberId, input.guarantors, round2(input.amount), input.actor);
  }

  await logAudit({
    userId: input.actor.id,
    userName: input.actor.name,
    action: 'loan.application_created',
    entityType: 'loan_application',
    entityId: app.id,
    entityLabel: applicationNo,
    description: `Loan application ${applicationNo} for KSh ${num(input.amount).toLocaleString()} (${loanType.name})`,
    newValues: { amount: input.amount, months: input.months, loan_type: loanType.name },
  });

  await notifyRole('sacco_officer', {
    title: 'New loan application',
    body: `${applicationNo}: ${loanType.name} of KSh ${num(input.amount).toLocaleString()} submitted for review.`,
    category: 'loan',
    link: `/loans/approvals`,
    referenceType: 'loan_application',
    referenceId: app.id,
  });
  await notifyRole('loan_committee', {
    title: 'Loan application awaiting committee review',
    body: `${applicationNo} — KSh ${num(input.amount).toLocaleString()} (${loanType.name}).`,
    category: 'loan',
    link: `/loans/approvals`,
    referenceType: 'loan_application',
    referenceId: app.id,
  });

  return { application: app, plan, eligibility };
}

export async function setGuarantors(
  applicationId: number,
  borrowerMemberId: number,
  guarantorIds: number[],
  amount: number,
  actor: { id: number; name: string },
) {
  const loanType = await one<any>(
    'SELECT lt.* FROM loan_applications a JOIN loan_types lt ON lt.id = a.loan_type_id WHERE a.id = $1',
    [applicationId],
  );
  const unique = Array.from(new Set(guarantorIds.map((g) => Number(g)).filter(Boolean)));
  if (loanType && unique.length < num(loanType.guarantors_required)) {
    throw new Error(`${loanType.name} requires at least ${loanType.guarantors_required} guarantor(s).`);
  }

  const share = unique.length ? round2(amount / unique.length) : 0;
  const created: any[] = [];

  for (const gid of unique) {
    const check = await validateGuarantor(gid, borrowerMemberId, share);
    if (!check.ok) throw new Error(check.reason!);
    const guarantor = await one<any>('SELECT id, full_name, phone FROM members WHERE id = $1', [gid]);
    const row = await one<any>(
      `INSERT INTO loan_guarantors (loan_application_id, member_id, guarantor_member_id, amount_guaranteed, guarantor_share_pct, status)
       VALUES ($1,$2,$3,$4,$5,'pending')
       ON CONFLICT (loan_application_id, guarantor_member_id)
       DO UPDATE SET amount_guaranteed = EXCLUDED.amount_guaranteed, status = 'pending', responded_at = NULL
       RETURNING *`,
      [applicationId, borrowerMemberId, gid, share, round2((share / amount) * 100 || 0)],
    );
    created.push(row);
    await notify({
      memberId: gid,
      title: 'Loan guarantee request',
      body: `You have been proposed as a guarantor for a loan of KSh ${amount.toLocaleString()} (your share KSh ${share.toLocaleString()}). Please review and accept or decline the request.`,
      category: 'loan',
      priority: 'high',
      link: '/loans/guarantor-requests',
      channels: ['in_system', 'sms'],
      referenceType: 'loan_guarantor',
      referenceId: row.id,
    });
  }

  await execute(`UPDATE loan_applications SET status = 'guarantor_pending' WHERE id = $1 AND status IN ('submitted','under_review')`, [
    applicationId,
  ]);

  await logAudit({
    userId: actor.id,
    userName: actor.name,
    action: 'loan.guarantors_set',
    entityType: 'loan_application',
    entityId: applicationId,
    description: `${unique.length} guarantor(s) proposed`,
    newValues: { guarantors: unique },
  });

  return created;
}

export async function respondToGuarantee(opts: {
  guarantorId: number;
  accept: boolean;
  notes?: string;
  actor: { id: number; name: string; memberId: number | null };
}) {
  const row = await one<any>('SELECT * FROM loan_guarantors WHERE id = $1', [opts.guarantorId]);
  if (!row) throw new Error('Guarantee request not found.');
  if (row.guarantor_member_id !== opts.actor.memberId) {
    throw new Error('You can only respond to guarantee requests addressed to you.');
  }
  if (row.status !== 'pending') throw new Error(`This request has already been ${row.status}.`);

  if (opts.accept) {
    const check = await validateGuarantor(row.guarantor_member_id, row.member_id, num(row.amount_guaranteed));
    if (!check.ok) throw new Error(check.reason!);
  }

  await execute(
    `UPDATE loan_guarantors SET status = $2, responded_at = now(), response_notes = $3 WHERE id = $1`,
    [row.id, opts.accept ? 'accepted' : 'rejected', opts.notes || null],
  );

  const app = await one<any>('SELECT * FROM loan_applications WHERE id = $1', [row.loan_application_id]);
  await notify({
    memberId: row.member_id,
    title: opts.accept ? 'Guarantee accepted' : 'Guarantee declined',
    body: `${opts.actor.name} has ${opts.accept ? 'accepted' : 'declined'} to guarantee your loan application ${app?.application_no || ''}.`,
    category: 'loan',
    link: `/loans/${app?.id ?? ''}`,
    referenceType: 'loan_application',
    referenceId: row.loan_application_id,
  });

  // Move to committee review once every guarantor has responded
  const pending = await one<{ c: number }>(
    `SELECT count(*)::int AS c FROM loan_guarantors WHERE loan_application_id = $1 AND status = 'pending'`,
    [row.loan_application_id],
  );
  const accepted = await one<{ c: number }>(
    `SELECT count(*)::int AS c FROM loan_guarantors WHERE loan_application_id = $1 AND status = 'accepted'`,
    [row.loan_application_id],
  );
  const required = await one<{ guarantors_required: number }>(
    `SELECT lt.guarantors_required FROM loan_applications a JOIN loan_types lt ON lt.id = a.loan_type_id WHERE a.id = $1`,
    [row.loan_application_id],
  );

  if (pending?.c === 0) {
    if (num(accepted?.c) >= num(required?.guarantors_required)) {
      await execute(`UPDATE loan_applications SET status = 'committee_review' WHERE id = $1`, [row.loan_application_id]);
      await notifyRole('loan_committee', {
        title: 'Loan ready for committee decision',
        body: `${app?.application_no} has all required guarantees and is ready for the loan committee.`,
        category: 'loan',
        link: '/loans/approvals',
        referenceType: 'loan_application',
        referenceId: row.loan_application_id,
      });
    } else {
      await execute(`UPDATE loan_applications SET status = 'under_review' WHERE id = $1`, [row.loan_application_id]);
    }
  }

  await logAudit({
    userId: opts.actor.id,
    userName: opts.actor.name,
    action: opts.accept ? 'guarantee.accepted' : 'guarantee.rejected',
    entityType: 'loan_guarantor',
    entityId: row.id,
    description: `Guarantee ${opts.accept ? 'accepted' : 'rejected'} for application ${app?.application_no}`,
  });

  return { ok: true };
}

export async function updateApplicationStatus(opts: {
  applicationId: number;
  status: string;
  actor: { id: number; name: string };
  notes?: string;
  approvedAmount?: number;
  rejectionReason?: string;
  committeeMembers?: string[];
}) {
  const app = await one<any>('SELECT * FROM loan_applications WHERE id = $1', [opts.applicationId]);
  if (!app) throw new Error('Loan application not found.');
  const allowed = LOAN_WORKFLOW[app.status]?.next || [];
  if (!allowed.includes(opts.status)) {
    throw new Error(`Cannot move an application from "${app.status}" to "${opts.status}".`);
  }

  await execute(
    `UPDATE loan_applications
        SET status = $2,
            review_notes = COALESCE($3, review_notes),
            reviewed_by = $4,
            reviewed_at = now(),
            approved_amount = COALESCE($5, approved_amount),
            approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END,
            approved_by = CASE WHEN $2 = 'approved' THEN $4 ELSE approved_by END,
            rejection_reason = COALESCE($6, rejection_reason),
            committee_members = COALESCE($7, committee_members)
      WHERE id = $1`,
    [
      opts.applicationId,
      opts.status,
      opts.notes || null,
      opts.actor.id,
      opts.approvedAmount ? round2(opts.approvedAmount) : null,
      opts.rejectionReason || null,
      opts.committeeMembers ? JSON.stringify(opts.committeeMembers) : null,
    ],
  );

  const member = await one<any>('SELECT full_name FROM members WHERE id = $1', [app.member_id]);
  const labels: Record<string, string> = {
    under_review: 'is now under review',
    guarantor_pending: 'is awaiting guarantor confirmation',
    committee_review: 'has been forwarded to the loan committee',
    approved: 'has been APPROVED',
    rejected: 'has been REJECTED',
    cancelled: 'has been cancelled',
    withdrawn: 'has been withdrawn',
    completed: 'has been completed',
  };

  await notify({
    memberId: app.member_id,
    title: `Loan application ${app.application_no} ${labels[opts.status] || opts.status}`,
    body: `${app.application_no} for KSh ${num(app.amount_requested).toLocaleString()} ${labels[opts.status] || opts.status}.${
      opts.rejectionReason ? ` Reason: ${opts.rejectionReason}` : ''
    }${opts.notes ? ` Remarks: ${opts.notes}` : ''}`,
    category: 'loan',
    priority: ['approved', 'rejected'].includes(opts.status) ? 'high' : 'normal',
    link: `/loans/${app.id}`,
    channels: ['in_system', 'sms'],
    referenceType: 'loan_application',
    referenceId: app.id,
  });

  await logAudit({
    userId: opts.actor.id,
    userName: opts.actor.name,
    action: `loan.status_${opts.status}`,
    entityType: 'loan_application',
    entityId: app.id,
    entityLabel: app.application_no,
    description: `Application status changed from ${app.status} to ${opts.status}`,
    oldValues: { status: app.status },
    newValues: { status: opts.status, notes: opts.notes, approvedAmount: opts.approvedAmount },
    severity: ['approved', 'rejected'].includes(opts.status) ? 'warning' : 'info',
  });

  return { ok: true, memberName: member?.full_name };
}

/* ------------------------------------------------------------------ *
 * DISBURSEMENT
 * ------------------------------------------------------------------ */
export async function disburseLoan(opts: {
  applicationId: number;
  amount?: number;
  method?: string;
  reference?: string;
  firstDueDate?: Date | string | null;
  actor: { id: number; name: string };
}) {
  const settings = await getLoanSettings();
  const app = await one<any>('SELECT * FROM loan_applications WHERE id = $1', [opts.applicationId]);
  if (!app) throw new Error('Loan application not found.');
  if (!['approved', 'committee_review', 'under_review'].includes(app.status)) {
    throw new Error(`Only an approved application can be disbursed (current status: ${app.status}).`);
  }

  const loanType = await one<any>('SELECT * FROM loan_types WHERE id = $1', [app.loan_type_id]);
  const principal = round2(num(opts.amount ?? app.approved_amount ?? app.amount_requested));
  const months = num(app.repayment_months);
  const processingFee = round2((principal * num(loanType.processing_fee_pct)) / 100 + num(loanType.processing_fee_fixed));
  const firstDue = toDate(opts.firstDueDate) || addDays(new Date(), settings.first_due_date_offset_days);

  const plan = computeRepayment({
    principal,
    ratePercent: num(app.interest_rate),
    interestPeriod: loanType.interest_period,
    method: (app.interest_method as InterestMethod) || loanType.interest_method,
    months,
    firstDueDate: firstDue,
    processingFee,
  });

  const loanNo = await nextLoanNumber();
  const account = await ensureSaccoAccount(app.member_id, { createdBy: opts.actor.id });

  const loan = await one<any>(
    `INSERT INTO loans
      (loan_no, application_id, member_id, loan_type_id, sacco_account_id, principal, interest_rate,
       interest_method, term_months, processing_fee, monthly_repayment, total_interest, total_repayable,
       outstanding_balance, outstanding_principal, first_due_date, next_due_date, maturity_date,
       disbursed_amount, disbursement_method, disbursement_reference, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'active',$22)
     RETURNING *`,
    [
      loanNo,
      app.id,
      app.member_id,
      app.loan_type_id,
      account.id,
      principal,
      num(app.interest_rate),
      app.interest_method || loanType.interest_method,
      months,
      processingFee,
      plan.monthly_repayment,
      plan.total_interest,
      plan.total_repayable,
      round2(principal + plan.total_interest),
      principal,
      sqlDate(firstDue),
      sqlDate(firstDue),
      plan.schedule.length ? sqlDate(plan.schedule[plan.schedule.length - 1].due_date) : sqlDate(addMonths(firstDue, months)),
      principal,
      opts.method || 'bank',
      opts.reference || null,
      opts.actor.id,
    ],
  );

  for (const row of plan.schedule) {
    await execute(
      `INSERT INTO loan_schedules
         (loan_id, member_id, installment_no, due_date, opening_balance, principal, interest, total_due, balance_after, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
      [loan.id, app.member_id, row.installment_no, sqlDate(row.due_date), row.opening_balance, row.principal, row.interest, row.total_due, row.balance_after],
    );
  }

  await execute(
    `UPDATE loan_applications
        SET status = 'disbursed', loan_id = $2, disbursement_date = CURRENT_DATE, disbursement_method = $3,
            disbursement_reference = $4, approved_amount = $5
      WHERE id = $1`,
    [app.id, loan.id, opts.method || 'bank', opts.reference || null, principal],
  );

  await execute(
    `UPDATE loan_guarantors SET loan_id = $2, status = CASE WHEN status = 'pending' THEN 'accepted' ELSE status END
      WHERE loan_application_id = $1`,
    [app.id, loan.id],
  );

  await execute(
    `UPDATE sacco_accounts SET loan_outstanding = loan_outstanding + $2 WHERE id = $1`,
    [account.id, round2(principal + plan.total_interest)],
  );

  await execute(
    `INSERT INTO sacco_transactions
      (sacco_account_id, member_id, ledger_type, direction, amount, reference_type, reference_id, description, recorded_by)
     VALUES ($1,$2,'loan','credit',$3,'loans',$4,$5,$6)`,
    [account.id, app.member_id, principal, loan.id, `Loan ${loanNo} disbursed — ${loanType.name}`, opts.actor.id],
  );

  if (processingFee > 0) {
    await execute(
      `INSERT INTO penalties (member_id, penalty_type, reference_type, reference_id, amount, reason, status, created_by)
       VALUES ($1,'other','loans',$2,$3,$4,'pending',$5)`,
      [app.member_id, loan.id, processingFee, `${loanType.name} processing fee (${num(loanType.processing_fee_pct)}%)`, opts.actor.id],
    );
  }

  await notify({
    memberId: app.member_id,
    title: `Loan ${loanNo} disbursed`,
    body: `Your ${loanType.name} of KSh ${principal.toLocaleString()} has been disbursed. Monthly repayment KSh ${plan.monthly_repayment.toLocaleString()} for ${months} months, first due ${isoDate(firstDue)}.`,
    category: 'loan',
    priority: 'high',
    channels: ['in_system', 'sms'],
    link: `/loans/${loan.id}`,
    referenceType: 'loan',
    referenceId: loan.id,
  });

  await logAudit({
    userId: opts.actor.id,
    userName: opts.actor.name,
    action: 'loan.disbursed',
    entityType: 'loan',
    entityId: loan.id,
    entityLabel: loanNo,
    description: `Disbursed KSh ${principal.toLocaleString()} against application ${app.application_no}`,
    newValues: { loan_no: loanNo, principal, months, monthly_repayment: plan.monthly_repayment },
    severity: 'warning',
  });

  return { loan, plan, loanNo };
}

export async function nextLoanNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const row = await one<{ c: number }>(`SELECT count(*)::int AS c FROM loans WHERE loan_no LIKE $1`, [`LN/${year}/%`]);
  return `LN/${year}/${String((row?.c ?? 0) + 1).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ *
 * REPAYMENT
 * ------------------------------------------------------------------ */
export async function applyLoanRepayment(opts: {
  loanId: number;
  amount: number;
  paymentId?: number | null;
  receiptNo?: string | null;
  date?: Date | string | null;
  method?: string;
  notes?: string | null;
  actor?: { id: number; name: string } | null;
  client?: PoolClient;
}) {
  const client = opts.client;
  const amount = round2(num(opts.amount));
  if (amount <= 0) throw new Error('Repayment amount must be greater than zero.');

  const loan = await one<any>('SELECT * FROM loans WHERE id = $1 FOR UPDATE', [opts.loanId], client);
  if (!loan) throw new Error('Loan not found.');
  if (loan.status === 'completed' || loan.status === 'closed') throw new Error('This loan is already fully repaid.');

  let remaining = amount;

  // 1. outstanding penalties (including processing fees recorded as penalties)
  const penalties = await query<any>(
    `SELECT * FROM penalties WHERE member_id = $1 AND status = 'pending'
      AND (reference_type = 'loans' AND reference_id = $2 OR penalty_type = 'late_loan')
      AND amount > amount_paid ORDER BY created_at ASC`,
    [loan.member_id, loan.id],
    client,
  );
  let penaltyPortion = 0;
  for (const p of penalties) {
    if (remaining <= 0) break;
    const due = round2(num(p.amount) - num(p.amount_paid));
    const pay = Math.min(due, remaining);
    await execute(
      `UPDATE penalties SET amount_paid = amount_paid + $2, payment_id = COALESCE($3, payment_id),
              status = CASE WHEN amount_paid + $2 >= amount THEN 'paid' ELSE status END WHERE id = $1`,
      [p.id, pay, opts.paymentId || null],
      client,
    );
    penaltyPortion = round2(penaltyPortion + pay);
    remaining = round2(remaining - pay);
  }

  // 2. instalments — oldest first, interest then principal on each instalment
  const rows = await query<any>(
    `SELECT * FROM loan_schedules WHERE loan_id = $1 AND status <> 'paid'
      ORDER BY due_date ASC, installment_no ASC`,
    [loan.id],
    client,
  );

  let interestPortion = 0;
  let principalPortion = 0;

  for (const row of rows) {
    if (remaining <= 0.005) break;
    const paidSoFar = num(row.amount_paid);
    const rowInterestPaid = Math.min(paidSoFar, num(row.interest));
    const rowPrincipalPaid = Math.max(0, paidSoFar - num(row.interest));
    const outstandingInterest = round2(Math.max(0, num(row.interest) - rowInterestPaid));
    const outstandingPrincipal = round2(Math.max(0, num(row.principal) - rowPrincipalPaid));

    const payInterest = round2(Math.min(outstandingInterest, remaining));
    interestPortion = round2(interestPortion + payInterest);
    remaining = round2(remaining - payInterest);

    const payPrincipal = round2(Math.min(outstandingPrincipal, remaining));
    principalPortion = round2(principalPortion + payPrincipal);
    remaining = round2(remaining - payPrincipal);

    const newPaid = round2(paidSoFar + payInterest + payPrincipal);
    const totalDue = round2(num(row.principal) + num(row.interest));
    let status = 'pending';
    if (newPaid >= totalDue - 0.005) status = 'paid';
    else if (newPaid > 0) status = 'partial';
    else if (toDate(row.due_date)! < new Date()) status = 'overdue';

    await execute(
      `UPDATE loan_schedules
          SET amount_paid = $2, status = $3,
              paid_at = CASE WHEN $2 > 0 THEN COALESCE($4, now()) ELSE paid_at END
        WHERE id = $1`,
      [row.id, newPaid, status, opts.date ? new Date(opts.date) : null],
      client,
    );
  }

  // 3. any surplus is an early principal repayment (settlement ahead of schedule)
  const isEarly = remaining > 0.005;
  if (isEarly) {
    principalPortion = round2(principalPortion + remaining);
    remaining = 0;
  }

  const outstandingPrincipal = round2(num(loan.outstanding_principal) - principalPortion);
  const interestOutstanding = round2(num(loan.total_interest) - num(loan.interest_paid) - interestPortion);
  const outstandingBalance = round2(Math.max(0, outstandingPrincipal + Math.max(0, interestOutstanding)));
  const amountPaid = round2(num(loan.amount_paid) + amount);

  const nextDue = await one<{ due_date: Date }>(
    `SELECT due_date FROM loan_schedules WHERE loan_id = $1 AND status <> 'paid' ORDER BY due_date ASC LIMIT 1`,
    [loan.id],
    client,
  );

  const completed = outstandingBalance <= 0.005;
  if (completed) {
    await execute(
      `UPDATE loan_schedules SET status = 'paid', amount_paid = principal + interest, paid_at = now()
        WHERE loan_id = $1 AND status <> 'paid'`,
      [loan.id],
      client,
    );
  }
  await execute(
    `UPDATE loans
        SET amount_paid = $2,
            principal_paid = principal_paid + $3,
            interest_paid = interest_paid + $4,
            penalties_paid = penalties_paid + $5,
            outstanding_principal = $6,
            outstanding_balance = $7,
            next_due_date = $8,
            status = CASE WHEN $9 THEN 'completed' ELSE status END,
            completed_at = CASE WHEN $9 THEN now() ELSE completed_at END
      WHERE id = $1`,
    [
      loan.id,
      amountPaid,
      principalPortion,
      interestPortion,
      penaltyPortion,
      Math.max(0, outstandingPrincipal),
      Math.max(0, outstandingBalance),
      nextDue?.due_date ? sqlDate(nextDue.due_date) : null,
      completed,
    ],
    client,
  );

  await execute(
    `UPDATE sacco_accounts SET loan_outstanding = GREATEST(0, loan_outstanding - $2) WHERE member_id = $1`,
    [loan.member_id, amount],
    client,
  );

  await execute(
    `INSERT INTO loan_repayments
      (loan_id, member_id, payment_id, receipt_no, amount, principal_portion, interest_portion, penalty_portion,
       balance_after, repayment_date, is_early, method, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now()),$11,$12,$13,$14)`,
    [
      loan.id,
      loan.member_id,
      opts.paymentId || null,
      opts.receiptNo || null,
      amount,
      principalPortion,
      interestPortion,
      penaltyPortion,
      Math.max(0, outstandingBalance),
      opts.date ? new Date(opts.date) : null,
      isEarly,
      opts.method || 'cash',
      opts.notes || null,
      opts.actor?.id || null,
    ],
    client,
  );

  await execute(
    `INSERT INTO sacco_transactions
      (sacco_account_id, member_id, ledger_type, direction, amount, payment_id, reference_type, reference_id, description, recorded_by)
     VALUES ((SELECT id FROM sacco_accounts WHERE member_id = $1),$1,'loan','debit',$2,$3,'loans',$4,$5,$6)`,
    [loan.member_id, amount, opts.paymentId || null, loan.id, `Loan repayment ${loan.loan_no}`, opts.actor?.id || null],
    client,
  );

  if (completed) {
    await execute(`UPDATE loan_applications SET status = 'completed' WHERE loan_id = $1`, [loan.id], client);
    await execute(`UPDATE loan_guarantors SET status = 'released' WHERE loan_id = $1`, [loan.id], client);
    await notify({
      memberId: loan.member_id,
      title: `Loan ${loan.loan_no} fully repaid`,
      body: `Congratulations! Your loan ${loan.loan_no} has been fully repaid. A clearance certificate can be collected from the SDP/Sacco office.`,
      category: 'loan',
      priority: 'high',
      channels: ['in_system', 'sms'],
      link: `/loans/${loan.id}`,
      referenceType: 'loan',
      referenceId: loan.id,
    });
  } else {
    await notify({
      memberId: loan.member_id,
      title: `Loan repayment received — ${loan.loan_no}`,
      body: `KSh ${amount.toLocaleString()} received (principal KSh ${principalPortion.toLocaleString()}, interest KSh ${interestPortion.toLocaleString()}). Outstanding balance KSh ${Math.max(0, outstandingBalance).toLocaleString()}. Next due ${nextDue?.due_date ? isoDate(nextDue.due_date) : '—'}.`,
      category: 'loan',
      link: `/loans/${loan.id}`,
      referenceType: 'loan',
      referenceId: loan.id,
    });
  }

  return {
    amount,
    principal_portion: principalPortion,
    interest_portion: interestPortion,
    penalty_portion: penaltyPortion,
    outstanding_balance: Math.max(0, outstandingBalance),
    completed,
    next_due_date: nextDue?.due_date || null,
  };
}

/* ------------------------------------------------------------------ *
 * ARREARS / STATUS REFRESH (run by a nightly job or on demand)
 * ------------------------------------------------------------------ */
export async function refreshLoanStatuses(actor?: { id: number; name: string }) {
  const settings = await getLoanSettings();
  const overdue = await query<any>(
    `SELECT DISTINCT l.* FROM loans l
       JOIN loan_schedules s ON s.loan_id = l.id
      WHERE l.status = 'active' AND s.status <> 'paid' AND s.due_date < CURRENT_DATE - $1::int`,
    [settings.arrears_grace_days],
  );

  for (const loan of overdue) {
    const agg = await one<any>(
      `SELECT COALESCE(SUM(total_due - amount_paid),0) AS arrears,
              COALESCE(count(*) FILTER (WHERE status = 'overdue'),0)::int AS missed
         FROM loan_schedules WHERE loan_id = $1 AND status <> 'paid' AND due_date < CURRENT_DATE`,
      [loan.id],
    );
    await execute(
      `UPDATE loan_schedules SET status = 'overdue'
        WHERE loan_id = $1 AND status IN ('pending','due','partial') AND due_date < CURRENT_DATE - $2::int`,
      [loan.id, settings.arrears_grace_days],
    );
    await execute(`UPDATE loans SET arrears = $2 WHERE id = $1`, [loan.id, round2(num(agg?.arrears))]);
    if (num(agg?.arrears) > 0) {
      await notify({
        memberId: loan.member_id,
        title: `Loan ${loan.loan_no} in arrears`,
        body: `You have KSh ${num(agg.arrears).toLocaleString()} in arrears across ${agg.missed} instalment(s). Please pay promptly to avoid penalties.`,
        category: 'loan',
        priority: 'urgent',
        channels: ['in_system', 'sms'],
        link: `/loans/${loan.id}`,
        referenceType: 'loan',
        referenceId: loan.id,
      });
    }
  }

  const defaulted = await query<any>(
    `SELECT l.* FROM loans l
      WHERE l.status = 'active' AND l.arrears > 0
        AND (SELECT count(*) FROM loan_schedules s WHERE s.loan_id = l.id AND s.status = 'overdue') >= 3`,
  );
  for (const loan of defaulted) {
    await execute(`UPDATE loans SET status = 'defaulted' WHERE id = $1`, [loan.id]);
    await logAudit({
      userId: actor?.id ?? null,
      userName: actor?.name ?? 'system',
      action: 'loan.defaulted',
      entityType: 'loan',
      entityId: loan.id,
      entityLabel: loan.loan_no,
      description: `Loan marked defaulted after 3+ missed instalments`,
      severity: 'critical',
    });
  }

  return { overdue: overdue.length, defaulted: defaulted.length };
}

export async function chargeLoanPenalties(actor?: { id: number; name: string }) {
  const loans = await query<any>(
    `SELECT l.*, lt.penalty_rate_pct, lt.penalty_fixed FROM loans l JOIN loan_types lt ON lt.id = l.loan_type_id
      WHERE l.status IN ('active','defaulted') AND l.arrears > 0 AND (lt.penalty_rate_pct > 0 OR lt.penalty_fixed > 0)`,
  );
  let created = 0;
  for (const loan of loans) {
    const period = isoDate(new Date()).slice(0, 7);
    const existing = await one<{ c: number }>(
      `SELECT count(*)::int AS c FROM penalties
        WHERE member_id = $1 AND penalty_type = 'late_loan' AND reference_id = $2 AND period = $3`,
      [loan.member_id, loan.id, period],
    );
    if (existing?.c) continue;
    const amount = round2((num(loan.arrears) * num(loan.penalty_rate_pct)) / 100 + num(loan.penalty_fixed));
    if (amount <= 0) continue;
    await execute(
      `INSERT INTO penalties (member_id, penalty_type, reference_type, reference_id, period, amount, reason, status, created_by)
       VALUES ($1,'late_loan','loans',$2,$3,$4,$5,'pending',$6)`,
      [loan.member_id, loan.id, period, amount, `Late loan repayment penalty on ${loan.loan_no}`, actor?.id ?? null],
    );
    await execute(`UPDATE loans SET penalties_charged = penalties_charged + $2 WHERE id = $1`, [loan.id, amount]);
    created++;
  }
  return created;
}

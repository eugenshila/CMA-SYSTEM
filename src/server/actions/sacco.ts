'use server';

import { revalidatePath } from 'next/cache';
import { one, query, execute } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { postSavings, purchaseShares, transferShares, ensureSaccoAccount, computeDividendAllocation, creditDividends } from '@/lib/sacco';
import { num, round2 } from '@/lib/money';
import { generateReceiptNo } from '@/lib/crypto';
import { getShareSettings, getSaccoSettings, setSetting } from '@/lib/settings';
import type { ActionResult } from './auth';

function revalidateSacco(memberId?: number) {
  revalidatePath('/sacco');
  revalidatePath('/sacco/savings');
  revalidatePath('/sacco/shares');
  revalidatePath('/dashboard');
  revalidatePath('/reports');
  if (memberId) {
    revalidatePath(`/members/${memberId}`);
    revalidatePath(`/sacco/accounts/${memberId}`);
    revalidatePath('/statements');
  }
}

/* ------------------------------------------------------------------ *
 * ACCOUNTS
 * ------------------------------------------------------------------ */
export async function openSaccoAccountAction(memberId: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'sacco.create')) return { ok: false, error: 'You do not have permission to open sacco accounts.' };
  const account = await ensureSaccoAccount(memberId, { createdBy: user.id });
  await logAudit({ userId: user.id, userName: user.name, action: 'sacco.account_opened', entityType: 'sacco_accounts', entityId: account.id, entityLabel: account.account_no, description: `Opened SDP/Sacco account ${account.account_no}` });
  revalidateSacco(memberId);
  return { ok: true, message: `Sacco account ${account.account_no} opened.` };
}

/* ------------------------------------------------------------------ *
 * SAVINGS
 * ------------------------------------------------------------------ */
export async function postSavingsAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'savings.create')) return { ok: false, error: 'You do not have permission to post savings transactions.' };

  const memberId = Number(formData.get('member_id'));
  const amount = round2(num(formData.get('amount')));
  const type = String(formData.get('transaction_type') || 'deposit') as any;
  const method = String(formData.get('method') || 'cash');
  const notes = String(formData.get('notes') || '');
  const date = String(formData.get('transaction_date') || '') || new Date().toISOString();
  const reference = String(formData.get('reference') || '');

  if (!memberId) return { ok: false, error: 'Select a member.' };
  if (amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };

  const settings = await getSaccoSettings();
  if (type === 'withdrawal') {
    const account = await one<any>('SELECT * FROM sacco_accounts WHERE member_id = $1', [memberId]);
    if (!account) return { ok: false, error: 'This member has no sacco account.' };
    const maxAllowed = round2((num(account.savings_balance) * num(settings.max_savings_withdrawal_pct)) / 100);
    if (amount > maxAllowed) {
      return {
        ok: false,
        error: `Withdrawals are limited to ${settings.max_savings_withdrawal_pct}% of the savings balance (KSh ${maxAllowed.toLocaleString()}).`,
      };
    }
  }

  try {
    const receiptNo = generateReceiptNo('SDP');
    const entry = await postSavings({
      memberId,
      amount: type === 'withdrawal' ? -amount : amount,
      type,
      method,
      notes: notes || `${type} transaction`,
      reference: reference || null,
      receiptNo,
      date,
      recordedBy: user.id,
    });
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: `savings.${type}`,
      entityType: 'savings',
      entityId: entry.id,
      entityLabel: receiptNo,
      description: `Savings ${type} of KSh ${amount.toLocaleString()} posted to account ${entry.account_no}`,
      newValues: { amount, type, balance: entry.new_balance },
      severity: type === 'withdrawal' ? 'warning' : 'info',
    });
    await notify({
      memberId,
      title: `Savings ${type === 'withdrawal' ? 'withdrawal' : 'deposit'} — ${receiptNo}`,
      body: `KSh ${amount.toLocaleString()} ${type === 'withdrawal' ? 'withdrawn from' : 'deposited into'} your SDP/Sacco savings account. New balance KSh ${num(entry.new_balance).toLocaleString()}.`,
      category: 'sacco',
      channels: ['in_system', 'sms'],
      link: '/sacco/savings',
      referenceType: 'savings',
      referenceId: entry.id,
    });
    revalidateSacco(memberId);
    return { ok: true, message: `${type === 'withdrawal' ? 'Withdrawal' : 'Deposit'} of KSh ${amount.toLocaleString()} posted. Receipt ${receiptNo}.`, data: entry };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not post the savings transaction.' };
  }
}

/* ------------------------------------------------------------------ *
 * SHARES
 * ------------------------------------------------------------------ */
export async function purchaseSharesAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const memberId = Number(formData.get('member_id'));
  if (user.member_id !== memberId && !can(user, 'shares.create')) {
    return { ok: false, error: 'You do not have permission to issue shares.' };
  }
  const shares = Math.floor(num(formData.get('shares')));
  const amount = round2(num(formData.get('amount')));
  const notes = String(formData.get('notes') || '');
  if (shares <= 0 && amount <= 0) return { ok: false, error: 'Enter the number of shares or the amount invested.' };

  try {
    const result = await purchaseShares({
      memberId,
      shares: shares || undefined,
      amount: amount || undefined,
      notes: notes || 'Share purchase',
      recordedBy: user.id,
    });
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'shares.purchased',
      entityType: 'shares',
      entityId: result.id,
      entityLabel: result.certificate_no,
      description: `Issued ${result.shares} share(s) worth KSh ${num(result.amount).toLocaleString()} — certificate ${result.certificate_no}`,
      newValues: { shares: result.shares, value: result.amount },
    });
    await notify({
      memberId,
      title: `Share certificate ${result.certificate_no}`,
      body: `${result.shares} share(s) issued at KSh ${num(result.value_per_share).toLocaleString()} each (KSh ${num(result.amount).toLocaleString()}).`,
      category: 'sacco',
      channels: ['in_system', 'sms'],
      link: `/sacco/shares?member=${memberId}`,
      referenceType: 'shares',
      referenceId: result.id,
    });
    revalidateSacco(memberId);
    return { ok: true, message: `${result.shares} share(s) issued — certificate ${result.certificate_no}.`, data: result };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not issue shares.' };
  }
}

export async function transferSharesAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'shares.update')) return { ok: false, error: 'You do not have permission to transfer shares.' };
  const fromMemberId = Number(formData.get('from_member_id'));
  const toMemberId = Number(formData.get('to_member_id'));
  const shares = Math.floor(num(formData.get('shares')));
  const notes = String(formData.get('notes') || '');
  if (!fromMemberId || !toMemberId) return { ok: false, error: 'Select both the transferring and receiving members.' };
  if (shares <= 0) return { ok: false, error: 'Enter the number of shares to transfer.' };

  try {
    const result = await transferShares({ fromMemberId, toMemberId, shares, notes, recordedBy: user.id });
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'shares.transferred',
      entityType: 'share_transactions',
      description: `Transferred ${shares} share(s) from member #${fromMemberId} to member #${toMemberId}`,
      newValues: result,
      severity: 'warning',
    });
    for (const id of [fromMemberId, toMemberId]) {
      await notify({
        memberId: id,
        title: 'Share transfer recorded',
        body: `${shares} share(s) were transferred between CMA members (value KSh ${num(result.amount).toLocaleString()}).`,
        category: 'sacco',
        link: '/sacco/shares',
      });
    }
    revalidateSacco(fromMemberId);
    revalidateSacco(toMemberId);
    return { ok: true, message: `${shares} share(s) transferred successfully.` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not transfer shares.' };
  }
}

export async function saveShareSettingsAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update')) return { ok: false, error: 'You do not have permission to change share settings.' };
  const value = round2(num(formData.get('value_per_share')));
  if (value <= 0) return { ok: false, error: 'Share value must be greater than zero.' };
  const before = await getShareSettings();
  await setSetting(
    'shares',
    {
      value_per_share: value,
      min_shares: Math.max(1, Math.floor(num(formData.get('min_shares')))),
      max_shares_per_member: Math.max(1, Math.floor(num(formData.get('max_shares_per_member')))),
      transferable: formData.get('transferable') === 'on',
      certificate_prefix: String(formData.get('certificate_prefix') || before.certificate_prefix),
    },
    { updatedBy: user.id, groupName: 'sacco' },
  );
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'settings.updated',
    entityType: 'system_settings',
    entityLabel: 'shares',
    description: `Share value changed from KSh ${before.value_per_share.toLocaleString()} to KSh ${value.toLocaleString()}`,
    oldValues: before,
    newValues: { value_per_share: value },
    severity: 'warning',
  });
  revalidatePath('/sacco/shares');
  revalidatePath('/admin/settings');
  return { ok: true, message: `Share settings saved. One share is now worth KSh ${value.toLocaleString()}.` };
}

export async function saveSaccoSettingsAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update')) return { ok: false, error: 'You do not have permission to change sacco settings.' };
  const before = await getSaccoSettings();
  const next = {
    ...before,
    account_prefix: String(formData.get('account_prefix') || before.account_prefix),
    min_monthly_savings: round2(num(formData.get('min_monthly_savings'))),
    max_savings_withdrawal_pct: num(formData.get('max_savings_withdrawal_pct')),
    withdrawal_notice_days: Math.floor(num(formData.get('withdrawal_notice_days'))),
    interest_on_deposits_pct: num(formData.get('interest_on_deposits_pct')),
    dividend_policy: String(formData.get('dividend_policy') || before.dividend_policy),
  };
  await setSetting('sacco', next, { updatedBy: user.id, groupName: 'sacco' });
  await execute('UPDATE sacco_accounts SET min_monthly_savings = $1', [next.min_monthly_savings]);
  await logAudit({ userId: user.id, userName: user.name, action: 'settings.updated', entityType: 'system_settings', entityLabel: 'sacco', description: 'SDP/Sacco settings updated', oldValues: before, newValues: next, severity: 'warning' });
  revalidatePath('/sacco');
  revalidatePath('/admin/settings');
  return { ok: true, message: 'SDP / Sacco settings saved.' };
}

/* ------------------------------------------------------------------ *
 * DIVIDENDS
 * ------------------------------------------------------------------ */
export async function createDividendAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'sacco.approve') && !can(user, 'shares.approve')) {
    return { ok: false, error: 'You do not have permission to declare dividends.' };
  }
  const financialYear = String(formData.get('financial_year') || '').trim();
  const rate = round2(num(formData.get('rate_per_share')));
  const pct = num(formData.get('percentage'));
  const description = String(formData.get('description') || '').trim();
  if (!financialYear) return { ok: false, error: 'Enter the financial year.' };
  if (rate <= 0 && pct <= 0) return { ok: false, error: 'Enter a dividend rate per share or a percentage of share capital.' };

  try {
    const result = await computeDividendAllocation({
      financialYear,
      ratePerShare: rate,
      percentage: pct,
      description: description || undefined,
      createdBy: user.id,
    });
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'dividend.computed',
      entityType: 'dividends',
      entityId: result.dividend.id,
      entityLabel: `${financialYear} dividend`,
      description: `Computed ${financialYear} dividend: KSh ${result.total.toLocaleString()} across ${result.allocations.length} shareholders`,
      newValues: { rate_per_share: rate, percentage: pct, total: result.total },
      severity: 'warning',
    });
    revalidatePath('/sacco/dividends');
    return { ok: true, message: `Dividend computed: KSh ${result.total.toLocaleString()} for ${result.allocations.length} shareholder(s).`, data: result };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not compute the dividend.' };
  }
}

export async function creditDividendsAction(dividendId: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'sacco.approve') && !can(user, 'payments.create')) {
    return { ok: false, error: 'You do not have permission to credit dividends.' };
  }
  try {
    const count = await creditDividends(dividendId, user.id);
    await logAudit({ userId: user.id, userName: user.name, action: 'dividend.credited', entityType: 'dividends', entityId: dividendId, description: `Credited dividends to ${count} member savings account(s)`, severity: 'warning' });
    revalidateSacco();
    revalidatePath('/sacco/dividends');
    return { ok: true, message: `Dividends credited to ${count} savings account(s).` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not credit dividends.' };
  }
}

export async function declareDividendAction(dividendId: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'sacco.approve')) return { ok: false, error: 'You do not have permission to declare dividends.' };
  await execute(`UPDATE dividends SET status = 'declared', declared_date = CURRENT_DATE WHERE id = $1`, [dividendId]);
  const rows = await query<any>('SELECT member_id, amount FROM dividend_allocations WHERE dividend_id = $1', [dividendId]);
  for (const r of rows) {
    await notify({
      memberId: r.member_id,
      title: 'Dividend declared',
      body: `A dividend of KSh ${num(r.amount).toLocaleString()} has been declared on your shareholding and will be credited to your savings account.`,
      category: 'sacco',
      link: '/sacco/dividends',
    });
  }
  await logAudit({ userId: user.id, userName: user.name, action: 'dividend.declared', entityType: 'dividends', entityId: dividendId, description: `Dividend declared to ${rows.length} shareholder(s)`, severity: 'warning' });
  revalidatePath('/sacco/dividends');
  return { ok: true, message: `Dividend declared and ${rows.length} shareholder(s) notified.` };
}

export { query };

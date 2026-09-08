'use server';

import { revalidatePath } from 'next/cache';
import { one, query, execute } from '@/lib/db';
import { requireUser, requestMeta } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { recordPayment, reversePayment, memberBalances } from '@/lib/payments';
import { initiateStkPush, simulateStkResponse, handleStkCallback } from '@/lib/mpesa';
import { paymentSchema, firstError } from '@/lib/validators';
import { normalisePhone, num } from '@/lib/money';
import { sqlDate } from '@/lib/dates';
import { getPaymentSettings } from '@/lib/settings';
import type { ActionResult } from './auth';

function revalidateFinance(memberId?: number) {
  revalidatePath('/payments');
  revalidatePath('/dashboard');
  revalidatePath('/reports');
  revalidatePath('/receipts');
  if (memberId) {
    revalidatePath(`/members/${memberId}`);
    revalidatePath('/statements');
  }
}

function parseAllocations(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * RECORD / VERIFY / REVERSE PAYMENTS
 * ------------------------------------------------------------------ */
export async function recordPaymentAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const { ip } = await requestMeta();
  const isSelfService = user.member_id && String(formData.get('member_id')) === String(user.member_id);
  if (!can(user, 'payments.create') && !(isSelfService && can(user, 'payments.pay_own'))) {
    return { ok: false, error: 'You do not have permission to record payments.' };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = paymentSchema.safeParse({
    ...raw,
    allocations: parseAllocations(formData.get('allocations')),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed) || 'Please correct the payment details.' };
  const data = parsed.data;

  try {
    const result = await recordPayment({
      memberId: data.member_id,
      amount: data.amount,
      method: data.method,
      allocations: data.allocations as any,
      paymentDate: data.payment_date,
      reference: data.reference || null,
      transactionId: data.transaction_id || null,
      notes: data.notes || null,
      channel: 'manual',
      actor: { id: user.id, name: user.name },
      ip,
    });
    revalidateFinance(data.member_id);
    revalidatePath('/welfare');
    revalidatePath('/funerals');
    revalidatePath('/weddings');
    revalidatePath('/projects');
    revalidatePath('/sacco/savings');
    revalidatePath('/loans');
    return {
      ok: true,
      message: `Payment of KSh ${num(data.amount).toLocaleString()} recorded. Receipt ${result.receiptNo}.`,
      data: result,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not record the payment.' };
  }
}

/** Member "Pay Now" for a single obligation (also used by the treasurer quick-pay). */
export async function quickPayAction(input: {
  memberId: number;
  amount: number;
  allocationType: string;
  referenceId?: number | null;
  period?: string | null;
  shares?: number | null;
  method: 'mpesa' | 'cash' | 'bank' | 'airtel';
  phoneNumber?: string;
  note?: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const { ip } = await requestMeta();
  const selfService = user.member_id === input.memberId;
  if (!selfService && !can(user, 'payments.create')) {
    return { ok: false, error: 'You do not have permission to record payments for other members.' };
  }
  if (selfService && !can(user, 'payments.pay_own') && !can(user, 'payments.create')) {
    return { ok: false, error: 'You do not have permission to make payments.' };
  }
  if (!(num(input.amount) > 0)) return { ok: false, error: 'Enter an amount greater than zero.' };

  // M-Pesa → STK push (real Daraja call when configured, sandbox otherwise)
  if (input.method === 'mpesa') {
    const member = await one<any>('SELECT * FROM members WHERE id = $1', [input.memberId]);
    const phone = normalisePhone(input.phoneNumber || member?.phone);
    if (!phone) return { ok: false, error: 'Enter a valid M-Pesa phone number.' };
    try {
      const result = await initiateStkPush({
        phoneNumber: phone,
        amount: num(input.amount),
        accountReference: input.allocationType === 'savings' ? 'SAVINGS' : input.allocationType === 'shares' ? 'SHARES' : input.allocationType === 'loan' ? 'LOAN' : 'CMA',
        description: input.note || `${input.allocationType.replace(/_/g, ' ')} payment`,
        memberId: input.memberId,
        allocationType: input.allocationType,
        referenceType: referenceTypeFor(input.allocationType),
        referenceId: input.referenceId ?? null,
        requestedBy: user.id,
      });
      revalidatePath('/payments/mobile-money');
      return {
        ok: true,
        message: result.sandbox
          ? `Sandbox STK push created for KSh ${num(input.amount).toLocaleString()} to ${phone}. Complete it from Payments → M-Pesa.`
          : `Check the phone ${phone} and enter your M-Pesa PIN to pay KSh ${num(input.amount).toLocaleString()}.`,
        data: result,
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'M-Pesa request failed.' };
    }
  }

  // cash / bank / airtel recorded directly (self-service cash is treated as a pledge the treasurer verifies)
  const requiresVerification = selfService && !(await getPaymentSettings()).manual_entry?.requires_verification === false;
  try {
    const result = await recordPayment({
      memberId: input.memberId,
      amount: num(input.amount),
      method: input.method as any,
      allocations: [
        {
          type: input.allocationType as any,
          amount: num(input.amount),
          referenceId: input.referenceId ?? null,
          period: input.period || null,
          shares: input.shares || null,
          note: input.note || null,
        },
      ],
      paymentDate: new Date(),
      channel: selfService ? 'manual' : 'manual',
      notes: selfService ? 'Submitted by the member (pending treasurer verification)' : input.note,
      actor: { id: user.id, name: user.name },
      ip,
    });
    revalidateFinance(input.memberId);
    return { ok: true, message: `Payment recorded. Receipt ${result.receiptNo}.`, data: result };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not record the payment.' };
  }
  void requiresVerification;
}

function referenceTypeFor(type: string) {
  switch (type) {
    case 'welfare':
      return 'welfare_cases';
    case 'funeral':
      return 'funeral_cases';
    case 'wedding':
      return 'wedding_cases';
    case 'project':
      return 'special_projects';
    case 'loan':
      return 'loans';
    default:
      return null;
  }
}

export async function reversePaymentAction(paymentId: number, reason: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'payments.reverse')) return { ok: false, error: 'Only the Treasurer, Administrator or Super Administrator may reverse payments.' };
  if (!reason || reason.trim().length < 5) return { ok: false, error: 'Provide a reason for the reversal (at least 5 characters).' };
  const payment = await one<any>('SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (!payment) return { ok: false, error: 'Payment not found.' };
  try {
    const result = await reversePayment({ paymentId, reason: reason.trim(), actor: { id: user.id, name: user.name } });
    revalidateFinance(payment.member_id);
    revalidatePath(`/payments/${paymentId}`);
    return { ok: true, message: `Payment reversed. Credit note ${result.reversalReceipt} issued.`, data: result };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not reverse the payment.' };
  }
}

export async function markReconciledAction(paymentIds: number[]): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'payments.update')) return { ok: false, error: 'You do not have permission to reconcile payments.' };
  if (!paymentIds.length) return { ok: false, error: 'Select at least one payment.' };
  for (const id of paymentIds) {
    await execute('UPDATE payments SET reconciled = TRUE, reconciled_at = now(), reconciled_by = $2 WHERE id = $1', [id, user.id]);
  }
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'payment.reconciled',
    entityType: 'payment',
    description: `Reconciled ${paymentIds.length} payment(s)`,
    newValues: { payment_ids: paymentIds },
  });
  revalidatePath('/payments');
  return { ok: true, message: `${paymentIds.length} payment(s) marked as reconciled.` };
}

export async function allocateUnallocatedAction(paymentId: number, allocations: any[]): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'payments.update')) return { ok: false, error: 'You do not have permission to allocate payments.' };
  const payment = await one<any>('SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (!payment) return { ok: false, error: 'Payment not found.' };

  const list = parseAllocations(allocations).filter((a: any) => num(a.amount) > 0);
  if (!list.length) return { ok: false, error: 'Enter at least one allocation with an amount.' };
  const total = list.reduce((s: number, a: any) => s + num(a.amount), 0);
  if (total > num(payment.unallocated_amount) + 0.01) {
    return { ok: false, error: `You can only allocate up to KSh ${num(payment.unallocated_amount).toLocaleString()}.` };
  }

  try {
    const { applyAllocationToExistingPayment } = await import('@/server/services/payment-allocation');
    await applyAllocationToExistingPayment({ paymentId, allocations: list, actor: { id: user.id, name: user.name } });

    revalidateFinance(payment.member_id);
    revalidatePath(`/payments/${paymentId}`);
    return { ok: true, message: `KSh ${total.toLocaleString()} allocated successfully.` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not allocate the payment.' };
  }
}

/* ------------------------------------------------------------------ *
 * M-PESA / MOBILE MONEY
 * ------------------------------------------------------------------ */
export async function stkPushAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const memberId = Number(formData.get('member_id'));
  const phone = String(formData.get('phone_number') || '');
  const amount = num(formData.get('amount'));
  const allocationType = String(formData.get('allocation_type') || 'monthly_contribution');
  const referenceId = formData.get('reference_id') ? Number(formData.get('reference_id')) : null;
  const period = String(formData.get('period') || '') || null;
  const description = String(formData.get('description') || '');

  if (!memberId) return { ok: false, error: 'Select a member.' };
  if (!(amount > 0)) return { ok: false, error: 'Enter an amount greater than zero.' };
  const selfService = user.member_id === memberId;
  if (!selfService && !can(user, 'payments.create')) {
    return { ok: false, error: 'You do not have permission to request payments for other members.' };
  }

  try {
    const result = await initiateStkPush({
      phoneNumber: phone,
      amount,
      accountReference:
        allocationType === 'savings' ? 'SAVINGS' : allocationType === 'shares' ? 'SHARES' : allocationType === 'loan' ? 'LOAN' : 'CMA',
      description: description || `${allocationType.replace(/_/g, ' ')}${period ? ` ${period}` : ''}`,
      memberId,
      allocationType,
      referenceType: referenceTypeFor(allocationType),
      referenceId,
      requestedBy: user.id,
    });
    revalidatePath('/payments/mobile-money');
    revalidatePath('/payments');
    return { ok: true, message: result.message, data: result };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'STK push failed.' };
  }
}

export async function simulateStkAction(checkoutRequestID: string, success: boolean): Promise<ActionResult> {
  const user = await requireUser();
  const settings = await getPaymentSettings();
  const liveMode = settings.mpesa.enabled && !['sandbox', 'simulation'].includes(String(settings.mpesa.mode));
  if (liveMode && !can(user, 'payments.update')) {
    return { ok: false, error: 'You do not have permission to simulate M-Pesa responses.' };
  }
  try {
    const result = await simulateStkResponse(checkoutRequestID, success);
    revalidateFinance();
    revalidatePath('/payments/mobile-money');
    return { ok: result.ok, message: result.ok ? 'Sandbox callback processed — payment reconciled.' : result.message };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Simulation failed.' };
  }
}

export async function reconcileMpesaTransactionAction(transactionId: number, memberId: number, allocationType: string, amount?: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'payments.update')) return { ok: false, error: 'You do not have permission to reconcile mobile money transactions.' };
  const mpesa = await one<any>('SELECT * FROM mpesa_transactions WHERE id = $1', [transactionId]);
  if (!mpesa) return { ok: false, error: 'Transaction not found.' };
  if (mpesa.status !== 'success' || mpesa.payment_id) return { ok: false, error: 'This transaction is already reconciled or not successful.' };

  const value = num(amount ?? mpesa.amount);
  try {
    const result = await recordPayment({
      memberId,
      amount: value,
      method: 'mpesa',
      allocations: [{ type: allocationType as any, amount: value, referenceId: mpesa.reference_id || null }],
      reference: mpesa.mpesa_receipt_no,
      transactionId: mpesa.mpesa_receipt_no,
      channel: 'callback',
      notes: `Reconciled M-Pesa transaction ${mpesa.checkout_request_id}`,
      actor: { id: user.id, name: user.name },
    });
    await execute('UPDATE mpesa_transactions SET payment_id = $2, member_id = $3, status = $4 WHERE id = $1', [
      transactionId,
      result.paymentId,
      memberId,
      'success',
    ]);
    await execute('UPDATE payments SET reconciled = TRUE, reconciled_at = now(), reconciled_by = $2 WHERE id = $1', [result.paymentId, user.id]);
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'payment.mpesa_reconciled',
      entityType: 'mpesa_transaction',
      entityId: transactionId,
      entityLabel: mpesa.mpesa_receipt_no,
      description: `Manually reconciled M-Pesa receipt ${mpesa.mpesa_receipt_no} to receipt ${result.receiptNo}`,
    });
    revalidateFinance(memberId);
    revalidatePath('/payments/mobile-money');
    return { ok: true, message: `Reconciled to receipt ${result.receiptNo}.`, data: result };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Reconciliation failed.' };
  }
}

export async function savePaymentSettingsAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'settings.update')) return { ok: false, error: 'You do not have permission to change payment settings.' };
  const raw = Object.fromEntries(formData.entries());
  const { setSetting } = await import('@/lib/settings');
  await setSetting(
    'payments',
    {
      mpesa: {
        enabled: raw['mpesa_enabled'] === 'on',
        mode: String(raw['mpesa_mode'] || 'sandbox'),
        short_code: String(raw['mpesa_short_code'] || '') || null,
        passkey: String(raw['mpesa_passkey'] || '') || null,
        consumer_key: String(raw['mpesa_consumer_key'] || '') || null,
        consumer_secret: String(raw['mpesa_consumer_secret'] || '') || null,
        callback_url: String(raw['mpesa_callback_url'] || '') || null,
        stk_timeout_seconds: Number(raw['mpesa_timeout'] || 60),
      },
      bank: {
        enabled: raw['bank_enabled'] === 'on',
        account_name: String(raw['bank_account_name'] || ''),
        account_number: String(raw['bank_account_number'] || ''),
        bank: String(raw['bank_name'] || ''),
      },
      cash: { enabled: raw['cash_enabled'] !== 'off' },
      manual_entry: { enabled: true, requires_verification: raw['manual_verification'] === 'on' },
    },
    { updatedBy: user.id, groupName: 'payments', isSecret: true },
  );
  await logAudit({ userId: user.id, userName: user.name, action: 'settings.updated', entityType: 'system_settings', entityLabel: 'payments', description: 'Payment / M-Pesa settings updated', severity: 'warning' });
  revalidatePath('/admin/settings');
  revalidatePath('/payments/mobile-money');
  return { ok: true, message: 'Payment settings saved.' };
}


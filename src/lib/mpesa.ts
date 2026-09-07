import 'server-only';
import crypto from 'node:crypto';
import { one, query, execute } from './db';
import { env, mpesaConfigured } from './env';
import { num, normalisePhone, round2 } from './money';
import { getPaymentSettings, getOrganisation } from './settings';
import { recordPayment, type Allocation } from './payments';
import { logAudit } from './audit';
import { notify } from './notify';

export interface StkRequest {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  description?: string;
  memberId?: number | null;
  allocationType?: string;
  referenceType?: string;
  referenceId?: number | null;
  requestedBy?: number | null;
}

export interface StkResult {
  ok: boolean;
  sandbox: boolean;
  checkoutRequestID?: string;
  merchantRequestID?: string;
  message: string;
  transactionId?: number;
  raw?: any;
}

let tokenCache: { token: string; expires: number } | null = null;

async function getAccessToken(settings: Awaited<ReturnType<typeof getPaymentSettings>>): Promise<string> {
  if (tokenCache && tokenCache.expires > Date.now() + 30_000) return tokenCache.token;
  const consumerKey = settings.mpesa.consumer_key || env.mpesa.consumerKey;
  const consumerSecret = settings.mpesa.consumer_secret || env.mpesa.consumerSecret;
  if (!consumerKey || !consumerSecret) throw new Error('M-Pesa (Daraja) credentials are not configured.');

  const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res = await fetch(`${env.mpesa.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) throw new Error(`Daraja authentication failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in?: string };
  tokenCache = {
    token: data.access_token,
    expires: Date.now() + (parseInt(data.expires_in || '3599', 10) - 60) * 1000,
  };
  return tokenCache.token;
}

function stkPassword(shortCode: string, passkey: string, timestamp: string) {
  return Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');
}

export function darajaTimestamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Trigger an M-Pesa STK Push (Lipa na M-Pesa Online).
 *
 * When Daraja credentials are configured the real Safaricom API is called.
 * Otherwise the request runs in **sandbox mode**: the transaction is persisted
 * with status `pending` and can be completed from the UI (or by the simulator)
 * so that the entire reconciliation flow can be demonstrated end to end.
 */
export async function initiateStkPush(req: StkRequest): Promise<StkResult> {
  const settings = await getPaymentSettings();
  const org = await getOrganisation();
  const phone = normalisePhone(req.phoneNumber);
  if (!phone) throw new Error('Enter a valid Safaricom phone number, e.g. 0712 345 678.');
  const amount = Math.max(1, Math.round(num(req.amount)));
  if (amount <= 0) throw new Error('Amount must be greater than zero.');

  const shortCode = settings.mpesa.short_code || env.mpesa.shortCode;
  const passkey = settings.mpesa.passkey || env.mpesa.passkey;
  const callbackUrl =
    settings.mpesa.callback_url ||
    env.mpesa.callbackUrl ||
    `${env.APP_URL.replace(/\/$/, '')}/api/mpesa/callback`;

  const sandbox = !(mpesaConfigured() && settings.mpesa.enabled);
  const timestamp = darajaTimestamp();

  const payload = {
    BusinessShortCode: shortCode || '174379',
    Password: shortCode && passkey ? stkPassword(shortCode, passkey, timestamp) : '',
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: shortCode || '174379',
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: (req.accountReference || org.short_name || 'CMA').slice(0, 12),
    TransactionDesc: (req.description || 'CMA payment').slice(0, 13),
  };

  let checkoutId: string;
  let merchantId: string;
  let message: string;
  let raw: any = null;

  if (sandbox) {
    checkoutId = `SIM-${timestamp}-${crypto.randomInt(1000, 9999)}`;
    merchantId = `SIM-M-${crypto.randomInt(100000, 999999)}`;
    message = `Sandbox STK push created. Ask the member to confirm on their phone, then use “Simulate M-Pesa response” to complete the payment.`;
    raw = { sandbox: true, request: payload };
  } else {
    try {
      const token = await getAccessToken(settings);
      const res = await fetch(`${env.mpesa.baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      raw = await res.json();
      if (!res.ok || raw.ResponseCode !== '0') {
        throw new Error(raw?.errorMessage || raw?.ResponseDescription || `Daraja responded ${res.status}`);
      }
      checkoutId = raw.CheckoutRequestID;
      merchantId = raw.MerchantRequestID;
      message = raw.CustomerMessage || 'Check your phone and enter your M-Pesa PIN to complete the payment.';
    } catch (err: any) {
      await persistStk({
        req,
        phone,
        amount,
        checkoutId: null,
        merchantId: null,
        status: 'failed',
        resultDesc: err?.message || 'Daraja request failed',
        payload,
        response: raw,
      });
      throw new Error(`M-Pesa request failed: ${err?.message || 'unknown error'}`);
    }
  }

  const record = await persistStk({
    req,
    phone,
    amount,
    checkoutId,
    merchantId,
    status: 'pending',
    resultDesc: message,
    payload,
    response: raw,
  });

  await notify({
    memberId: req.memberId ?? null,
    title: 'M-Pesa payment request sent',
    body: `An STK push of KSh ${amount.toLocaleString()} was sent to ${phone}. ${message}`,
    category: 'payment',
    priority: 'high',
    referenceType: 'mpesa_transaction',
    referenceId: record.id,
  });

  return { ok: true, sandbox, checkoutRequestID: checkoutId, merchantRequestID: merchantId, message, transactionId: record.id, raw };
}

async function persistStk(opts: {
  req: StkRequest;
  phone: string;
  amount: number;
  checkoutId: string | null;
  merchantId: string | null;
  status: 'pending' | 'success' | 'failed';
  resultDesc: string;
  payload: any;
  response: any;
}) {
  const row = await one<any>(
    `INSERT INTO mpesa_transactions
       (member_id, provider, transaction_type, checkout_request_id, merchant_request_id, phone_number, amount,
        account_reference, description, result_desc, status, allocation_type, reference_type, reference_id,
        request_payload, response_payload, requested_by)
     VALUES ($1,'mpesa','stk_push',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      opts.req.memberId ?? null,
      opts.checkoutId,
      opts.merchantId,
      opts.phone,
      opts.amount,
      (opts.req.accountReference || 'CMA').slice(0, 12),
      opts.req.description || 'CMA payment',
      opts.resultDesc,
      opts.status,
      opts.req.allocationType || null,
      opts.req.referenceType || null,
      opts.req.referenceId ?? null,
      JSON.stringify(opts.payload || {}),
      JSON.stringify(opts.response || {}),
      opts.req.requestedBy ?? null,
    ],
  );
  return row!;
}

/** Daraja STK callback payload handler (also used by the sandbox simulator). */
export async function handleStkCallback(body: any): Promise<{ ok: boolean; message: string; paymentId?: number }> {
  const callback = body?.Body?.stkCallback ?? body?.stkCallback ?? body;
  if (!callback) return { ok: false, message: 'Malformed callback payload.' };

  const checkoutId = callback.CheckoutRequestID;
  const resultCode = Number(callback.ResultCode ?? 0);
  const record = await one<any>('SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1', [checkoutId]);
  if (!record) return { ok: false, message: `Unknown CheckoutRequestID ${checkoutId}` };

  await execute('UPDATE mpesa_transactions SET callback_payload = $2, updated_at = now() WHERE id = $1', [
    record.id,
    JSON.stringify(callback),
  ]);

  if (resultCode !== 0) {
    await execute(`UPDATE mpesa_transactions SET status = 'failed', result_code = $2, result_desc = $3 WHERE id = $1`, [
      record.id,
      resultCode,
      callback.ResultDesc || 'Failed',
    ]);
    if (record.member_id) {
      await notify({
        memberId: record.member_id,
        title: 'M-Pesa payment not completed',
        body: `The M-Pesa payment of KSh ${num(record.amount).toLocaleString()} was not completed (${callback.ResultDesc || 'cancelled'}). You can try again from your dashboard.`,
        category: 'payment',
        priority: 'high',
        referenceType: 'mpesa_transaction',
        referenceId: record.id,
      });
    }
    return { ok: false, message: callback.ResultDesc || 'STK push failed' };
  }

  const items: any[] = callback.CallbackMetadata?.Item || [];
  const pick = (name: string) => items.find((i) => i.Name === name)?.Value ?? null;
  const mpesaReceipt = String(pick('MpesaReceiptNumber') || `SANDBOX${Date.now().toString(36).toUpperCase()}`);
  const paidAmount = round2(num(pick('Amount') ?? record.amount));

  const duplicate = await one<{ id: number }>(
    `SELECT id FROM payments WHERE transaction_id = $1 AND status = 'completed' LIMIT 1`,
    [mpesaReceipt],
  );
  if (duplicate) {
    await execute(`UPDATE mpesa_transactions SET status = 'success', payment_id = $2, mpesa_receipt_no = $3 WHERE id = $1`, [
      record.id,
      duplicate.id,
      mpesaReceipt,
    ]);
    return { ok: true, message: 'Payment already reconciled (duplicate callback).', paymentId: duplicate.id };
  }

  // Resolve the member: explicit link, otherwise match by phone number.
  let memberId = record.member_id;
  if (!memberId) {
    const byPhone = await one<any>(
      `SELECT id FROM members WHERE replace(phone,'+','') = $1 OR phone = $1 OR phone = ('0' || substring($1 from 4)) LIMIT 1`,
      [record.phone_number],
    );
    memberId = byPhone?.id ?? null;
  }
  if (!memberId) {
    await execute(
      `UPDATE mpesa_transactions SET status = 'success', mpesa_receipt_no = $2, result_desc = 'Paid but member not matched' WHERE id = $1`,
      [record.id, mpesaReceipt],
    );
    return { ok: false, message: 'Payment received but could not be matched to a member. Reconcile manually.' };
  }

  const allocations = autoAllocate(record, paidAmount);
  const payment = await recordPayment({
    memberId,
    amount: paidAmount,
    method: 'mpesa',
    allocations,
    reference: mpesaReceipt,
    transactionId: mpesaReceipt,
    channel: 'callback',
    notes: `M-Pesa STK push ${record.checkout_request_id} — ${record.description}`,
    actor: { id: record.requested_by ?? 0, name: 'M-Pesa (Daraja)' },
  });

  await execute(
    `UPDATE mpesa_transactions SET status = 'success', payment_id = $2, mpesa_receipt_no = $3, result_code = 0,
            result_desc = $4, updated_at = now() WHERE id = $1`,
    [record.id, payment.paymentId, mpesaReceipt, callback.ResultDesc || 'Accepted'],
  );
  await execute('UPDATE payments SET reconciled = TRUE, reconciled_at = now() WHERE id = $1', [payment.paymentId]);

  await logAudit({
    userId: record.requested_by ?? null,
    userName: 'M-Pesa Daraja',
    action: 'payment.mpesa_callback',
    entityType: 'mpesa_transaction',
    entityId: record.id,
    entityLabel: mpesaReceipt,
    description: `M-Pesa callback reconciled KSh ${paidAmount.toLocaleString()} to receipt ${payment.receiptNo}`,
    newValues: { mpesa_receipt: mpesaReceipt, payment_id: payment.paymentId },
  });

  return { ok: true, message: 'Payment reconciled.', paymentId: payment.paymentId };
}

/**
 * Reconcile an STK request to the obligation it was raised for. Falls back to a
 * smart allocation against the member's outstanding balances.
 */
function autoAllocate(record: any, amount: number): Allocation[] {
  if (record.allocation_type && record.reference_id) {
    return [{ type: record.allocation_type as any, amount, referenceId: Number(record.reference_id) }];
  }
  if (record.allocation_type === 'savings') {
    return [{ type: 'savings', amount }];
  }
  if (record.allocation_type) {
    return [{ type: record.allocation_type as any, amount, referenceId: record.reference_id ? Number(record.reference_id) : null }];
  }
  // Generic paybill payment — the treasurer splits it during reconciliation.
  return [{ type: 'other', amount, note: 'Unallocated M-Pesa payment — please reconcile' }];
}

/** Sandbox helper: pretend the customer accepted/declined the STK push. */
export async function simulateStkResponse(checkoutRequestID: string, success = true, receiptOverride?: string) {
  const record = await one<any>('SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1', [checkoutRequestID]);
  if (!record) throw new Error('STK request not found.');
  if (record.status !== 'pending') throw new Error(`This request is already ${record.status}.`);

  const callback = {
    Body: {
      stkCallback: {
        MerchantRequestID: record.merchant_request_id,
        CheckoutRequestID: record.checkout_request_id,
        ResultCode: success ? 0 : 1032,
        ResultDesc: success ? 'Accepted' : 'Request cancelled by user',
        CallbackMetadata: success
          ? {
              Item: [
                { Name: 'Amount', Value: num(record.amount) },
                { Name: 'MpesaReceiptNumber', Value: receiptOverride || `QF${crypto.randomInt(10, 99)}${Date.now().toString().slice(-8)}` },
                { Name: 'TransactionDate', Value: Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')) },
                { Name: 'PhoneNumber', Value: Number(record.phone_number) },
              ],
            }
          : null,
      },
    },
  };
  return handleStkCallback(callback);
}

export async function queryStkStatus(checkoutRequestID: string) {
  const settings = await getPaymentSettings();
  const record = await one<any>('SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1', [checkoutRequestID]);
  if (!record) throw new Error('STK request not found.');
  if (mpesaConfigured() && settings.mpesa.enabled && record.status === 'pending') {
    try {
      const token = await getAccessToken(settings);
      const res = await fetch(`${env.mpesa.baseUrl}/mpesa/stkpushquery/v1/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          BusinessShortCode: settings.mpesa.short_code,
          Password: stkPassword(settings.mpesa.short_code!, settings.mpesa.passkey!, darajaTimestamp()),
          Timestamp: darajaTimestamp(),
          CheckoutRequestID: checkoutRequestID,
        }),
      });
      const data = await res.json();
      await execute('UPDATE mpesa_transactions SET response_payload = $2 WHERE id = $1', [record.id, JSON.stringify(data)]);
      return data;
    } catch (e: any) {
      return { error: e?.message };
    }
  }
  return record;
}

/** Unreconciled mobile money transactions awaiting treasurer action. */
export async function pendingMpesaTransactions(limit = 100) {
  return query<any>(
    `SELECT t.*, m.full_name, m.membership_no
       FROM mpesa_transactions t LEFT JOIN members m ON m.id = t.member_id
      WHERE t.status IN ('pending','failed') OR (t.status = 'success' AND t.payment_id IS NULL)
      ORDER BY t.created_at DESC LIMIT $1`,
    [limit],
  );
}

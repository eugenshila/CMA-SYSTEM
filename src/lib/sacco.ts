import 'server-only';
import type { PoolClient } from 'pg';
import { one, query, execute } from './db';
import { num, round2 } from './money';
import { getShareSettings, getSaccoSettings } from './settings';
import { sqlDate } from './dates';

/* ------------------------------------------------------------------ *
 * SACCO ACCOUNTS
 * ------------------------------------------------------------------ */
export async function getSaccoAccount(memberId: number, client?: PoolClient) {
  return one<any>('SELECT * FROM sacco_accounts WHERE member_id = $1', [memberId], client);
}

export async function ensureSaccoAccount(
  memberId: number,
  opts: { createdBy?: number | null; client?: PoolClient } = {},
) {
  const existing = await getSaccoAccount(memberId, opts.client);
  if (existing) return existing;

  const settings = await getSaccoSettings();
  const seq = await one<{ n: number }>('SELECT count(*)::int + 1 AS n FROM sacco_accounts', [], opts.client);
  const accountNo = `${settings.account_prefix}-${String(seq?.n ?? 1).padStart(5, '0')}`;
  const parish = await one<{ parish_id: number }>('SELECT parish_id FROM members WHERE id = $1', [memberId], opts.client);

  const created = await one<any>(
    `INSERT INTO sacco_accounts (account_no, member_id, parish_id, min_monthly_savings, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [accountNo, memberId, parish?.parish_id ?? null, settings.min_monthly_savings, opts.createdBy ?? null],
    opts.client,
  );
  return created;
}

/* ------------------------------------------------------------------ *
 * SAVINGS LEDGER
 * ------------------------------------------------------------------ */
export interface SavingsEntry {
  memberId: number;
  amount: number;
  type?: 'deposit' | 'withdrawal' | 'interest' | 'dividend' | 'adjustment' | 'penalty' | 'transfer_in' | 'transfer_out';
  paymentId?: number | null;
  receiptNo?: string | null;
  method?: string;
  reference?: string | null;
  period?: string | null;
  notes?: string | null;
  date?: Date | string | null;
  recordedBy?: number | null;
  client?: PoolClient;
}

export async function postSavings(entry: SavingsEntry) {
  const client = entry.client;
  const account = await ensureSaccoAccount(entry.memberId, { createdBy: entry.recordedBy, client });
  const type = entry.type || 'deposit';
  const signed = ['withdrawal', 'transfer_out'].includes(type) ? -Math.abs(num(entry.amount)) : Math.abs(num(entry.amount));
  const newBalance = round2(num(account.savings_balance) + signed);

  if (signed < 0 && newBalance < 0) {
    throw new Error(`Insufficient savings balance. Available: KSh ${num(account.savings_balance).toLocaleString()}`);
  }

  const row = await one<any>(
    `INSERT INTO savings
       (sacco_account_id, member_id, receipt_no, transaction_type, amount, running_balance, payment_id,
        payment_method, reference, transaction_date, period, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now()),$11,$12,$13) RETURNING *`,
    [
      account.id,
      entry.memberId,
      entry.receiptNo || null,
      type,
      Math.abs(signed),
      newBalance,
      entry.paymentId || null,
      entry.method || 'cash',
      entry.reference || null,
      entry.date ? new Date(entry.date) : null,
      entry.period || null,
      entry.notes || null,
      entry.recordedBy || null,
    ],
    client,
  );

  await execute(
    `UPDATE sacco_accounts
        SET savings_balance = $2,
            total_deposits  = total_deposits + CASE WHEN $3 > 0 THEN $3 ELSE 0 END,
            total_withdrawals = total_withdrawals + CASE WHEN $3 < 0 THEN -$3 ELSE 0 END
      WHERE id = $1`,
    [account.id, newBalance, signed],
    client,
  );

  await execute(
    `INSERT INTO sacco_transactions
       (sacco_account_id, member_id, ledger_type, direction, amount, balance_after, payment_id, description, transaction_date, recorded_by)
     VALUES ($1,$2,'savings',$3,$4,$5,$6,$7, COALESCE($8, now()), $9)`,
    [
      account.id,
      entry.memberId,
      signed >= 0 ? 'credit' : 'debit',
      Math.abs(signed),
      newBalance,
      entry.paymentId || null,
      entry.notes || `${type} to savings account ${account.account_no}`,
      entry.date ? new Date(entry.date) : null,
      entry.recordedBy || null,
    ],
    client,
  );

  return { ...row, account_no: account.account_no, new_balance: newBalance };
}

export async function savingsSummary(memberId: number) {
  return one<any>(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE transaction_type IN ('deposit','interest','dividend','transfer_in')),0) AS total_in,
            COALESCE(SUM(amount) FILTER (WHERE transaction_type IN ('withdrawal','transfer_out')),0) AS total_out,
            count(*)::int AS entries
       FROM savings WHERE member_id = $1 AND reversed = FALSE`,
    [memberId],
  );
}

/* ------------------------------------------------------------------ *
 * SHARES
 * ------------------------------------------------------------------ */
export interface SharePurchase {
  memberId: number;
  amount?: number;
  shares?: number;
  paymentId?: number | null;
  notes?: string | null;
  date?: Date | string | null;
  recordedBy?: number | null;
  client?: PoolClient;
}

export async function purchaseShares(input: SharePurchase) {
  const client = input.client;
  const settings = await getShareSettings();
  const account = await ensureSaccoAccount(input.memberId, { createdBy: input.recordedBy, client });
  const valuePerShare = num(settings.value_per_share) || 1000;

  let shares = Math.floor(num(input.shares) || 0);
  let amount = round2(num(input.amount) || 0);
  if (!shares && amount) shares = Math.floor(amount / valuePerShare);
  if (shares && !amount) amount = round2(shares * valuePerShare);
  if (!shares || shares <= 0) throw new Error('At least one whole share must be purchased.');
  if (shares > settings.max_shares_per_member) {
    throw new Error(`A member may not hold more than ${settings.max_shares_per_member} shares.`);
  }

  const current = await one<{ shares: number }>(
    `SELECT COALESCE(SUM(shares_count),0)::int AS shares FROM shares
      WHERE member_id = $1 AND status = 'active'`,
    [input.memberId],
    client,
  );
  const totalAfter = (current?.shares ?? 0) + shares;
  if (totalAfter > settings.max_shares_per_member) {
    throw new Error(`Purchase exceeds the maximum of ${settings.max_shares_per_member} shares per member.`);
  }

  const certSeq = await one<{ n: number }>(
    'SELECT count(*)::int + 1 AS n FROM shares',
    [],
    client,
  );
  const certificateNo = `${settings.certificate_prefix}/${String(certSeq?.n ?? 1).padStart(5, '0')}`;

  const cert = await one<any>(
    `INSERT INTO shares (certificate_no, sacco_account_id, member_id, shares_count, value_per_share, total_value, issued_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, CURRENT_DATE), $8) RETURNING *`,
    [
      certificateNo,
      account.id,
      input.memberId,
      shares,
      valuePerShare,
      round2(shares * valuePerShare),
      input.date ? sqlDate(input.date) : null,
      input.recordedBy || null,
    ],
    client,
  );

  await execute(
    `INSERT INTO share_transactions
       (member_id, sacco_account_id, share_id, transaction_type, shares_count, value_per_share, amount,
        payment_id, certificate_no, transaction_date, notes, recorded_by)
     VALUES ($1,$2,$3,'purchase',$4,$5,$6,$7,$8, COALESCE($9, now()), $10, $11)`,
    [
      input.memberId,
      account.id,
      cert.id,
      shares,
      valuePerShare,
      amount,
      input.paymentId || null,
      certificateNo,
      input.date ? new Date(input.date) : null,
      input.notes || 'Share purchase',
      input.recordedBy || null,
    ],
    client,
  );

  await execute(
    `UPDATE sacco_accounts
        SET shares_count = shares_count + $2,
            share_capital = share_capital + $3
      WHERE id = $1`,
    [account.id, shares, round2(shares * valuePerShare)],
    client,
  );

  await execute(
    `INSERT INTO sacco_transactions
       (sacco_account_id, member_id, ledger_type, direction, amount, reference_type, reference_id, description, transaction_date, recorded_by)
     VALUES ($1,$2,'shares','credit',$3,'shares',$4,$5, COALESCE($6, now()), $7)`,
    [
      account.id,
      input.memberId,
      round2(shares * valuePerShare),
      cert.id,
      `Purchase of ${shares} share(s) @ KSh ${valuePerShare.toLocaleString()} — ${certificateNo}`,
      input.date ? new Date(input.date) : null,
      input.recordedBy || null,
    ],
    client,
  );

  return { ...cert, shares, value_per_share: valuePerShare, amount };
}

export async function transferShares(opts: {
  fromMemberId: number;
  toMemberId: number;
  shares: number;
  notes?: string;
  recordedBy?: number | null;
}) {
  const settings = await getShareSettings();
  if (!settings.transferable) throw new Error('Share transfers are disabled by the administrator.');
  if (opts.fromMemberId === opts.toMemberId) throw new Error('A member cannot transfer shares to themselves.');

  const fromAccount = await ensureSaccoAccount(opts.fromMemberId, { createdBy: opts.recordedBy });
  const toAccount = await ensureSaccoAccount(opts.toMemberId, { createdBy: opts.recordedBy });
  const holding = await one<any>(
    `SELECT * FROM shares WHERE member_id = $1 AND status = 'active' ORDER BY issued_date ASC LIMIT 1 FOR UPDATE`,
    [opts.fromMemberId],
  );
  if (!holding || holding.shares_count < opts.shares) {
    throw new Error('The member does not hold enough active shares to transfer.');
  }

  const valuePerShare = num(holding.value_per_share);
  const amount = round2(opts.shares * valuePerShare);

  if (holding.shares_count === opts.shares) {
    await execute(`UPDATE shares SET status = 'transferred', member_id = $2, sacco_account_id = $3, notes = COALESCE(notes,'') || $4 WHERE id = $1`, [
      holding.id,
      opts.toMemberId,
      toAccount.id,
      ` | Transferred from member #${opts.fromMemberId}`,
    ]);
  } else {
    await execute('UPDATE shares SET shares_count = shares_count - $2, total_value = total_value - $3 WHERE id = $1', [
      holding.id,
      opts.shares,
      amount,
    ]);
    await execute(
      `INSERT INTO shares (certificate_no, sacco_account_id, member_id, shares_count, value_per_share, total_value, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        `${holding.certificate_no}-T${Date.now() % 100000}`,
        toAccount.id,
        opts.toMemberId,
        opts.shares,
        valuePerShare,
        amount,
        `Transferred from certificate ${holding.certificate_no}`,
        opts.recordedBy || null,
      ],
    );
  }

  await execute('UPDATE sacco_accounts SET shares_count = shares_count - $2, share_capital = share_capital - $3 WHERE id = $1', [
    fromAccount.id,
    opts.shares,
    amount,
  ]);
  await execute('UPDATE sacco_accounts SET shares_count = shares_count + $2, share_capital = share_capital + $3 WHERE id = $1', [
    toAccount.id,
    opts.shares,
    amount,
  ]);

  for (const [memberId, type, accountId] of [
    [opts.fromMemberId, 'transfer_out', fromAccount.id],
    [opts.toMemberId, 'transfer_in', toAccount.id],
  ] as const) {
    await execute(
      `INSERT INTO share_transactions
         (member_id, sacco_account_id, transaction_type, shares_count, value_per_share, amount,
          from_member_id, to_member_id, certificate_no, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        memberId,
        accountId,
        type,
        opts.shares,
        valuePerShare,
        amount,
        opts.fromMemberId,
        opts.toMemberId,
        holding.certificate_no,
        opts.notes || 'Share transfer',
        opts.recordedBy || null,
      ],
    );
  }

  return { shares: opts.shares, amount, certificate_no: holding.certificate_no };
}

export async function memberShares(memberId: number) {
  const row = await one<any>(
    `SELECT COALESCE(SUM(shares_count),0)::int AS shares_count,
            COALESCE(SUM(total_value),0) AS total_value,
            COALESCE(MAX(value_per_share),0) AS value_per_share
       FROM shares WHERE member_id = $1 AND status = 'active'`,
    [memberId],
  );
  return {
    shares_count: row?.shares_count ?? 0,
    total_value: num(row?.total_value),
    value_per_share: num(row?.value_per_share),
  };
}

/* ------------------------------------------------------------------ *
 * DIVIDENDS
 * ------------------------------------------------------------------ */
export async function computeDividendAllocation(opts: {
  financialYear: string;
  ratePerShare?: number;
  percentage?: number;
  description?: string;
  createdBy?: number | null;
}) {
  const settings = await getShareSettings();
  const rate = num(opts.ratePerShare) || 0;
  const pct = num(opts.percentage) || 0;
  if (!rate && !pct) throw new Error('Provide either a dividend rate per share or a percentage of share capital.');

  const holders = await query<any>(
    `SELECT m.id AS member_id, m.full_name, m.membership_no,
            COALESCE(SUM(s.shares_count),0)::int AS shares_count,
            COALESCE(SUM(s.total_value),0) AS share_capital
       FROM members m
       JOIN shares s ON s.member_id = m.id AND s.status = 'active'
      WHERE m.deleted_at IS NULL AND m.membership_status NOT IN ('deceased','resigned')
      GROUP BY m.id, m.full_name, m.membership_no
      HAVING COALESCE(SUM(s.shares_count),0) > 0
      ORDER BY m.full_name`,
  );

  const rows = holders.map((h) => ({
    ...h,
    shares_count: Number(h.shares_count),
    share_capital: num(h.share_capital),
    amount: round2(rate ? Number(h.shares_count) * rate : (num(h.share_capital) * pct) / 100),
  }));
  const total = round2(rows.reduce((a, r) => a + r.amount, 0));

  const batch = await one<any>(
    `INSERT INTO dividends (financial_year, description, rate_per_share, percentage, total_amount, status, created_by)
     VALUES ($1,$2,$3,$4,$5,'draft',$6)
     ON CONFLICT (financial_year, description) DO UPDATE SET rate_per_share = EXCLUDED.rate_per_share,
        percentage = EXCLUDED.percentage, total_amount = EXCLUDED.total_amount
     RETURNING *`,
    [opts.financialYear, opts.description || `${opts.financialYear} dividend`, rate, pct, total, opts.createdBy ?? null],
  );

  for (const r of rows) {
    await execute(
      `INSERT INTO dividend_allocations (dividend_id, member_id, shares_held, amount)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (dividend_id, member_id) DO UPDATE SET shares_held = EXCLUDED.shares_held, amount = EXCLUDED.amount`,
      [batch.id, r.member_id, r.shares_count, r.amount],
    );
  }

  return { dividend: batch, allocations: rows, total, value_per_share: settings.value_per_share };
}

export async function creditDividends(dividendId: number, recordedBy?: number | null) {
  const dividend = await one<any>('SELECT * FROM dividends WHERE id = $1', [dividendId]);
  if (!dividend) throw new Error('Dividend batch not found.');
  const allocations = await query<any>('SELECT * FROM dividend_allocations WHERE dividend_id = $1', [dividendId]);

  for (const a of allocations) {
    await postSavings({
      memberId: a.member_id,
      amount: num(a.amount),
      type: 'dividend',
      notes: `${dividend.financial_year} dividend on ${a.shares_held} shares`,
      recordedBy,
    });
    await execute(`UPDATE dividend_allocations SET status = 'credited', credited_at = now() WHERE id = $1`, [a.id]);
  }
  await execute(`UPDATE dividends SET status = 'paid', paid_date = CURRENT_DATE WHERE id = $1`, [dividendId]);
  return allocations.length;
}

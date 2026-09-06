import 'server-only';
import { one, query } from './db';
import { num, round2 } from './money';
import { isoDate, lastNPeriods, periodKey, periodLabel, sqlDate, toDate } from './dates';

/* ------------------------------------------------------------------ *
 * MEMBERSHIP
 * ------------------------------------------------------------------ */
export async function membershipReport(filters: { parishId?: number | null; churchId?: number | null; status?: string } = {}) {
  const where: string[] = ['m.deleted_at IS NULL'];
  const params: any[] = [];
  if (filters.parishId) {
    params.push(filters.parishId);
    where.push(`m.parish_id = $${params.length}`);
  }
  if (filters.churchId) {
    params.push(filters.churchId);
    where.push(`m.church_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`m.membership_status = $${params.length}`);
  }
  const w = where.join(' AND ');

  const [summary, byStatus, byParish, byChurch, byScc, byAge, byMarital, byOccupation, joined] = await Promise.all([
    one<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE m.membership_status = 'active')::int AS active,
              count(*) FILTER (WHERE m.membership_status = 'inactive')::int AS inactive,
              count(*) FILTER (WHERE m.membership_status = 'suspended')::int AS suspended,
              count(*) FILTER (WHERE m.membership_status = 'deceased')::int AS deceased,
              count(*) FILTER (WHERE m.membership_status = 'transferred')::int AS transferred,
              count(*) FILTER (WHERE m.date_joined >= CURRENT_DATE - interval '90 days')::int AS new_this_quarter,
              avg(date_part('year', age(m.date_of_birth))) AS average_age
         FROM members m WHERE ${w}`,
      params,
    ),
    query<any>(`SELECT m.membership_status AS label, count(*)::int AS value FROM members m WHERE ${w} GROUP BY 1 ORDER BY 2 DESC`, params),
    query<any>(
      `SELECT p.name AS label, count(m.id)::int AS value FROM members m JOIN parishes p ON p.id = m.parish_id
        WHERE ${w} GROUP BY p.name ORDER BY 2 DESC`,
      params,
    ),
    query<any>(
      `SELECT COALESCE(c.name,'Unassigned') AS label, count(m.id)::int AS value FROM members m
        LEFT JOIN churches c ON c.id = m.church_id WHERE ${w} GROUP BY 1 ORDER BY 2 DESC`,
      params,
    ),
    query<any>(
      `SELECT COALESCE(s.name,'Unassigned') AS label, count(m.id)::int AS value FROM members m
        LEFT JOIN small_christian_communities s ON s.id = m.scc_id WHERE ${w} GROUP BY 1 ORDER BY 2 DESC LIMIT 25`,
      params,
    ),
    query<any>(
      `SELECT CASE
                WHEN m.date_of_birth IS NULL THEN 'Unknown'
                WHEN age(m.date_of_birth) < interval '25 years' THEN '18–24'
                WHEN age(m.date_of_birth) < interval '35 years' THEN '25–34'
                WHEN age(m.date_of_birth) < interval '45 years' THEN '35–44'
                WHEN age(m.date_of_birth) < interval '55 years' THEN '45–54'
                WHEN age(m.date_of_birth) < interval '65 years' THEN '55–64'
                ELSE '65+' END AS label,
              count(*)::int AS value
         FROM members m WHERE ${w} GROUP BY 1
        ORDER BY min(COALESCE(date_part('year', age(m.date_of_birth)), 0))`,
      params,
    ),
    query<any>(`SELECT initcap(m.marital_status) AS label, count(*)::int AS value FROM members m WHERE ${w} GROUP BY 1 ORDER BY 2 DESC`, params),
    query<any>(
      `SELECT COALESCE(NULLIF(m.occupation,''),'Not stated') AS label, count(*)::int AS value
         FROM members m WHERE ${w} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      params,
    ),
    query<any>(
      `SELECT to_char(m.date_joined,'YYYY-MM') AS label, count(*)::int AS value
         FROM members m WHERE ${w} AND m.date_joined >= CURRENT_DATE - interval '24 months'
        GROUP BY 1 ORDER BY 1`,
      params,
    ),
  ]);

  return {
    summary: {
      ...summary,
      average_age: summary?.average_age ? Math.round(num(summary.average_age)) : null,
    },
    byStatus,
    byParish,
    byChurch,
    byScc,
    byAge,
    byMarital,
    byOccupation,
    joined,
  };
}

export async function memberList(filters: {
  search?: string;
  parishId?: number | null;
  churchId?: number | null;
  sccId?: number | null;
  status?: string;
  contributionStatus?: string;
  loanStatus?: string;
  sacco?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}) {
  const where: string[] = ['m.deleted_at IS NULL'];
  const params: any[] = [];
  const push = (sql: string, value: any) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(
      `(m.full_name ILIKE $${params.length} OR m.membership_no ILIKE $${params.length} OR m.phone ILIKE $${params.length}
        OR COALESCE(m.alt_phone,'') ILIKE $${params.length} OR COALESCE(m.email,'') ILIKE $${params.length}
        OR COALESCE(m.residential_area,'') ILIKE $${params.length} OR COALESCE(m.occupation,'') ILIKE $${params.length}
        OR COALESCE(sa.account_no,'') ILIKE $${params.length})`,
    );
  }
  if (filters.parishId) push('m.parish_id = ?', filters.parishId);
  if (filters.churchId) push('m.church_id = ?', filters.churchId);
  if (filters.sccId) push('m.scc_id = ?', filters.sccId);
  if (filters.status) push('m.membership_status = ?', filters.status);

  if (filters.contributionStatus) {
    where.push(`EXISTS (SELECT 1 FROM member_contributions mc WHERE mc.member_id = m.id AND mc.status = $${params.push(filters.contributionStatus)})`);
  }
  if (filters.loanStatus === 'active') where.push(`EXISTS (SELECT 1 FROM loans l WHERE l.member_id = m.id AND l.status IN ('active','defaulted'))`);
  if (filters.loanStatus === 'none') where.push(`NOT EXISTS (SELECT 1 FROM loans l WHERE l.member_id = m.id)`);
  if (filters.loanStatus === 'completed') where.push(`EXISTS (SELECT 1 FROM loans l WHERE l.member_id = m.id AND l.status = 'completed')`);
  if (filters.sacco === 'with_account') where.push('sa.id IS NOT NULL');
  if (filters.sacco === 'with_savings') where.push('COALESCE(sa.savings_balance,0) > 0');
  if (filters.sacco === 'with_shares') where.push('COALESCE(sa.shares_count,0) > 0');

  const sortMap: Record<string, string> = {
    name: 'm.full_name',
    membership_no: 'm.membership_no',
    date_joined: 'm.date_joined',
    savings: 'COALESCE(sa.savings_balance,0)',
    shares: 'COALESCE(sa.shares_count,0)',
    outstanding: 'COALESCE(mc.outstanding,0)',
  };
  const orderBy = sortMap[filters.sort || 'membership_no'] || 'm.membership_no';
  const dir = filters.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = filters.limit ?? 25;
  const offset = filters.offset ?? 0;

  const rows = await query<any>(
    `SELECT m.id, m.membership_no, m.full_name, m.phone, m.email, m.photo_url, m.membership_status, m.date_joined,
            m.marital_status, m.occupation, m.residential_area, m.gender, m.date_of_birth,
            p.name AS parish_name, c.name AS church_name, s.name AS scc_name,
            sa.account_no, COALESCE(sa.savings_balance,0) AS savings_balance, COALESCE(sa.shares_count,0) AS shares_count,
            COALESCE(sa.share_capital,0) AS share_capital, COALESCE(sa.loan_outstanding,0) AS loan_outstanding,
            COALESCE(mc.outstanding,0) AS contribution_outstanding, COALESCE(mc.periods,0) AS unpaid_periods,
            COALESCE(lo.active_loans,0) AS active_loans, COALESCE(lo.arrears,0) AS loan_arrears
       FROM members m
       LEFT JOIN parishes p ON p.id = m.parish_id
       LEFT JOIN churches c ON c.id = m.church_id
       LEFT JOIN small_christian_communities s ON s.id = m.scc_id
       LEFT JOIN sacco_accounts sa ON sa.member_id = m.id
       LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(amount_due - amount_paid),0) AS outstanding,
                   count(*) FILTER (WHERE status <> 'paid' AND exempted = FALSE)::int AS periods
              FROM member_contributions mc WHERE mc.member_id = m.id AND mc.exempted = FALSE AND mc.amount_paid < mc.amount_due
       ) mc ON TRUE
       LEFT JOIN LATERAL (
            SELECT count(*)::int AS active_loans, COALESCE(SUM(arrears),0) AS arrears
              FROM loans l WHERE l.member_id = m.id AND l.status IN ('active','defaulted','restructured')
       ) lo ON TRUE
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy} ${dir}, m.id ASC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const total = await one<{ c: number }>(
    `SELECT count(*)::int AS c FROM members m LEFT JOIN sacco_accounts sa ON sa.member_id = m.id WHERE ${where.join(' AND ')}`,
    params,
  );

  return { rows, total: Number(total?.c ?? 0), limit, offset };
}

/* ------------------------------------------------------------------ *
 * CONTRIBUTIONS
 * ------------------------------------------------------------------ */
export async function contributionReport(opts: {
  from?: string | Date | null;
  to?: string | Date | null;
  period?: string | null;
  parishId?: number | null;
} = {}) {
  const period = opts.period || periodKey(new Date());
  const where: string[] = [];
  const params: any[] = [];
  if (opts.from) {
    params.push(sqlDate(opts.from));
    where.push(`mc.due_date >= $${params.length}::date`);
  }
  if (opts.to) {
    params.push(sqlDate(opts.to));
    where.push(`mc.due_date <= $${params.length}::date`);
  }
  if (opts.period) {
    params.push(opts.period);
    where.push(`mc.period = $${params.length}`);
  }
  if (opts.parishId) {
    params.push(opts.parishId);
    where.push(`m.parish_id = $${params.length}`);
  }
  const w = where.length ? `AND ${where.join(' AND ')}` : '';

  const [summary, byPeriod, byStatus, byMember, casesSummary] = await Promise.all([
    one<any>(
      `SELECT COALESCE(SUM(mc.amount_due),0) AS expected,
              COALESCE(SUM(mc.amount_paid),0) AS collected,
              COALESCE(SUM(mc.amount_due - mc.amount_paid),0) AS outstanding,
              COALESCE(SUM(mc.penalty),0) AS penalties,
              count(*)::int AS bills,
              count(*) FILTER (WHERE mc.status = 'paid')::int AS paid_count,
              count(*) FILTER (WHERE mc.status = 'partial')::int AS partial_count,
              count(*) FILTER (WHERE mc.status = 'unpaid')::int AS unpaid_count,
              count(*) FILTER (WHERE mc.status = 'overdue')::int AS overdue_count,
              count(*) FILTER (WHERE mc.status = 'exempted')::int AS exempt_count
         FROM member_contributions mc JOIN members m ON m.id = mc.member_id
        WHERE mc.exempted = FALSE ${w}`,
      params,
    ),
    query<any>(
      `SELECT mc.period AS label, COALESCE(SUM(mc.amount_paid),0)::numeric AS value
         FROM member_contributions mc JOIN members m ON m.id = mc.member_id
        WHERE 1=1 ${w} GROUP BY mc.period ORDER BY mc.period`,
      params,
    ),
    query<any>(
      `SELECT initcap(mc.status) AS label, count(*)::int AS value
         FROM member_contributions mc JOIN members m ON m.id = mc.member_id WHERE 1=1 ${w} GROUP BY 1 ORDER BY 2 DESC`,
      params,
    ),
    query<any>(
      `SELECT m.id, m.membership_no, m.full_name, m.phone, p.name AS parish_name,
              COALESCE(SUM(mc.amount_due),0) AS expected, COALESCE(SUM(mc.amount_paid),0) AS paid,
              COALESCE(SUM(mc.amount_due - mc.amount_paid),0) AS outstanding,
              count(*) FILTER (WHERE mc.status = 'paid')::int AS months_paid,
              count(*) FILTER (WHERE mc.status IN ('unpaid','partial','overdue'))::int AS months_unpaid,
              max(mc.period) FILTER (WHERE mc.status IN ('unpaid','partial','overdue')) AS last_unpaid_period
         FROM members m
         JOIN member_contributions mc ON mc.member_id = m.id
         LEFT JOIN parishes p ON p.id = m.parish_id
        WHERE m.deleted_at IS NULL ${w}
        GROUP BY m.id, m.membership_no, m.full_name, m.phone, p.name
        ORDER BY outstanding DESC, m.membership_no`,
      params,
    ),
    one<any>(
      `SELECT
        (SELECT COALESCE(SUM(amount),0) FROM welfare_payments) AS welfare,
        (SELECT COALESCE(SUM(amount),0) FROM funeral_payments) AS funerals,
        (SELECT COALESCE(SUM(amount),0) FROM wedding_payments) AS weddings,
        (SELECT COALESCE(SUM(amount_paid),0) FROM project_contributions) AS projects`,
    ),
  ]);

  return { period, summary, byPeriod, byStatus, byMember, casesSummary };
}

export async function outstandingContributions(filters: { parishId?: number | null; limit?: number } = {}) {
  const params: any[] = [];
  let where = `mc.status IN ('unpaid','partial','overdue')`;
  if (filters.parishId) {
    params.push(filters.parishId);
    where += ` AND m.parish_id = $${params.length}`;
  }
  params.push(filters.limit ?? 200);
  return query<any>(
    `SELECT m.id AS member_id, m.membership_no, m.full_name, m.phone, p.name AS parish_name,
            mc.period, mc.period_label, mc.amount_due, mc.amount_paid, mc.penalty, mc.status, mc.due_date
       FROM member_contributions mc
       JOIN members m ON m.id = mc.member_id
       LEFT JOIN parishes p ON p.id = m.parish_id
      WHERE ${where}
      ORDER BY mc.due_date ASC, m.membership_no
      LIMIT $${params.length}`,
    params,
  );
}

/* ------------------------------------------------------------------ *
 * SACCO REPORTS
 * ------------------------------------------------------------------ */
export async function savingsByMember() {
  return query<any>(
    `SELECT m.id, m.membership_no, m.full_name, m.phone, sa.account_no,
            COALESCE(sa.savings_balance,0) AS savings_balance, COALESCE(sa.total_deposits,0) AS total_deposits,
            COALESCE(sa.total_withdrawals,0) AS total_withdrawals,
            (SELECT count(*) FROM savings s WHERE s.member_id = m.id) AS entries,
            (SELECT max(s.transaction_date) FROM savings s WHERE s.member_id = m.id) AS last_deposit
       FROM members m LEFT JOIN sacco_accounts sa ON sa.member_id = m.id
      WHERE m.deleted_at IS NULL
      ORDER BY savings_balance DESC, m.membership_no`,
  );
}

export async function sharesByMember() {
  return query<any>(
    `SELECT m.id, m.membership_no, m.full_name, sa.account_no,
            COALESCE(sa.shares_count,0) AS shares_count, COALESCE(sa.share_capital,0) AS share_capital,
            (SELECT count(*) FROM shares sh WHERE sh.member_id = m.id AND sh.status='active') AS certificates,
            (SELECT string_agg(sh.certificate_no, ', ') FROM shares sh WHERE sh.member_id = m.id AND sh.status='active') AS certificate_nos
       FROM members m LEFT JOIN sacco_accounts sa ON sa.member_id = m.id
      WHERE m.deleted_at IS NULL AND COALESCE(sa.shares_count,0) > 0
      ORDER BY shares_count DESC, m.membership_no`,
  );
}

export async function loanPortfolio() {
  const [summary, byType, byStatus, loans, arrears] = await Promise.all([
    one<any>(
      `SELECT count(*)::int AS loans, COALESCE(SUM(principal),0) AS principal_disbursed,
              COALESCE(SUM(total_interest),0) AS interest_charged, COALESCE(SUM(amount_paid),0) AS repaid,
              COALESCE(SUM(outstanding_balance),0) AS outstanding, COALESCE(SUM(arrears),0) AS arrears,
              COALESCE(SUM(penalties_charged),0) AS penalties,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status = 'defaulted')::int AS defaulted,
              count(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM loans`,
    ),
    query<any>(
      `SELECT lt.name AS label, count(l.id)::int AS loans, COALESCE(SUM(l.principal),0) AS principal,
              COALESCE(SUM(l.outstanding_balance),0) AS outstanding
         FROM loan_types lt LEFT JOIN loans l ON l.loan_type_id = lt.id
        GROUP BY lt.name ORDER BY outstanding DESC`,
    ),
    query<any>(`SELECT initcap(status) AS label, count(*)::int AS value FROM loans GROUP BY 1 ORDER BY 2 DESC`),
    query<any>(
      `SELECT l.id, l.loan_no, l.principal, l.interest_rate, l.term_months, l.monthly_repayment, l.amount_paid,
              l.outstanding_balance, l.arrears, l.status, l.next_due_date, l.disbursed_at, l.maturity_date,
              lt.name AS loan_type, m.membership_no, m.full_name, m.phone
         FROM loans l JOIN loan_types lt ON lt.id = l.loan_type_id JOIN members m ON m.id = l.member_id
        ORDER BY l.status = 'defaulted' DESC, l.outstanding_balance DESC`,
    ),
    query<any>(
      `SELECT m.membership_no, m.full_name, m.phone, l.loan_no, lt.name AS loan_type, l.arrears, l.next_due_date,
              (SELECT count(*) FROM loan_schedules s WHERE s.loan_id = l.id AND s.status = 'overdue')::int AS missed_instalments,
              l.status
         FROM loans l JOIN members m ON m.id = l.member_id JOIN loan_types lt ON lt.id = l.loan_type_id
        WHERE l.arrears > 0 ORDER BY l.arrears DESC`,
    ),
  ]);
  return { summary, byType, byStatus, loans, arrears };
}

export async function guarantorExposureReport() {
  return query<any>(
    `SELECT m.membership_no, m.full_name, m.phone,
            COALESCE(sa.savings_balance,0) AS savings_balance, COALESCE(sa.share_capital,0) AS share_capital,
            count(g.id) FILTER (WHERE g.status IN ('pending','accepted'))::int AS active_guarantees,
            COALESCE(SUM(g.amount_guaranteed) FILTER (WHERE g.status IN ('pending','accepted')),0) AS guaranteed_amount,
            COALESCE(SUM(g.amount_guaranteed) FILTER (WHERE g.status = 'accepted'),0) AS accepted_amount,
            COALESCE(SUM(g.amount_guaranteed) FILTER (WHERE g.status = 'pending'),0) AS pending_amount
       FROM members m
       LEFT JOIN sacco_accounts sa ON sa.member_id = m.id
       LEFT JOIN loan_guarantors g ON g.guarantor_member_id = m.id
       LEFT JOIN loan_applications a ON a.id = g.loan_application_id AND a.status NOT IN ('rejected','cancelled','withdrawn')
      WHERE m.deleted_at IS NULL AND g.id IS NOT NULL
      GROUP BY m.id, m.membership_no, m.full_name, m.phone, sa.savings_balance, sa.share_capital
      ORDER BY guaranteed_amount DESC`,
  );
}

export async function dividendReport(financialYear?: string) {
  const batches = await query<any>(
    `SELECT * FROM dividends ${financialYear ? `WHERE financial_year = $1` : ''} ORDER BY id DESC`,
    financialYear ? [financialYear] : [],
  );
  const allocations = batches.length
    ? await query<any>(
        `SELECT d.financial_year, d.description, m.membership_no, m.full_name, da.shares_held, da.amount, da.status
           FROM dividend_allocations da JOIN dividends d ON d.id = da.dividend_id JOIN members m ON m.id = da.member_id
          WHERE da.dividend_id = ANY($1) ORDER BY d.financial_year DESC, da.amount DESC`,
        [batches.map((b) => b.id)],
      )
    : [];
  return { batches, allocations };
}

/* ------------------------------------------------------------------ *
 * FINANCIAL REPORTS
 * ------------------------------------------------------------------ */
export async function financialSummary(opts: { from?: string | Date | null; to?: string | Date | null; parishId?: number | null } = {}) {
  const where: string[] = [`p.status = 'completed'`];
  const params: any[] = [];
  if (opts.from) {
    params.push(sqlDate(opts.from));
    where.push(`p.payment_date >= $${params.length}::date`);
  }
  if (opts.to) {
    params.push(sqlDate(opts.to));
    where.push(`p.payment_date < ($${params.length}::date + interval '1 day')`);
  }
  if (opts.parishId) {
    params.push(opts.parishId);
    where.push(`p.parish_id = $${params.length}`);
  }
  const w = where.join(' AND ');

  const [byCategory, byMethod, byMonth, totals] = await Promise.all([
    query<any>(
      `SELECT COALESCE(pa.allocation_type, p.category, 'other') AS label, COALESCE(SUM(pa.amount),0)::numeric AS value
         FROM payments p LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
        WHERE ${w} GROUP BY 1 ORDER BY 2 DESC`,
      params,
    ),
    query<any>(
      `SELECT initcap(p.method) AS label, COALESCE(SUM(p.amount),0)::numeric AS value, count(*)::int AS count
         FROM payments p WHERE ${w} GROUP BY 1 ORDER BY 2 DESC`,
      params,
    ),
    query<any>(
      `SELECT to_char(p.payment_date,'YYYY-MM') AS label, COALESCE(SUM(p.amount),0)::numeric AS value
         FROM payments p WHERE ${w} GROUP BY 1 ORDER BY 1`,
      params,
    ),
    one<any>(
      `SELECT COALESCE(SUM(p.amount),0) AS inflow, count(*)::int AS transactions,
              COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'mpesa'),0) AS mpesa,
              COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'cash'),0) AS cash,
              COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'bank'),0) AS bank,
              COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'airtel'),0) AS airtel
         FROM payments p WHERE ${w}`,
      params,
    ),
  ]);

  const outflow = await one<any>(
    `SELECT COALESCE(SUM(w.amount_disbursed),0) AS welfare,
            (SELECT COALESCE(SUM(amount_disbursed),0) FROM funeral_cases) AS funerals,
            (SELECT COALESCE(SUM(amount_disbursed),0) FROM wedding_cases) AS weddings,
            (SELECT COALESCE(SUM(amount_disbursed),0) FROM special_projects) AS projects,
            (SELECT COALESCE(SUM(principal),0) FROM loans) AS loans_disbursed
       FROM welfare_cases w`,
  );

  return { byCategory, byMethod, byMonth, totals, outflow };
}

export async function incomeStatement(opts: { from?: string | Date | null; to?: string | Date | null } = {}) {
  const params: any[] = [];
  const range = (column: string) => {
    let sql = '';
    if (opts.from) {
      params.push(sqlDate(opts.from));
      sql += ` AND ${column} >= $${params.length}::date`;
    }
    if (opts.to) {
      params.push(sqlDate(opts.to));
      sql += ` AND ${column} < ($${params.length}::date + interval '1 day')`;
    }
    return sql;
  };

  const incomeRows = await query<any>(
    `SELECT CASE
              WHEN pa.allocation_type = 'monthly_contribution' THEN 'Monthly CMA contributions'
              WHEN pa.allocation_type = 'welfare' THEN 'Welfare (sick member) contributions'
              WHEN pa.allocation_type = 'funeral' THEN 'Funeral contributions'
              WHEN pa.allocation_type = 'wedding' THEN 'Wedding contributions'
              WHEN pa.allocation_type = 'project' THEN 'Special project contributions'
              WHEN pa.allocation_type = 'savings' THEN 'SDP / Sacco savings deposits'
              WHEN pa.allocation_type = 'shares' THEN 'Share capital'
              WHEN pa.allocation_type IN ('loan','loan_principal','loan_interest') THEN 'Loan repayments'
              WHEN pa.allocation_type IN ('penalty','loan_penalty','fee') THEN 'Penalties & fees'
              ELSE 'Other income'
            END AS account,
            COALESCE(SUM(pa.amount),0) AS amount
       FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
      WHERE p.status = 'completed'${range('p.payment_date')}
      GROUP BY 1 ORDER BY 2 DESC`,
    [...params],
  );

  const expenseRows = await query<any>(
    `SELECT account, COALESCE(SUM(amount),0) AS amount FROM (
       SELECT 'Welfare disbursements' AS account, amount_disbursed AS amount FROM welfare_cases WHERE amount_disbursed > 0${range('disbursed_at')}
       UNION ALL SELECT 'Funeral disbursements', amount_disbursed FROM funeral_cases WHERE amount_disbursed > 0${range('disbursed_at')}
       UNION ALL SELECT 'Wedding disbursements', amount_disbursed FROM wedding_cases WHERE amount_disbursed > 0${range('disbursed_at')}
       UNION ALL SELECT 'Project disbursements', amount_disbursed FROM special_projects WHERE amount_disbursed > 0
       UNION ALL SELECT 'Loans disbursed', principal FROM loans${range('disbursed_at')}
       UNION ALL SELECT 'Savings withdrawals', amount FROM savings WHERE transaction_type = 'withdrawal'${range('transaction_date')}
     ) x GROUP BY account ORDER BY 2 DESC`,
    [...params, ...params, ...params, ...params],
  );

  const totalIncome = round2(incomeRows.reduce((a, r) => a + num(r.amount), 0));
  const totalExpense = round2(expenseRows.reduce((a, r) => a + num(r.amount), 0));
  return { incomeRows, expenseRows, totalIncome, totalExpense, net: round2(totalIncome - totalExpense) };
}

export async function fundBalances() {
  return query<any>(
    `SELECT ct.account_code, ct.name AS fund, ct.category,
            COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
                       WHERE p.status = 'completed' AND pa.allocation_type = CASE ct.category
                          WHEN 'monthly' THEN 'monthly_contribution'
                          WHEN 'welfare' THEN 'welfare'
                          WHEN 'funeral' THEN 'funeral'
                          WHEN 'wedding' THEN 'wedding'
                          WHEN 'special' THEN 'project'
                          WHEN 'project' THEN 'project'
                          WHEN 'savings' THEN 'savings'
                          WHEN 'shares' THEN 'shares' END),0) AS collected,
            COALESCE((SELECT SUM(amount_disbursed) FROM welfare_cases WHERE ct.category = 'welfare'),0) +
            COALESCE((SELECT SUM(amount_disbursed) FROM funeral_cases WHERE ct.category = 'funeral'),0) +
            COALESCE((SELECT SUM(amount_disbursed) FROM wedding_cases WHERE ct.category = 'wedding'),0) +
            COALESCE((SELECT SUM(amount_disbursed) FROM special_projects WHERE ct.category IN ('special','project')),0) AS disbursed
       FROM contribution_types ct WHERE ct.active ORDER BY ct.account_code`,
  );
}

export async function reconciliationReport(opts: { from?: string | Date | null; to?: string | Date | null } = {}) {
  const params: any[] = [];
  const clauses: string[] = [];
  if (opts.from) {
    params.push(sqlDate(opts.from));
    clauses.push(`p.payment_date >= $${params.length}::date`);
  }
  if (opts.to) {
    params.push(sqlDate(opts.to));
    clauses.push(`p.payment_date < ($${params.length}::date + interval '1 day')`);
  }
  const w = clauses.length ? `AND ${clauses.join(' AND ')}` : '';

  return query<any>(
    `SELECT p.id, p.receipt_no, p.payment_date, p.method, p.amount, p.allocated_amount, p.unallocated_amount,
            p.status, p.reconciled, p.reference, p.transaction_id, m.full_name, m.membership_no,
            COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.payment_id = p.id),0) AS allocation_total
       FROM payments p JOIN members m ON m.id = p.member_id
      WHERE p.status <> 'cancelled' ${w}
      ORDER BY p.payment_date DESC LIMIT 500`,
    params,
  );
}

/* ------------------------------------------------------------------ *
 * DASHBOARDS
 * ------------------------------------------------------------------ */
export async function financeDashboard(parishId?: number | null) {
  const pWhere = parishId ? 'AND parish_id = $1' : '';
  const pParams = parishId ? [parishId] : [];

  const [contributions, cases, sacco, loans, cashflow, monthlyTrend, recent] = await Promise.all([
    one<any>(
      `SELECT COALESCE(SUM(amount_paid),0) AS collected, COALESCE(SUM(amount_due),0) AS expected,
              COALESCE(SUM(amount_due - amount_paid) FILTER (WHERE status <> 'paid' AND exempted = FALSE),0) AS outstanding,
              COALESCE(SUM(penalty) FILTER (WHERE status <> 'paid'),0) AS penalties
         FROM member_contributions mc JOIN members m ON m.id = mc.member_id
        WHERE mc.period = $1 ${parishId ? 'AND m.parish_id = $2' : ''}`,
      parishId ? [periodKey(new Date()), parishId] : [periodKey(new Date())],
    ),
    one<any>(
      `SELECT (SELECT COALESCE(SUM(amount),0) FROM welfare_payments) AS welfare,
              (SELECT COALESCE(SUM(amount),0) FROM funeral_payments) AS funerals,
              (SELECT COALESCE(SUM(amount),0) FROM wedding_payments) AS weddings,
              (SELECT COALESCE(SUM(amount_paid),0) FROM project_contributions) AS projects`,
    ),
    one<any>(
      `SELECT COALESCE(SUM(savings_balance),0) AS savings, COALESCE(SUM(share_capital),0) AS share_capital,
              COALESCE(SUM(shares_count),0)::int AS shares, count(*)::int AS accounts
         FROM sacco_accounts ${parishId ? 'WHERE parish_id = $1' : ''}`,
      pParams,
    ),
    one<any>(
      `SELECT COALESCE(SUM(outstanding_balance),0) AS outstanding, COALESCE(SUM(amount_paid),0) AS repaid,
              COALESCE(SUM(arrears),0) AS arrears, COALESCE(SUM(principal),0) AS disbursed,
              count(*) FILTER (WHERE status IN ('active','defaulted'))::int AS active_loans,
              count(*) FILTER (WHERE status = 'defaulted')::int AS defaulted
         FROM loans l JOIN members m ON m.id = l.member_id WHERE 1=1 ${parishId ? 'AND m.parish_id = $1' : ''}`,
      pParams,
    ),
    query<any>(
      `SELECT to_char(d,'YYYY-MM') AS period,
              COALESCE((SELECT SUM(amount) FROM payments p WHERE p.status='completed' AND to_char(p.payment_date,'YYYY-MM') = to_char(d,'YYYY-MM')),0) AS inflow,
              COALESCE((SELECT SUM(amount_disbursed) FROM welfare_cases WHERE to_char(disbursed_at,'YYYY-MM') = to_char(d,'YYYY-MM')),0) +
              COALESCE((SELECT SUM(amount_disbursed) FROM funeral_cases WHERE to_char(disbursed_at,'YYYY-MM') = to_char(d,'YYYY-MM')),0) +
              COALESCE((SELECT SUM(principal) FROM loans WHERE to_char(disbursed_at,'YYYY-MM') = to_char(d,'YYYY-MM')),0) AS outflow
         FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') d
        ORDER BY 1`,
    ),
    query<any>(
      `SELECT period AS label, COALESCE(SUM(amount_paid),0)::numeric AS value
         FROM member_contributions WHERE period >= $1 GROUP BY period ORDER BY period`,
      [lastNPeriods(12)[0]],
    ),
    query<any>(
      `SELECT p.id, p.receipt_no, p.amount, p.method, p.payment_date, p.status, m.full_name, m.membership_no
         FROM payments p JOIN members m ON m.id = p.member_id
        WHERE p.status = 'completed' ${parishId ? 'AND p.parish_id = $1' : ''}
        ORDER BY p.payment_date DESC LIMIT 8`,
      pParams,
    ),
  ]);

  const collectionRate = num(contributions?.expected)
    ? Math.round((num(contributions?.collected) / num(contributions?.expected)) * 100)
    : 0;

  return {
    period: periodKey(new Date()),
    periodLabel: periodLabel(periodKey(new Date())),
    contributions,
    cases,
    sacco,
    loans,
    cashflow,
    monthlyTrend,
    recent,
    collectionRate,
    totalInflow: round2(
      num(contributions?.collected) + num(cases?.welfare) + num(cases?.funerals) + num(cases?.weddings) + num(cases?.projects),
    ),
  };
}

export async function systemStats() {
  return one<any>(
    `SELECT (SELECT count(*) FROM members WHERE deleted_at IS NULL) AS members,
            (SELECT count(*) FROM users WHERE deleted_at IS NULL) AS users,
            (SELECT count(*) FROM payments) AS payments,
            (SELECT count(*) FROM loans) AS loans,
            (SELECT count(*) FROM notifications WHERE read_at IS NULL) AS unread_notifications,
            (SELECT count(*) FROM audit_logs) AS audit_entries,
            (SELECT count(*) FROM meetings) AS meetings,
            (SELECT count(*) FROM special_projects WHERE status = 'open') AS open_projects`,
  );
}

export async function attendanceReport(opts: { meetingId?: number; memberId?: number; from?: string; to?: string } = {}) {
  const params: any[] = [];
  const clauses: string[] = [];
  if (opts.meetingId) {
    params.push(opts.meetingId);
    clauses.push(`mt.id = $${params.length}`);
  }
  if (opts.memberId) {
    params.push(opts.memberId);
    clauses.push(`a.member_id = $${params.length}`);
  }
  if (opts.from) {
    params.push(opts.from);
    clauses.push(`mt.meeting_date >= $${params.length}::date`);
  }
  if (opts.to) {
    params.push(opts.to);
    clauses.push(`mt.meeting_date <= $${params.length}::date`);
  }
  const w = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const [summary, byMember, byMeeting] = await Promise.all([
    one<any>(
      `SELECT count(*)::int AS records,
              count(*) FILTER (WHERE a.status = 'present')::int AS present,
              count(*) FILTER (WHERE a.status = 'absent')::int AS absent,
              count(*) FILTER (WHERE a.status = 'apology')::int AS apology,
              count(*) FILTER (WHERE a.status = 'late')::int AS late
         FROM attendance a JOIN meetings mt ON mt.id = a.meeting_id ${w}`,
      params,
    ),
    query<any>(
      `SELECT m.id, m.membership_no, m.full_name, c.name AS church_name,
              count(a.id)::int AS meetings,
              count(a.id) FILTER (WHERE a.status IN ('present','late'))::int AS attended,
              count(a.id) FILTER (WHERE a.status = 'apology')::int AS apologies,
              count(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
              round(100.0 * count(a.id) FILTER (WHERE a.status IN ('present','late')) / NULLIF(count(a.id),0), 1) AS attendance_pct
         FROM members m JOIN attendance a ON a.member_id = m.id JOIN meetings mt ON mt.id = a.meeting_id
         LEFT JOIN churches c ON c.id = m.church_id
         ${w} GROUP BY m.id, m.membership_no, m.full_name, c.name ORDER BY attendance_pct DESC NULLS LAST`,
      params,
    ),
    query<any>(
      `SELECT mt.id, mt.title, mt.meeting_type, mt.meeting_date, mt.venue,
              count(a.id)::int AS marked,
              count(a.id) FILTER (WHERE a.status IN ('present','late'))::int AS present,
              count(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
              count(a.id) FILTER (WHERE a.status = 'apology')::int AS apology
         FROM meetings mt LEFT JOIN attendance a ON a.meeting_id = mt.id ${w.replace('mt.id', 'mt.id')}
        GROUP BY mt.id ORDER BY mt.meeting_date DESC LIMIT 100`,
      params,
    ),
  ]);

  return { summary, byMember, byMeeting };
}

export { isoDate };

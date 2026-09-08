import 'server-only';
import type { PoolClient } from 'pg';
import { one, query, execute } from './db';
import { num, round2 } from './money';
import { sqlDate, toDate } from './dates';

export const INSURANCE_COMPANIES = [
  { code: 'JUB', name: 'Jubilee Insurance', country: 'Kenya' },
  { code: 'BRITAM', name: 'Britam Insurance', country: 'Kenya' },
  { code: 'CIC', name: 'CIC Insurance Group', country: 'Kenya' },
  { code: 'ICEA', name: 'ICEA LION Group', country: 'Kenya' },
  { code: 'MADISON', name: 'Madison General Insurance', country: 'Kenya' },
  { code: 'APA', name: 'APA Insurance', country: 'Kenya' },
  { code: 'UAP_OM', name: 'UAP Old Mutual', country: 'Kenya' },
  { code: 'GA', name: 'GA Insurance', country: 'Kenya' },
  { code: 'AAR', name: 'AAR Insurance', country: 'Kenya' },
  { code: 'PIONEER', name: 'Pioneer Assurance', country: 'Kenya' },
  { code: 'SANLAM', name: 'Sanlam Insurance', country: 'Kenya' },
  { code: 'LIBERTY', name: 'Liberty Life Assurance', country: 'Kenya' },
  { code: 'FIRST_ASSUR', name: 'First Assurance', country: 'Kenya' },
  { code: 'KENINDIA', name: 'Kenindia Assurance', country: 'Kenya' },
  { code: 'TAKAFUL', name: 'Takaful Insurance of Africa', country: 'Kenya' },
  { code: 'CORP', name: 'Corporate Insurance', country: 'Kenya' },
  { code: 'HERITAGE', name: 'Heritage Insurance', country: 'Kenya' },
  { code: 'OCCIDENTAL', name: 'Occidental Insurance', country: 'Kenya' },
  { code: 'AMACO', name: 'AMACO Insurance', country: 'Kenya' },
  { code: 'XPLICO', name: 'Xplico Insurance', country: 'Kenya' },
  { code: 'PRUDENTIAL', name: 'Prudential Life Assurance', country: 'UK' },
  { code: 'ALLIANZ', name: 'Allianz Insurance', country: 'Germany' },
  { code: 'AXA', name: 'AXA Insurance', country: 'France' },
  { code: 'METLIFE', name: 'MetLife', country: 'USA' },
  { code: 'AIG', name: 'AIG Insurance', country: 'USA' },
  { code: 'AVIVA', name: 'Aviva Insurance', country: 'UK' },
  { code: 'ZURICH', name: 'Zurich Insurance', country: 'Switzerland' },
  { code: 'OLD_MUTUAL', name: 'Old Mutual', country: 'South Africa' },
  { code: 'HOLARD', name: 'Hollard Insurance', country: 'South Africa' },
  { code: 'LEADWAY', name: 'Leadway Assurance', country: 'Nigeria' },
] as const;

export type InsuranceCompanyCode = typeof INSURANCE_COMPANIES[number]['code'];

// Last Respect Insurance: funeral and end-of-life expenses, immediate cash payouts
export const COVERAGE_TYPES = [
  { key: 'last_respect', label: 'Last Respect (Funeral Last Expense)' },
  { key: 'funeral', label: 'Funeral Cover' },
  { key: 'life', label: 'Life Assurance' },
  { key: 'personal_accident', label: 'Personal Accident' },
  { key: 'combined', label: 'Combined Last Respect + Life' },
] as const;

export const PREMIUM_FREQUENCIES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'semi_annual', label: 'Semi-Annual' },
  { key: 'annual', label: 'Annual' },
  { key: 'single', label: 'Single Premium' },
] as const;

export const BENEFICIARY_RELATIONSHIPS = [
  { key: 'spouse', label: 'Spouse' },
  { key: 'child', label: 'Child' },
  { key: 'parent', label: 'Parent' },
  { key: 'parent_in_law', label: 'Parent-in-Law' },
  { key: 'sibling', label: 'Sibling' },
  { key: 'next_of_kin', label: 'Next of Kin' },
  { key: 'other', label: 'Other' },
] as const;

export const DEPENDENT_RELATIONSHIPS = [
  { key: 'spouse', label: 'Spouse (18-65)' },
  { key: 'child', label: 'Child (1 month - 24y, 25y school-going)' },
  { key: 'parent', label: 'Parent' },
  { key: 'parent_in_law', label: 'Parent-in-Law' },
  { key: 'other', label: 'Other Dependent' },
] as const;

export const INSURANCE_STATUSES = [
  { key: 'draft', label: 'Draft' },
  { key: 'active', label: 'Active' },
  { key: 'lapsed', label: 'Lapsed' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'matured', label: 'Matured' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'expired', label: 'Expired' },
] as const;

export const COVERAGE_AMOUNTS = [
  { value: 50000, label: 'KSh 50,000' },
  { value: 100000, label: 'KSh 100,000' },
  { value: 150000, label: 'KSh 150,000' },
  { value: 200000, label: 'KSh 200,000' },
  { value: 300000, label: 'KSh 300,000' },
  { value: 500000, label: 'KSh 500,000' },
] as const;

export async function listInsuranceCompanies(client?: PoolClient) {
  return query<any>('SELECT * FROM insurance_companies WHERE active = TRUE ORDER BY name', [], client);
}

export async function nextPolicyNumber(prefix = 'LR'): Promise<string> {
  const year = new Date().getFullYear();
  const row = await one<{ c: number }>('SELECT count(*)::int AS c FROM last_respect_insurances WHERE policy_no LIKE $1', [`${prefix}/${year}/%`]);
  return `${prefix}/${year}/${String((row?.c ?? 0) + 1).padStart(4, '0')}`;
}

export async function listInsurances(filters: {
  memberId?: number | null;
  companyId?: number | null;
  parishId?: number | null;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const clauses: string[] = ['1=1'];
  const params: any[] = [];
  const add = (sql: string, value: any) => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.memberId) add('i.member_id = ?', filters.memberId);
  if (filters.companyId) add('i.insurance_company_id = ?', filters.companyId);
  if (filters.parishId) add('i.parish_id = ?', filters.parishId);
  if (filters.status) add('i.status = ?', filters.status);
  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(`(i.policy_no ILIKE $${params.length} OR m.full_name ILIKE $${params.length} OR m.membership_no ILIKE $${params.length} OR i.insurance_company_name ILIKE $${params.length} OR i.beneficiary_name ILIKE $${params.length})`);
  }
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const rows = await query<any>(
    `SELECT i.*, m.full_name, m.membership_no, m.phone, c.name AS company_name, c.logo_url, p.name AS parish_name
       FROM last_respect_insurances i
       JOIN members m ON m.id = i.member_id
       JOIN insurance_companies c ON c.id = i.insurance_company_id
       LEFT JOIN parishes p ON p.id = i.parish_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY i.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = await one<{ c: number }>(
    `SELECT count(*)::int AS c FROM last_respect_insurances i JOIN members m ON m.id = i.member_id WHERE ${clauses.join(' AND ')}`,
    params,
  );
  return { rows, total: Number(total?.c ?? 0) };
}

export async function getInsurance(id: number, client?: PoolClient) {
  const policy = await one<any>(
    `SELECT i.*, m.full_name, m.membership_no, m.phone, m.photo_url, m.date_of_birth, c.name AS company_name, c.phone AS company_phone, c.email AS company_email, p.name AS parish_name
       FROM last_respect_insurances i
       JOIN members m ON m.id = i.member_id
       JOIN insurance_companies c ON c.id = i.insurance_company_id
       LEFT JOIN parishes p ON p.id = i.parish_id
      WHERE i.id = $1`,
    [id],
    client,
  );
  if (!policy) return null;
  const dependents = await query<any>('SELECT * FROM insurance_dependents WHERE insurance_id = $1 ORDER BY relationship, full_name', [id], client);
  const premiums = await query<any>('SELECT * FROM insurance_premium_payments WHERE insurance_id = $1 ORDER BY paid_at DESC LIMIT 20', [id], client);
  return { ...policy, dependents, premiums };
}

export async function createInsurance(input: {
  memberId: number;
  insuranceCompanyId: number;
  coverageType?: string;
  coverageAmount: number;
  premiumAmount: number;
  premiumFrequency?: string;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  beneficiaryName: string;
  beneficiaryRelationship?: string;
  beneficiaryPhone?: string | null;
  beneficiaryIdNo?: string | null;
  coversSpouse?: boolean;
  spouseName?: string | null;
  spouseDob?: string | Date | null;
  spouseCoverageAmount?: number | null;
  coversChildren?: boolean;
  childrenCount?: number | null;
  childrenCoverageAmount?: number | null;
  coversParents?: boolean;
  parentsCount?: number | null;
  parentsCoverageAmount?: number | null;
  causeOfDeathCovered?: string;
  notes?: string | null;
  parishId?: number | null;
  createdBy?: number | null;
  dependents?: { relationship: string; full_name: string; dob?: string | Date | null; id_no?: string | null; coverage_amount?: number | null; is_school_going?: boolean }[];
}) {
  if (input.coverageAmount < 50000 || input.coverageAmount > 500000) {
    throw new Error('Coverage amount must be between KSh 50,000 and 500,000.');
  }
  const company = await one<any>('SELECT * FROM insurance_companies WHERE id = $1', [input.insuranceCompanyId]);
  if (!company) throw new Error('Insurance company not found.');
  const member = await one<any>('SELECT * FROM members WHERE id = $1', [input.memberId]);
  if (!member) throw new Error('Member not found.');

  const policyNo = await nextPolicyNumber();
  const startDate = toDate(input.startDate) || new Date();
  const nextDue = new Date(startDate);
  if ((input.premiumFrequency || 'monthly') === 'monthly') nextDue.setMonth(nextDue.getMonth() + 1);
  else if (input.premiumFrequency === 'quarterly') nextDue.setMonth(nextDue.getMonth() + 3);
  else if (input.premiumFrequency === 'semi_annual') nextDue.setMonth(nextDue.getMonth() + 6);
  else if (input.premiumFrequency === 'annual') nextDue.setFullYear(nextDue.getFullYear() + 1);

  // Principal age validation 18-65
  let principalAge: number | null = null;
  if (member.date_of_birth) {
    const dob = new Date(member.date_of_birth);
    principalAge = new Date().getFullYear() - dob.getFullYear();
  }

  const row = await one<any>(
    `INSERT INTO last_respect_insurances
      (policy_no, member_id, insurance_company_id, insurance_company_name, coverage_type, coverage_amount, premium_amount, premium_frequency, start_date, end_date, beneficiary_name, beneficiary_relationship, beneficiary_phone, beneficiary_id_no, insured_name, insured_dob, principal_dob, principal_age, covers_spouse, spouse_name, spouse_dob, spouse_coverage_amount, covers_children, children_count, children_coverage_amount, covers_parents, parents_count, parents_coverage_amount, cause_of_death_covered, waiting_period_days, payout_timeline_hours, next_premium_due, parish_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
     RETURNING *`,
    [
      policyNo,
      input.memberId,
      input.insuranceCompanyId,
      company.name,
      input.coverageType || 'last_respect',
      round2(num(input.coverageAmount)),
      round2(num(input.premiumAmount)),
      input.premiumFrequency || 'monthly',
      sqlDate(startDate),
      input.endDate ? sqlDate(input.endDate) : null,
      input.beneficiaryName,
      input.beneficiaryRelationship || 'spouse',
      input.beneficiaryPhone || null,
      input.beneficiaryIdNo || null,
      member.full_name,
      member.date_of_birth ? sqlDate(member.date_of_birth) : null,
      member.date_of_birth ? sqlDate(member.date_of_birth) : null,
      principalAge,
      Boolean(input.coversSpouse),
      input.spouseName || null,
      input.spouseDob ? sqlDate(input.spouseDob) : null,
      input.spouseCoverageAmount ? round2(num(input.spouseCoverageAmount)) : null,
      Boolean(input.coversChildren),
      input.childrenCount || 0,
      input.childrenCoverageAmount ? round2(num(input.childrenCoverageAmount)) : null,
      Boolean(input.coversParents),
      input.parentsCount || 0,
      input.parentsCoverageAmount ? round2(num(input.parentsCoverageAmount)) : null,
      input.causeOfDeathCovered || 'illness_and_accident',
      90, // waiting period for illness
      48, // payout within 48 hours
      sqlDate(nextDue),
      input.parishId || member.parish_id,
      input.notes || null,
      input.createdBy || null,
    ],
  );

  if (input.dependents && input.dependents.length) {
    for (const d of input.dependents) {
      await execute(
        `INSERT INTO insurance_dependents (insurance_id, member_id, relationship, full_name, dob, id_no, coverage_amount, is_school_going)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          row.id,
          input.memberId,
          d.relationship,
          d.full_name,
          d.dob ? sqlDate(d.dob) : null,
          d.id_no || null,
          d.coverage_amount ? round2(num(d.coverage_amount)) : 50000,
          Boolean(d.is_school_going),
        ],
      );
    }
  }

  return row;
}

export async function updateInsuranceStatus(id: number, status: string, opts: { claimReference?: string | null; notes?: string | null; updatedBy?: number | null } = {}) {
  const row = await one<any>('SELECT * FROM last_respect_insurances WHERE id = $1', [id]);
  if (!row) throw new Error('Insurance policy not found.');
  await execute(
    `UPDATE last_respect_insurances SET status = $2, claim_reference = COALESCE($3, claim_reference), notes = COALESCE($4, notes), updated_by = $5 WHERE id = $1`,
    [id, status, opts.claimReference || null, opts.notes || null, opts.updatedBy || null],
  );
  return { ok: true };
}

export async function fileClaim(id: number, input: {
  dateOfDeath: string | Date;
  claimAmount?: number | null;
  claimReference?: string | null;
  notes?: string | null;
  filedBy?: number | null;
}) {
  const policy = await one<any>('SELECT * FROM last_respect_insurances WHERE id = $1', [id]);
  if (!policy) throw new Error('Policy not found.');
  if (policy.status === 'claimed') throw new Error('Claim already filed for this policy.');

  await execute(
    `UPDATE last_respect_insurances
        SET date_of_death = $2,
            date_claim_filed = CURRENT_DATE,
            claim_amount = COALESCE($3, coverage_amount),
            claim_status = 'pending',
            claim_reference = COALESCE($4, claim_reference),
            status = 'claimed',
            notes = COALESCE($5, notes),
            updated_by = $6
      WHERE id = $1`,
    [id, sqlDate(input.dateOfDeath), input.claimAmount ? round2(num(input.claimAmount)) : null, input.claimReference || null, input.notes || null, input.filedBy || null],
  );
  return { ok: true };
}

export async function memberInsuranceSummary(memberId: number) {
  const rows = await query<any>('SELECT * FROM last_respect_insurances WHERE member_id = $1 ORDER BY created_at DESC', [memberId]);
  const totalCoverage = rows.reduce((a, r) => a + num(r.coverage_amount), 0);
  const totalPremiumPaid = rows.reduce((a, r) => a + num(r.total_premiums_paid), 0);
  const active = rows.filter((r) => r.status === 'active').length;
  return { policies: rows, total_coverage: round2(totalCoverage), total_premiums_paid: round2(totalPremiumPaid), active_count: active };
}

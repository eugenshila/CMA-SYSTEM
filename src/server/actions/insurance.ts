'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { createInsurance, fileClaim, updateInsuranceStatus, nextPolicyNumber } from '@/lib/insurance';
import { one, execute } from '@/lib/db';
import { num, round2 } from '@/lib/money';
import { sqlDate } from '@/lib/dates';
import type { ActionResult } from './auth';

function revalidateInsurance(id?: number) {
  revalidatePath('/insurance');
  if (id) revalidatePath(`/insurance/${id}`);
  revalidatePath('/dashboard');
}

export async function createInsuranceAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'insurance.create')) return { ok: false, error: 'No permission to create insurance.' };

  const memberId = Number(formData.get('member_id'));
  const parishId = Number(formData.get('parish_id')) || null;
  const companyId = Number(formData.get('insurance_company_id'));
  const coverageType = String(formData.get('coverage_type') || 'last_respect');
  const coverageAmount = Number(formData.get('coverage_amount'));
  const premiumAmount = Number(formData.get('premium_amount'));
  const premiumFrequency = String(formData.get('premium_frequency') || 'monthly');
  const beneficiaryName = String(formData.get('beneficiary_name') || '').trim();
  const beneficiaryRelationship = String(formData.get('beneficiary_relationship') || 'spouse');
  const beneficiaryPhone = String(formData.get('beneficiary_phone') || '').trim() || null;
  const beneficiaryIdNo = String(formData.get('beneficiary_id_no') || '').trim() || null;
  const startDate = String(formData.get('start_date') || '').trim() || null;
  const cause = String(formData.get('cause_of_death_covered') || 'illness_and_accident');
  const notes = String(formData.get('notes') || '').trim() || null;

  const coversSpouse = formData.get('covers_spouse') === 'on' || formData.get('covers_spouse') === 'true';
  const coversChildren = formData.get('covers_children') === 'on' || formData.get('covers_children') === 'true';
  const coversParents = formData.get('covers_parents') === 'on' || formData.get('covers_parents') === 'true';

  const spouseName = String(formData.get('spouse_name') || '').trim() || null;
  const spouseDob = String(formData.get('spouse_dob') || '').trim() || null;
  const spouseCoverage = Number(formData.get('spouse_coverage_amount') || 0) || null;
  const childrenCount = Number(formData.get('children_count') || 0) || null;
  const childrenCoverage = Number(formData.get('children_coverage_amount') || 0) || null;
  const parentsCount = Number(formData.get('parents_count') || 0) || null;
  const parentsCoverage = Number(formData.get('parents_coverage_amount') || 0) || null;

  if (!memberId) return { ok: false, error: 'Select a member (principal).' };
  if (!companyId) return { ok: false, error: 'Select insurance company.' };
  if (!beneficiaryName) return { ok: false, error: 'Beneficiary name is required for immediate cash payout.' };
  if (!coverageAmount || coverageAmount < 50000 || coverageAmount > 500000) return { ok: false, error: 'Coverage must be KSh 50,000–500,000.' };
  if (!premiumAmount || premiumAmount < 100) return { ok: false, error: 'Premium amount required.' };

  const depCount = Number(formData.get('dependents_count') || 0);
  const dependents: any[] = [];
  for (let i = 0; i < depCount; i++) {
    const fullName = String(formData.get(`dep_${i}_full_name`) || '').trim();
    if (!fullName) continue;
    const rel = String(formData.get(`dep_${i}_relationship`) || 'child');
    const dob = String(formData.get(`dep_${i}_dob`) || '').trim() || null;
    const cov = Number(formData.get(`dep_${i}_coverage_amount`) || 50000);
    const school = formData.get(`dep_${i}_is_school_going`) === 'on';
    dependents.push({ relationship: rel, full_name: fullName, dob, coverage_amount: cov, is_school_going: school });
  }

  try {
    const policy = await createInsurance({
      memberId,
      insuranceCompanyId: companyId,
      coverageType,
      coverageAmount,
      premiumAmount,
      premiumFrequency,
      startDate,
      beneficiaryName,
      beneficiaryRelationship,
      beneficiaryPhone,
      beneficiaryIdNo,
      coversSpouse,
      spouseName,
      spouseDob,
      spouseCoverageAmount: spouseCoverage,
      coversChildren,
      childrenCount,
      childrenCoverageAmount: childrenCoverage,
      coversParents,
      parentsCount,
      parentsCoverageAmount: parentsCoverage,
      causeOfDeathCovered: cause,
      notes,
      parishId,
      createdBy: user.id,
      dependents,
    });

    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'insurance.created',
      entityType: 'last_respect_insurances',
      entityId: policy.id,
      entityLabel: policy.policy_no,
      description: `Created Last Respect insurance ${policy.policy_no} for member ${memberId} — ${coverageAmount} coverage, beneficiary ${beneficiaryName}, payout 48h`,
      newValues: { policy_no: policy.policy_no, coverage_amount: coverageAmount },
    });

    revalidateInsurance(policy.id);
    return { ok: true, message: `Insurance policy ${policy.policy_no} created — KSh ${coverageAmount.toLocaleString()} coverage, beneficiary ${beneficiaryName}, 48h payout.`, data: { id: policy.id } };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to create insurance policy.' };
  }
}

export async function fileInsuranceClaimAction(id: number, input: { date_of_death: string; claim_reference?: string; notes?: string }): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'insurance.approve')) return { ok: false, error: 'No permission to file claims.' };
  if (!input.date_of_death) return { ok: false, error: 'Date of death required.' };
  try {
    await fileClaim(id, { dateOfDeath: input.date_of_death, claimReference: input.claim_reference, notes: input.notes, filedBy: user.id });
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'insurance.claim_filed',
      entityType: 'last_respect_insurances',
      entityId: id,
      description: `Filed claim for policy ${id} — death ${input.date_of_death}, 48h payout expected`,
    });
    revalidateInsurance(id);
    return { ok: true, message: 'Claim filed — beneficiary will receive immediate cash payout within 48 hours.' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to file claim.' };
  }
}

export async function updateInsuranceStatusAction(id: number, status: string, opts: { notes?: string } = {}): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user, 'insurance.update')) return { ok: false, error: 'No permission to update insurance.' };
  try {
    await updateInsuranceStatus(id, status, { notes: opts.notes, updatedBy: user.id });
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'insurance.status_updated',
      entityType: 'last_respect_insurances',
      entityId: id,
      description: `Insurance status updated to ${status}`,
    });
    revalidateInsurance(id);
    return { ok: true, message: `Status updated to ${status}.` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to update status.' };
  }
}

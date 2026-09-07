import { z } from 'zod';

export const phoneSchema = z
  .string()
  .trim()
  .min(9, 'Enter a valid phone number')
  .regex(/^[0-9+\s()-]+$/, 'Enter a valid phone number');

export const emailSchema = z.union([z.literal(''), z.string().trim().email('Enter a valid email address')]);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const memberSchema = z.object({
  salutation: z.string().trim().optional().or(z.literal('')),
  first_name: z.string().trim().min(2, 'First name is required'),
  middle_name: z.string().trim().optional().or(z.literal('')),
  last_name: z.string().trim().min(2, 'Last/surname is required'),
  membership_no: z.string().trim().min(3, 'CMA membership number is required').optional().or(z.literal('')),
  national_id: z.string().trim().min(5, 'National ID or passport number is required').optional().or(z.literal('')),
  document_type: z.enum(['national_id', 'passport']).default('national_id'),
  phone: phoneSchema,
  alt_phone: z.string().trim().optional().or(z.literal('')),
  email: emailSchema.optional().or(z.literal('')),
  date_of_birth: z.string().trim().optional().or(z.literal('')),
  gender: z.enum(['male', 'female', 'other']).default('male'),
  parish_id: z.coerce.number().int().positive('Select a parish'),
  church_id: z.coerce.number().int().optional().nullable(),
  scc_id: z.coerce.number().int().optional().nullable(),
  date_joined: z.string().trim().min(4, 'Date joined CMA is required'),
  membership_status: z
    .enum(['active', 'inactive', 'suspended', 'transferred', 'deceased', 'resigned', 'pending'])
    .default('active'),
  membership_type: z.enum(['full', 'associate', 'honorary']).default('full'),
  marital_status: z.enum(['single', 'married', 'widowed', 'separated', 'divorced']).default('single'),
  occupation: z.string().trim().optional().or(z.literal('')),
  employer: z.string().trim().optional().or(z.literal('')),
  residential_area: z.string().trim().optional().or(z.literal('')),
  kra_pin: z.string().trim().optional().or(z.literal('')),
  baptism_date: z.string().trim().optional().or(z.literal('')),
  next_of_kin: z.string().trim().optional().or(z.literal('')),
  next_of_kin_relation: z.string().trim().optional().or(z.literal('')),
  next_of_kin_phone: z.string().trim().optional().or(z.literal('')),
  emergency_contact: z.string().trim().optional().or(z.literal('')),
  emergency_contact_rel: z.string().trim().optional().or(z.literal('')),
  emergency_contact_phone: z.string().trim().optional().or(z.literal('')),
  exempt_monthly: z.coerce.boolean().optional(),
  exemption_reason: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().optional().or(z.literal('')),
});

export const caseSchema = z.object({
  member_id: z.coerce.number().int().positive('Select the CMA member'),
  amount_per_member: z.coerce.number().min(0, 'Amount per member must be zero or more'),
  deadline: z.string().trim().optional().or(z.literal('')),
  scope_type: z.enum(['parish', 'church', 'scc', 'diocese', 'all']).default('parish'),
  notes: z.string().trim().optional().or(z.literal('')),
});

export const welfareCaseSchema = caseSchema.extend({
  category: z
    .enum(['sickness', 'hospitalisation', 'surgery', 'maternity', 'accident', 'disaster', 'education', 'bereavement', 'other'])
    .default('sickness'),
  nature_of_assistance: z.string().trim().min(3, 'Describe the nature of assistance'),
  hospital: z.string().trim().optional().or(z.literal('')),
  ward: z.string().trim().optional().or(z.literal('')),
  admission_date: z.string().trim().optional().or(z.literal('')),
  target_amount: z.coerce.number().min(0).default(0),
  opening_date: z.string().trim().min(4, 'Opening date is required'),
  beneficiary_name: z.string().trim().optional().or(z.literal('')),
  beneficiary_relationship: z.string().trim().optional().or(z.literal('')),
});

export const funeralCaseSchema = caseSchema.extend({
  deceased_name: z.string().trim().min(2, 'Name of the deceased is required'),
  relationship: z.enum(['member', 'spouse', 'child', 'parent', 'sibling', 'grandparent', 'other_dependant', 'other']),
  relationship_other: z.string().trim().optional().or(z.literal('')),
  date_of_death: z.string().trim().min(4, 'Date of death is required'),
  funeral_date: z.string().trim().optional().or(z.literal('')),
  burial_place: z.string().trim().optional().or(z.literal('')),
  mortuary: z.string().trim().optional().or(z.literal('')),
  in_kind_support: z.string().trim().optional().or(z.literal('')),
});

export const weddingCaseSchema = caseSchema.extend({
  spouse_name: z.string().trim().optional().or(z.literal('')),
  wedding_date: z.string().trim().min(4, 'Wedding date is required'),
  venue: z.string().trim().optional().or(z.literal('')),
  target_amount: z.coerce.number().min(0).default(0),
});

export const projectSchema = caseSchema.extend({
  name: z.string().trim().min(3, 'Project name is required'),
  category: z.string().trim().min(2, 'Select a category'),
  description: z.string().trim().optional().or(z.literal('')),
  target_amount: z.coerce.number().min(0).default(0),
  start_date: z.string().trim().min(4, 'Start date is required'),
  event_date: z.string().trim().optional().or(z.literal('')),
  committee: z.string().trim().optional().or(z.literal('')),
});

export const paymentSchema = z.object({
  member_id: z.coerce.number().int().positive('Select a member'),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  method: z.enum(['mpesa', 'airtel', 'bank', 'cash', 'cheque', 'card', 'manual']),
  payment_date: z.string().trim().min(4, 'Payment date is required'),
  reference: z.string().trim().optional().or(z.literal('')),
  transaction_id: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().optional().or(z.literal('')),
  allocations: z
    .array(
      z.object({
        type: z.enum([
          'monthly_contribution',
          'welfare',
          'funeral',
          'wedding',
          'project',
          'savings',
          'shares',
          'loan',
          'penalty',
          'fee',
          'donation',
          'other',
        ]),
        amount: z.coerce.number().min(0),
        referenceId: z.coerce.number().int().optional().nullable(),
        period: z.string().trim().optional().nullable(),
        shares: z.coerce.number().int().optional().nullable(),
        note: z.string().trim().optional().nullable(),
      }),
    )
    .min(1, 'Add at least one allocation'),
});

export const loanApplicationSchema = z.object({
  member_id: z.coerce.number().int().positive(),
  loan_type_id: z.coerce.number().int().positive('Select a loan product'),
  amount: z.coerce.number().positive('Enter the amount requested'),
  months: z.coerce.number().int().min(1).max(60, 'Repayment period must be 1–60 months'),
  purpose: z.string().trim().min(5, 'Describe the purpose of the loan'),
  guarantors: z.array(z.coerce.number().int()).optional(),
});

export const loanTypeSchema = z.object({
  id: z.coerce.number().int().optional(),
  code: z.string().trim().min(2).max(16),
  name: z.string().trim().min(3),
  description: z.string().trim().optional().or(z.literal('')),
  min_amount: z.coerce.number().min(0),
  max_amount: z.coerce.number().positive(),
  interest_rate: z.coerce.number().min(0).max(50),
  interest_period: z.enum(['monthly', 'annual', 'daily']).default('monthly'),
  interest_method: z.enum(['flat', 'reducing', 'straight', 'amortised']).default('reducing'),
  max_repayment_months: z.coerce.number().int().min(1),
  min_repayment_months: z.coerce.number().int().min(1),
  min_savings_required: z.coerce.number().min(0).default(0),
  savings_multiplier: z.coerce.number().min(0).default(3),
  min_shares_required: z.coerce.number().int().min(0).default(0),
  shares_multiplier: z.coerce.number().min(0).default(0),
  guarantors_required: z.coerce.number().int().min(0).default(2),
  processing_fee_pct: z.coerce.number().min(0).default(1),
  processing_fee_fixed: z.coerce.number().min(0).default(0),
  penalty_rate_pct: z.coerce.number().min(0).default(0),
  penalty_fixed: z.coerce.number().min(0).default(0),
  grace_days: z.coerce.number().int().min(0).default(0),
  min_membership_months: z.coerce.number().int().min(0).default(0),
  max_active_loans: z.coerce.number().int().min(1).default(1),
  requires_collateral: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
});

export const meetingSchema = z.object({
  title: z.string().trim().min(3, 'Meeting title is required'),
  meeting_type: z.string().trim().min(2),
  meeting_date: z.string().trim().min(4, 'Meeting date is required'),
  start_time: z.string().trim().optional().or(z.literal('')),
  end_time: z.string().trim().optional().or(z.literal('')),
  venue: z.string().trim().optional().or(z.literal('')),
  parish_id: z.coerce.number().int().optional().nullable(),
  church_id: z.coerce.number().int().optional().nullable(),
  chairperson: z.string().trim().optional().or(z.literal('')),
  secretary: z.string().trim().optional().or(z.literal('')),
  agenda: z.string().trim().optional().or(z.literal('')),
  attendance_open: z.coerce.boolean().optional(),
});

export const userSchema = z.object({
  id: z.coerce.number().int().optional(),
  name: z.string().trim().min(3, 'Full name is required'),
  email: emailSchema.optional().or(z.literal('')),
  phone: phoneSchema.optional().or(z.literal('')),
  role_key: z.string().trim().min(2, 'Select a role'),
  member_id: z.coerce.number().int().optional().nullable(),
  scope_parish_id: z.coerce.number().int().optional().nullable(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional().or(z.literal('')),
  status: z.enum(['active', 'invited', 'suspended', 'locked', 'disabled']).default('active'),
});

export function firstError(result: z.SafeParseReturnType<any, any>): string | null {
  if (result.success) return null;
  const issue = result.error.issues[0];
  return issue ? `${issue.message}` : 'Please correct the highlighted fields.';
}

/** Convert FormData into a plain object (arrays for repeated keys). */
export function formDataToObject(fd: FormData): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of fd.entries()) {
    if (key.endsWith('[]')) {
      const k = key.slice(0, -2);
      out[k] = [...(out[k] || []), value];
    } else if (key in out) {
      out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

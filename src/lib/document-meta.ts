/**
 * Shared document metadata — intentionally NOT a 'use client' module so both
 * server components (pages) and client components (forms) can import the plain
 * arrays. Importing constants from a 'use client' module into a server
 * component yields a client-reference proxy, not the value.
 */
export const DOC_TYPES: { value: string; label: string }[] = [
  { value: 'national_id', label: 'National ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'membership_card', label: 'Membership card' },
  { value: 'photo', label: 'Passport photo' },
  { value: 'birth_certificate', label: 'Birth certificate' },
  { value: 'baptism_certificate', label: 'Baptism certificate' },
  { value: 'marriage_certificate', label: 'Marriage certificate' },
  { value: 'title_deed', label: 'Title deed' },
  { value: 'payslip', label: 'Payslip' },
  { value: 'bank_statement', label: 'Bank statement' },
  { value: 'recommendation', label: 'Recommendation letter' },
  { value: 'other', label: 'Other' },
];

export const DOC_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  DOC_TYPES.map((t) => [t.value, t.label]),
);

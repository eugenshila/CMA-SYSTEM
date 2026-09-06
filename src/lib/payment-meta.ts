/**
 * Shared, framework-free payment metadata.
 *
 * Kept out of `server-only` modules and out of client components so that both
 * server components and client components can import the exact same lists
 * (importing a plain array from a `'use client'` module into a server component
 * yields a client reference, not the value).
 */

export const PAYMENT_METHODS = [
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'airtel', label: 'Airtel Money' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'manual', label: 'Manual / other' },
];

export const ALLOCATION_TYPES = [
  { value: 'monthly_contribution', label: 'Monthly CMA contribution' },
  { value: 'welfare', label: 'Welfare case' },
  { value: 'funeral', label: 'Funeral contribution' },
  { value: 'wedding', label: 'Wedding contribution' },
  { value: 'project', label: 'Special project' },
  { value: 'savings', label: 'SDP / Sacco savings' },
  { value: 'shares', label: 'Share purchase' },
  { value: 'loan', label: 'Loan repayment' },
  { value: 'penalty', label: 'Penalty' },
  { value: 'fee', label: 'Fee' },
  { value: 'donation', label: 'Donation' },
  { value: 'other', label: 'Other' },
];

export const PAYMENT_STATUSES = [
  { value: 'completed', label: 'Completed' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
  { value: 'reversed', label: 'Reversed' },
];

export function allocationLabel(type: string): string {
  return ALLOCATION_TYPES.find((a) => a.value === type)?.label || type.replace(/_/g, ' ');
}

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label || method;
}

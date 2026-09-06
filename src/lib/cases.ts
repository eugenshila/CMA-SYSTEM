import type { CaseType } from './contributions';

export const CASE_META: Record<
  CaseType,
  { label: string; plural: string; route: string; permission: string; newLabel: string }
> = {
  welfare: { label: 'Welfare case', plural: 'Welfare & hospitalisation', route: '/welfare', permission: 'welfare', newLabel: 'New welfare case' },
  funeral: { label: 'Funeral case', plural: 'Funeral contributions', route: '/funerals', permission: 'funerals', newLabel: 'New funeral case' },
  wedding: { label: 'Wedding case', plural: 'Wedding contributions', route: '/weddings', permission: 'weddings', newLabel: 'New wedding case' },
  project: { label: 'Special project', plural: 'Special projects', route: '/projects', permission: 'projects', newLabel: 'New project' },
};

export const WELFARE_CATEGORIES = [
  { key: 'sickness', label: 'Sickness' },
  { key: 'hospitalisation', label: 'Hospitalisation' },
  { key: 'surgery', label: 'Surgery' },
  { key: 'maternity', label: 'Maternity' },
  { key: 'accident', label: 'Accident' },
  { key: 'disaster', label: 'Disaster / emergency' },
  { key: 'education', label: 'Education support' },
  { key: 'bereavement', label: 'Bereavement' },
  { key: 'other', label: 'Other' },
];

export const FUNERAL_RELATIONSHIPS = [
  { key: 'member', label: 'The member' },
  { key: 'spouse', label: 'Spouse' },
  { key: 'child', label: 'Child' },
  { key: 'parent', label: 'Parent' },
  { key: 'sibling', label: 'Sibling' },
  { key: 'grandparent', label: 'Grandparent' },
  { key: 'other_dependant', label: 'Other dependant' },
  { key: 'other', label: 'Other (specify)' },
];

export const CASE_STATUSES = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'disbursed', label: 'Disbursed' },
  { key: 'closed', label: 'Closed' },
];

export function caseStatusTone(status: string): string {
  if (status === 'open') return 'badge badge-blue';
  if (status === 'in_progress') return 'badge badge-gold';
  if (status === 'disbursed') return 'badge badge-navy';
  if (status === 'completed') return 'badge badge-green';
  if (status === 'cancelled') return 'badge badge-red';
  return 'badge badge-grey';
}

export function caseLabel(status: string) {
  return CASE_STATUSES.find((s) => s.key === status)?.label || status.replace(/_/g, ' ');
}

/** Human-readable title for any case row. */
export function caseTitle(type: CaseType, row: any): string {
  if (type === 'welfare') return `${row.beneficiary_name || row.full_name || 'Member'} — ${row.category}`;
  if (type === 'funeral') return `${row.deceased_name} (${row.relationship?.replace(/_/g, ' ')})`;
  if (type === 'wedding') return row.spouse_name ? `Wedding of ${row.full_name} & ${row.spouse_name}` : `Wedding of ${row.full_name}`;
  return row.name;
}

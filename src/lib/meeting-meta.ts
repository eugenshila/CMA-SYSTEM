/**
 * Shared meeting metadata — intentionally NOT a 'use client' module so both
 * server components (pages) and client components (forms) can import the plain
 * arrays without hitting the client-reference proxy problem.
 */
export const MEETING_TYPES: { value: string; label: string }[] = [
  { value: 'monthly', label: 'Monthly meeting' },
  { value: 'general_assembly', label: 'General assembly' },
  { value: 'committee', label: 'Committee' },
  { value: 'executive', label: 'Executive' },
  { value: 'deanery', label: 'Deanery' },
  { value: 'diocesan', label: 'Diocesan' },
  { value: 'national', label: 'National' },
  { value: 'retreat', label: 'Retreat' },
  { value: 'training', label: 'Training' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'other', label: 'Other' },
];

export const MEETING_STATUSES: { value: string; label: string }[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const ATTENDANCE_STATUSES: { value: string; label: string }[] = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'apology', label: 'Apology' },
  { value: 'absent', label: 'Absent' },
];

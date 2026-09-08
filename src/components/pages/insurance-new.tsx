import { redirect } from 'next/navigation';
import { ShieldPlus } from 'lucide-react';
import { Card, CardHeader, SectionHeading } from '../ui/primitives';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { query } from '@/lib/db';
import InsuranceForm from '../forms/insurance-form';

export default async function InsuranceNewPage({ user }: { user: SessionUser }) {
  if (!can(user, 'insurance.create')) redirect('/insurance');

  const [companies, parishes, members] = await Promise.all([
    query<any>('SELECT id, name FROM insurance_companies WHERE active = TRUE ORDER BY name'),
    query<any>('SELECT id, name FROM parishes WHERE active = TRUE ORDER BY id'),
    query<any>(`SELECT id, full_name, membership_no, parish_id FROM members WHERE deleted_at IS NULL AND membership_status='active' ORDER BY membership_no LIMIT 300`),
  ]);

  return (
    <div className="space-y-5 max-w-5xl">
      <SectionHeading title="New Last Respect Insurance" subtitle="Coverage KSh 50k-500k, principal 18-65, children 1 month-24y (25 school-going), parents, spouse. Payout within 48h for illness & accident." />

      <Card>
        <CardHeader title="Policy details" icon={<ShieldPlus className="h-5 w-5" />} subtitle="Select member, insurance company, coverage, beneficiary and dependents." />
        <InsuranceForm companies={companies} parishes={parishes} members={members} />
      </Card>

      <Card>
        <div className="text-sm text-slate-600 space-y-2">
          <p><strong>Key Features:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Coverage Amounts: KSh 50,000–500,000 depending on provider and plan.</li>
            <li>Eligibility: Principal 18–65, spouse, children 1 month–24 years (25 if school-going), parents/parents-in-law.</li>
            <li>Dependents: Multiple family members can be covered for comprehensive protection.</li>
            <li>Payout: Within 48 hours of claim submission.</li>
            <li>Cause of Death: Illness and accidents (waiting period for illness).</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

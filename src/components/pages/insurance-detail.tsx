import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldPlus, User, Building2, Wallet, Clock, HeartHandshake, Users } from 'lucide-react';
import { Badge, Card, CardHeader, KeyValue, SectionHeading, Table, Td, Th } from '../ui/primitives';
import { can } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';
import { getInsurance } from '@/lib/insurance';
import { money, num } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import InsuranceActions from '../forms/insurance-actions';

export default async function InsuranceDetailPage({ user, id }: { user: SessionUser; id: number }) {
  if (!can(user, 'insurance.view')) redirect('/insurance');
  const policy = await getInsurance(id);
  if (!policy) redirect('/insurance');

  if (user.scope_parish_id && policy.parish_id && Number(policy.parish_id) !== Number(user.scope_parish_id)) {
    redirect('/insurance');
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <SectionHeading
        title={`${policy.policy_no} — Last Respect Insurance`}
        subtitle={`${policy.full_name} (${policy.membership_no}) · ${policy.company_name} · ${policy.parish_name || 'Parish'}`}
        action={
          <div className="flex gap-2">
            <Link href="/insurance" className="btn btn-outline btn-sm">Back to list</Link>
            <Link href={`/members/${policy.member_id}`} className="btn btn-outline btn-sm">Member profile</Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Policy overview" icon={<ShieldPlus className="h-5 w-5" />} />
          <KeyValue
            columns={2}
            items={[
              ['Policy No', policy.policy_no],
              ['Status', policy.status],
              ['Coverage Type', policy.coverage_type],
              ['Coverage Amount', money(num(policy.coverage_amount))],
              ['Premium', `${money(num(policy.premium_amount))} / ${policy.premium_frequency}`],
              ['Company', policy.company_name],
              ['Parish', policy.parish_name || '—'],
              ['Start Date', fmtDate(policy.start_date)],
              ['Next Due', policy.next_premium_due ? fmtDate(policy.next_premium_due) : '—'],
              ['Total Premiums Paid', money(num(policy.total_premiums_paid))],
              ['Cause Covered', policy.cause_of_death_covered],
              ['Waiting Period', `${policy.waiting_period_days} days (illness)`],
              ['Payout Timeline', `${policy.payout_timeline_hours} hours`],
            ]}
          />
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Beneficiary — Immediate cash payout" icon={<HeartHandshake className="h-5 w-5" />} />
            <KeyValue
              items={[
                ['Name', policy.beneficiary_name],
                ['Relationship', policy.beneficiary_relationship],
                ['Phone', policy.beneficiary_phone || '—'],
                ['ID No', policy.beneficiary_id_no || '—'],
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Principal (Insured)" icon={<User className="h-5 w-5" />} />
            <KeyValue
              items={[
                ['Name', policy.insured_name || policy.full_name],
                ['DOB', policy.insured_dob ? fmtDate(policy.insured_dob) : policy.date_of_birth ? fmtDate(policy.date_of_birth) : '—'],
                ['Age', policy.principal_age ? String(policy.principal_age) : '—'],
                ['Member No', policy.membership_no],
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Actions" icon={<Clock className="h-5 w-5" />} />
            <InsuranceActions policy={policy} canApprove={can(user, 'insurance.approve')} canUpdate={can(user, 'insurance.update')} />
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dependent Coverage" subtitle="Spouse, children (1 month-24y, 25 school-going), parents" icon={<Users className="h-5 w-5" />} />
          <KeyValue
            columns={2}
            items={[
              ['Covers Spouse', policy.covers_spouse ? `Yes — ${policy.spouse_name || ''} (${policy.spouse_coverage_amount ? money(num(policy.spouse_coverage_amount)) : ''})` : 'No'],
              ['Covers Children', policy.covers_children ? `${policy.children_count || 0} child(ren) — ${policy.children_coverage_amount ? money(num(policy.children_coverage_amount)) : ''}` : 'No'],
              ['Covers Parents', policy.covers_parents ? `${policy.parents_count || 0} parent(s) — ${policy.parents_coverage_amount ? money(num(policy.parents_coverage_amount)) : ''}` : 'No'],
            ]}
          />
          {policy.dependents && policy.dependents.length > 0 ? (
            <div className="mt-4">
              <Table compact>
                <thead><tr><Th>Relationship</Th><Th>Name</Th><Th>DOB</Th><Th align="right">Coverage</Th></tr></thead>
                <tbody>
                  {policy.dependents.map((d: any) => (
                    <tr key={d.id}>
                      <Td className="text-xs">{d.relationship}</Td>
                      <Td className="text-sm font-medium">{d.full_name}</Td>
                      <Td className="text-xs">{d.dob ? fmtDate(d.dob) : '—'} {d.is_school_going ? '(school)' : ''}</Td>
                      <Td align="right" className="text-xs">{money(num(d.coverage_amount))}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-slate-500 mt-2">No additional dependents listed.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Claim Information" subtitle="Payout within 48 hours for illness & accident" icon={<Wallet className="h-5 w-5" />} />
          <KeyValue
            items={[
              ['Date of Death', policy.date_of_death ? fmtDate(policy.date_of_death) : '—'],
              ['Claim Filed', policy.date_claim_filed ? fmtDate(policy.date_claim_filed) : '—'],
              ['Claim Amount', policy.claim_amount ? money(num(policy.claim_amount)) : '—'],
              ['Claim Status', policy.claim_status || 'none'],
              ['Reference', policy.claim_reference || '—'],
              ['Paid At', policy.claim_paid_at ? fmtDate(policy.claim_paid_at) : '—'],
              ['Paid Amount', policy.claim_paid_amount ? money(num(policy.claim_paid_amount)) : '—'],
              ['Actual Payout Hours', policy.claim_payout_hours ? `${policy.claim_payout_hours}h` : '—'],
            ]}
          />
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4">
          <CardHeader title="Premium payments" subtitle="Last 20 payments" icon={<Building2 className="h-5 w-5" />} />
        </div>
        {policy.premiums && policy.premiums.length ? (
          <Table compact>
            <thead><tr><Th>Period</Th><Th>Date</Th><Th align="right">Amount</Th><Th>Method</Th><Th>Receipt</Th></tr></thead>
            <tbody>
              {policy.premiums.map((p: any) => (
                <tr key={p.id}>
                  <Td className="text-xs">{p.premium_period || '—'}</Td>
                  <Td className="text-xs">{fmtDate(p.paid_at)}</Td>
                  <Td align="right" className="text-xs">{money(num(p.amount))}</Td>
                  <Td className="text-xs">{p.method}</Td>
                  <Td className="text-xs font-mono">{p.receipt_no || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-4 text-sm text-slate-500">No premium payments recorded yet.</div>
        )}
      </Card>
    </div>
  );
}

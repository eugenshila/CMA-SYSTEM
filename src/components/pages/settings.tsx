import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { getSetting, getSaccoSettings, getShareSettings } from '@/lib/settings';
import { SectionHeading } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/tabs';
import {
  OrganisationSettingsForm,
  SecuritySettingsForm,
  NotificationSettingsForm,
  GuarantorSettingsForm,
  SettingsGroupForm,
  type GroupField,
} from '@/components/forms/settings-forms';
import { SaccoSettingsForm, ShareSettingsForm } from '@/components/forms/sacco-forms';

export const metadata = { title: 'Settings · CMA' };

const CONTRIBUTION_FIELDS: GroupField[] = [
  { name: 'monthly_amount', label: 'Monthly contribution (KSh)', type: 'number', min: 0, step: 10 },
  { name: 'due_day', label: 'Due day of month', type: 'number', min: 1, max: 28, step: 1 },
  { name: 'financial_year_start_month', label: 'Financial year start month', type: 'number', min: 1, max: 12, step: 1 },
  { name: 'penalty_amount', label: 'Late penalty (KSh)', type: 'number', min: 0, step: 5 },
  { name: 'penalty_after_days', label: 'Penalty after (days)', type: 'number', min: 0, step: 1 },
  { name: 'sacco_min_monthly_savings', label: 'Min monthly savings (KSh)', type: 'number', min: 0, step: 50 },
  { name: 'penalty_enabled', label: 'Charge late penalties', type: 'checkbox' },
  { name: 'auto_bill', label: 'Auto-bill members monthly', type: 'checkbox' },
];

const LOAN_FIELDS: GroupField[] = [
  { name: 'default_interest_method', label: 'Default interest method', type: 'select', options: [
    { value: 'reducing', label: 'Reducing balance' },
    { value: 'flat', label: 'Flat rate' },
  ] },
  { name: 'max_loan_to_savings_ratio', label: 'Max loan ÷ savings ratio', type: 'number', min: 0, step: 0.5, hint: 'e.g. 3 allows a loan up to 3× savings' },
  { name: 'first_due_date_offset_days', label: 'First repayment after (days)', type: 'number', min: 0, step: 1 },
  { name: 'early_repayment_fee_pct', label: 'Early repayment fee (%)', type: 'number', min: 0, step: 0.5 },
  { name: 'arrears_grace_days', label: 'Arrears grace (days)', type: 'number', min: 0, step: 1 },
  { name: 'committee_role', label: 'Approval committee role', type: 'text' },
  { name: 'allow_early_repayment', label: 'Allow early repayment', type: 'checkbox' },
  { name: 'auto_penalty', label: 'Auto-penalise late loans', type: 'checkbox' },
];

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!can(user, 'settings.view')) redirect('/dashboard');

  const [org, contributions, loans, guarantors, security, notifications, sacco, shares] = await Promise.all([
    getSetting<any>('organisation'),
    getSetting<any>('contributions'),
    getSetting<any>('loans'),
    getSetting<any>('guarantors'),
    getSetting<any>('security'),
    getSetting<any>('notifications'),
    getSaccoSettings(),
    getShareSettings(),
  ]);

  const sections = [
    { id: 'organisation', label: 'Organisation', node: <OrganisationSettingsForm settings={org} /> },
    { id: 'contributions', label: 'Contributions', node: <SettingsGroupForm settingKey="contributions" groupName="finance" fields={CONTRIBUTION_FIELDS} initial={contributions} title="contribution rules" /> },
    { id: 'loans', label: 'Loans', node: <SettingsGroupForm settingKey="loans" groupName="loans" fields={LOAN_FIELDS} initial={loans} title="loan rules" /> },
    { id: 'guarantors', label: 'Guarantors', node: <GuarantorSettingsForm settings={guarantors} /> },
    { id: 'sacco', label: 'SDP / Sacco', node: <SaccoSettingsForm settings={sacco} /> },
    { id: 'shares', label: 'Shares', node: <ShareSettingsForm settings={shares} /> },
    { id: 'security', label: 'Security & DPA', node: <SecuritySettingsForm settings={security} /> },
    { id: 'notifications', label: 'Notifications', node: <NotificationSettingsForm settings={notifications} /> },
  ];

  return (
    <>
      <SectionHeading
        title="System settings"
        subtitle="Configure the association profile, financial rules, guarantor policy, security and notification channels. Changes are audited."
      />
      <Tabs sections={sections} />
    </>
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getContributionSettings } from '@/lib/settings';
import { RegisterForm } from '@/components/forms/auth-forms';

export const metadata: Metadata = { title: 'Member registration' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  const [parishes, churches, communities, settings] = await Promise.all([
    query<any>(`SELECT id, name, code FROM parishes WHERE active = TRUE ORDER BY name`),
    query<any>(`SELECT id, name, parish_id FROM churches WHERE active = TRUE ORDER BY name`),
    query<any>(`SELECT id, name, parish_id FROM small_christian_communities WHERE active = TRUE ORDER BY name`),
    getContributionSettings(),
  ]);

  return (
    <RegisterForm
      parishes={parishes.map((p) => ({ value: p.id, label: `${p.name}${p.code ? ` (${p.code})` : ''}` }))}
      churches={churches.map((c) => ({ value: c.id, label: c.name, parish_id: c.parish_id }))}
      communities={communities.map((c) => ({ value: c.id, label: c.name, parish_id: c.parish_id }))}
      contributionAmount={settings.monthly_amount}
    />
  );
}

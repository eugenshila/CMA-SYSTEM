import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import ReportsPage from '@/components/pages/reports';

export const metadata: Metadata = { title: 'Reports & exports' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <ReportsPage user={user} />;
}

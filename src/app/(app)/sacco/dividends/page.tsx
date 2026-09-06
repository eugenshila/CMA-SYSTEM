import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import SaccoDividendsPage from '@/components/pages/sacco-dividends';

export const metadata: Metadata = { title: 'Dividends' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <SaccoDividendsPage user={user} />;
}

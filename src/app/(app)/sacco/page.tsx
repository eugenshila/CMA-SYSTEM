import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import SaccoPage from '@/components/pages/sacco';

export const metadata: Metadata = { title: 'SDP / Sacco overview' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <SaccoPage user={user} />;
}

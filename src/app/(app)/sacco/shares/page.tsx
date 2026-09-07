import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import SaccoSharesPage from '@/components/pages/sacco-shares';

export const metadata: Metadata = { title: 'Share capital' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const sp = await searchParams;
  return <SaccoSharesPage user={user} sp={sp} />;
}

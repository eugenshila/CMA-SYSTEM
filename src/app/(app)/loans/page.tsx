import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import LoansPage from '@/components/pages/loans';

export const metadata: Metadata = { title: 'Loans' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const sp = await searchParams;
  return <LoansPage user={user} sp={sp} />;
}

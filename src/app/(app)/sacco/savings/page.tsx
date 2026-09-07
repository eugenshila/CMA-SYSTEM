import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import SaccoSavingsPage from '@/components/pages/sacco-savings';

export const metadata: Metadata = { title: 'Savings register' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const sp = await searchParams;
  return <SaccoSavingsPage user={user} sp={sp} />;
}

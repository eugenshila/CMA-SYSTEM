import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import LoanApprovalsPage from '@/components/pages/loans-approvals';

export const metadata: Metadata = { title: 'Loan approvals' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const sp = await searchParams;
  return <LoanApprovalsPage user={user} sp={sp} />;
}

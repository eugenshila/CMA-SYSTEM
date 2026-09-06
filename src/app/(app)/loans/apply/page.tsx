import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import LoansApplyPage from '@/components/pages/loans-apply';

export const metadata: Metadata = { title: 'Apply for a loan' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <LoansApplyPage user={user} />;
}

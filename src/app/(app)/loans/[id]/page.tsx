import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import LoanDetailPage from '@/components/pages/loan-detail';

export const metadata: Metadata = { title: 'Loan' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  return <LoanDetailPage id={Number(id)} user={user} />;
}

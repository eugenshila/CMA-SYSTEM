import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import LoanApplicationDetailPage from '@/components/pages/loan-application-detail';

export const metadata: Metadata = { title: 'Loan application' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  return <LoanApplicationDetailPage id={Number(id)} user={user} />;
}

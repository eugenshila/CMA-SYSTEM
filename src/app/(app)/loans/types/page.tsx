import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import LoanTypesPage from '@/components/pages/loans-types';

export const metadata: Metadata = { title: 'Loan products' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <LoanTypesPage user={user} />;
}

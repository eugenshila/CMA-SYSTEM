import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import GuarantorRequestsPage from '@/components/pages/loans-guarantor-requests';

export const metadata: Metadata = { title: 'Guarantor requests' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <GuarantorRequestsPage user={user} />;
}

import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import InsuranceNewPage from '@/components/pages/insurance-new';

export const metadata: Metadata = { title: 'New Last Respect Insurance' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requireUser();
  return <InsuranceNewPage user={user} />;
}

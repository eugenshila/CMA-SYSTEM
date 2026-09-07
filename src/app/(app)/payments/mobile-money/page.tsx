import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import MobileMoneyPage from '@/components/pages/mobile-money';

export const metadata: Metadata = { title: 'Mobile money' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requireUser();
  return <MobileMoneyPage user={user} />;
}

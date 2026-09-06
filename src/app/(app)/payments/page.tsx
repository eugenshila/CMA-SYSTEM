import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import PaymentsPage from '@/components/pages/payments';

export const metadata: Metadata = { title: 'Payments & receipts' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return <PaymentsPage user={user} sp={sp} />;
}

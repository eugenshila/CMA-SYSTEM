import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import PaymentNewPage from '@/components/pages/payment-new';

export const metadata: Metadata = { title: 'Record a payment' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return <PaymentNewPage user={user} sp={sp} />;
}

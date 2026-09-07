import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import ReceiptsPage from '@/components/pages/receipts';

export const metadata: Metadata = { title: 'Receipts' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return <ReceiptsPage user={user} sp={sp} />;
}

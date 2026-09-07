import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import StatementsPage from '@/components/pages/statements';

export const metadata: Metadata = { title: 'Member statements' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return <StatementsPage user={user} sp={sp} />;
}

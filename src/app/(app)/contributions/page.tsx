import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import ContributionsPage from '@/components/pages/contributions';

export const metadata: Metadata = { title: 'Monthly contributions' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return <ContributionsPage user={user} sp={sp} />;
}

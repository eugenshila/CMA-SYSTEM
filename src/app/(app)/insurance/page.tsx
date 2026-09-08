import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import InsuranceListPage from '@/components/pages/insurance-list';

export const metadata: Metadata = { title: 'Last Respect Insurance' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return <InsuranceListPage user={user} sp={sp} />;
}

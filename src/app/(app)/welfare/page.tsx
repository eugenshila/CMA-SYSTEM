import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import CaseListPage from '@/components/pages/case-list';

export const metadata: Metadata = { title: 'Welfare & hospitalisation' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return <CaseListPage type="welfare" user={user} sp={sp} />;
}

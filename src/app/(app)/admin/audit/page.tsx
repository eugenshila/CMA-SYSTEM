import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import AdminAuditPage from '@/components/pages/admin-audit';

export const metadata: Metadata = { title: 'Audit trail · CMA' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const sp = await searchParams;
  return <AdminAuditPage user={user} sp={sp} />;
}

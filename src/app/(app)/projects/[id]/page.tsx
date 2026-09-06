import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import CaseDetailPage from '@/components/pages/case-detail';

export const metadata: Metadata = { title: 'Special projects' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  return <CaseDetailPage type="project" id={Number(id)} user={user} />;
}

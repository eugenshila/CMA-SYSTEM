import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import InsuranceDetailPage from '@/components/pages/insurance-detail';

export const metadata: Metadata = { title: 'Insurance policy' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  return <InsuranceDetailPage user={user} id={Number(id)} />;
}

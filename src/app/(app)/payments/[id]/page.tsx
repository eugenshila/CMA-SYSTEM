import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import PaymentDetailPage from '@/components/pages/payment-detail';

export const metadata: Metadata = { title: 'Payment details' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  return <PaymentDetailPage id={Number(id)} user={user} />;
}

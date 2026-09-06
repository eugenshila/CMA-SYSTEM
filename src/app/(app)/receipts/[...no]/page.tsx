import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import ReceiptDetailPage from '@/components/pages/receipt-detail';

export const metadata: Metadata = { title: 'Receipt' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ no: string[] }> }) {
  const user = await requireUser();
  const { no } = await params;
  const receiptNo = (Array.isArray(no) ? no : [no]).map((part) => decodeURIComponent(part)).join('/');
  return <ReceiptDetailPage receiptNo={receiptNo} user={user} />;
}

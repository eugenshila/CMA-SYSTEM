import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import DocumentsPage from '@/components/pages/documents';

export const metadata: Metadata = { title: 'Documents' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const sp = await searchParams;
  return <DocumentsPage user={user} sp={sp} />;
}

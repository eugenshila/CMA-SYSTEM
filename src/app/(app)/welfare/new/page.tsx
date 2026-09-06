import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import CaseNewPage from '@/components/pages/case-new';

export const metadata: Metadata = { title: 'New welfare & hospitalisation' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requireUser();
  return <CaseNewPage type="welfare" user={user} />;
}

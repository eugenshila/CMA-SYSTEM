import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import CaseNewPage from '@/components/pages/case-new';

export const metadata: Metadata = { title: 'New funeral contributions' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requireUser();
  return <CaseNewPage type="funeral" user={user} />;
}

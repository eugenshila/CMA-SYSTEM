import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import MeetingsPage from '@/components/pages/meetings';

export const metadata: Metadata = { title: 'Meetings' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const sp = await searchParams;
  return <MeetingsPage user={user} sp={sp} />;
}

import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import NotificationsPage from '@/components/pages/notifications';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const sp = await searchParams;
  return <NotificationsPage user={user} sp={sp} />;
}

import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import MeetingDetailPage from '@/components/pages/meeting-detail';

export const metadata: Metadata = { title: 'Meeting' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  return <MeetingDetailPage id={Number(id)} user={user} />;
}

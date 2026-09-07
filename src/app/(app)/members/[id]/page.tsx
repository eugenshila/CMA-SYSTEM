import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import MemberProfile from '@/components/pages/member-profile';

export const metadata: Metadata = { title: 'Member profile' };
export const dynamic = 'force-dynamic';

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <MemberProfile memberId={Number(id)} user={user} tab={sp.tab || 'overview'} />;
}

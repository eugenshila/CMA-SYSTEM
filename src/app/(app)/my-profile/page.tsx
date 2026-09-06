import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import MemberProfile from '@/components/pages/member-profile';

export const metadata: Metadata = { title: 'My profile' };
export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // A self-service profile requires a linked member record.
  if (!user.member_id) redirect('/dashboard');
  const sp = await searchParams;
  return <MemberProfile memberId={Number(user.member_id)} user={user} tab={sp.tab || 'overview'} />;
}

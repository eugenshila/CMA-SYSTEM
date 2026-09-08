import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import AttendancePage from '@/components/pages/attendance';

export const metadata: Metadata = { title: 'Attendance' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const sp = await searchParams;
  return <AttendancePage user={user} sp={sp} />;
}

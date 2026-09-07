import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import AttendancePage from '@/components/pages/attendance';

export const metadata: Metadata = { title: 'Attendance' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <AttendancePage user={user} />;
}

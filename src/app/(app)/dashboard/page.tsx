import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import { isMember, can } from '@/lib/rbac';
import StaffDashboard from '@/components/pages/staff-dashboard';
import MemberDashboard from '@/components/pages/member-dashboard';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  if (isMember(user) && !can(user, 'members.view')) {
    return user.member_id ? (
      <MemberDashboard memberId={user.member_id} canPay={can(user, 'payments.pay_own') || can(user, 'payments.create')} />
    ) : (
      <StaffDashboard user={user} />
    );
  }
  return <StaffDashboard user={user} />;
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { getCurrentUser, type SessionUser } from '@/lib/auth';
import { can, isMember } from '@/lib/rbac';
import { unreadCount } from '@/lib/notify';
import { getOrganisation } from '@/lib/settings';
import { NAV, type NavSection } from '@/components/nav';
import AppShell from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

function filterNav(user: SessionUser): NavSection[] {
  const member = isMember(user);
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.memberOnly && !member) return false;
      if (item.staffOnly && member) return false;
      if (item.permission && !can(user, item.permission)) return false;
      return true;
    }),
  })).filter((section) => section.items.length > 0);
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [org, unread] = await Promise.all([getOrganisation(), unreadCount(user.id, user.member_id)]);

  return (
    <AppShell
      user={{
        id: user.id,
        name: user.name,
        role_name: user.role_name,
        role_key: user.role_key,
        email: user.email,
        phone: user.phone,
        membership_no: user.membership_no,
        photo_url: user.photo_url,
        member_id: user.member_id,
      }}
      nav={filterNav(user)}
      unread={unread}
      organisation={{ name: org.name, short_name: org.short_name, parish: org.parish, motto: org.motto }}
    >
      {user.must_change_password ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
          <p className="min-w-0 flex-1 text-xs font-medium text-amber-900">
            Your account uses a temporary password. For your security, please change it now.
          </p>
          <Link href="/my-profile?tab=security" className="btn-gold btn-sm shrink-0">
            Change password
          </Link>
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}

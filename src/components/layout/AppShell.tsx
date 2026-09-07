'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Search, ClipboardCheck, CalendarDays, FolderOpen, CalendarClock, HeartPulse,
  Cross, HeartHandshake, HandCoins, Landmark, PiggyBank, PieChart, TrendingUp, Banknote, FilePlus2,
  Stamp, ShieldCheck, ListChecks, Wallet, PlusCircle, Smartphone, Receipt, FileText, BarChart3, Shield,
  History, Settings, LogOut, Menu, X, Bell, ChevronDown, UserCircle, Compass, Coins, Church,
} from 'lucide-react';
import { cn, Avatar } from '@/components/ui/primitives';
import { Toaster, toast } from '@/components/ui/client';
import type { NavSection } from '@/components/nav';

const ICONS: Record<string, any> = {
  'layout-dashboard': LayoutDashboard,
  'user-circle': UserCircle,
  bell: Bell,
  users: Users,
  search: Search,
  'clipboard-check': ClipboardCheck,
  'calendar-days': CalendarDays,
  'folder-open': FolderOpen,
  'calendar-clock': CalendarClock,
  'heart-pulse': HeartPulse,
  cross: Cross,
  'heart-handshake': HeartHandshake,
  'hand-coins': HandCoins,
  landmark: Landmark,
  'piggy-bank': PiggyBank,
  'pie-chart': PieChart,
  'trending-up': TrendingUp,
  banknote: Banknote,
  'file-plus-2': FilePlus2,
  stamp: Stamp,
  'shield-check': ShieldCheck,
  'list-checks': ListChecks,
  wallet: Wallet,
  'plus-circle': PlusCircle,
  smartphone: Smartphone,
  receipt: Receipt,
  'file-text': FileText,
  'bar-chart-3': BarChart3,
  shield: Shield,
  history: History,
  settings: Settings,
  compass: Compass,
  coins: Coins,
  church: Church,
};

const SECTION_ICON: Record<string, any> = {
  Overview: Compass,
  Membership: Users,
  Contributions: HandCoins,
  'SDP / Sacco': Landmark,
  Finance: Wallet,
  System: Shield,
};

export interface ShellUser {
  id: number;
  name: string;
  role_name: string;
  role_key: string;
  email: string | null;
  phone: string | null;
  membership_no: string | null;
  photo_url: string | null;
  member_id: number | null;
}

export default function AppShell({
  user,
  nav,
  unread,
  organisation,
  children,
}: {
  user: ShellUser;
  nav: NavSection[];
  unread: number;
  organisation: { name: string; short_name: string; parish: string; motto?: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    setUserMenu(false);
  }, [pathname]);

  const isActive = (href: string) => pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-950 text-white">
      <div className="relative flex items-center gap-3 border-b border-white/10 px-4 py-4 bg-grid">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-500 text-navy-950 shadow">
          <Cross className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-tight">{organisation.short_name || 'CMA'}</p>
          <p className="truncate text-[11px] text-slate-300">{organisation.parish || 'Member Management'}</p>
        </div>
        <button
          className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-300 hover:bg-white/10 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-6 pt-2 scrollbar-thin">
        {nav.map((section) => {
          const SectionIcon = SECTION_ICON[section.title] || Compass;
          return (
            <div key={section.title} className="mb-1">
              <p className="nav-section flex items-center gap-1.5">
                <SectionIcon className="h-3 w-3" />
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = ICONS[item.icon] || LayoutDashboard;
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link href={item.href} className={cn('nav-link', active && 'nav-link-active')}>
                        <Icon className="h-[18px] w-[18px] shrink-0" />
                        <span className="truncate">{item.label}</span>
                        {item.badge === 'notifications' && unread > 0 ? (
                          <span className="ml-auto rounded-full bg-gold-500 px-1.5 py-0.5 text-[10px] font-bold text-navy-950">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        ) : null}
                        {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gold-500" /> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
          <Avatar name={user.name} src={user.photo_url} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold">{user.name}</p>
            <p className="truncate text-[11px] text-gold-300">{user.role_name}</p>
          </div>
        </div>
        <form action="/api/auth/logout" method="post" className="mt-2">
          <button type="submit" className="nav-link w-full justify-start text-slate-300">
            <LogOut className="h-[18px] w-[18px]" />
            <span>Logout</span>
          </button>
        </form>
        <p className="mt-3 px-1 text-[10px] leading-relaxed text-slate-500">
          {organisation.motto || 'Men of faith, men of service.'}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f4f6f9]">
      {/* mobile drawer */}
      <div className={cn('fixed inset-0 z-50 lg:hidden', mobileOpen ? '' : 'pointer-events-none')}>
        <div
          className={cn('absolute inset-0 bg-navy-950/50 transition-opacity', mobileOpen ? 'opacity-100' : 'opacity-0')}
          onClick={() => setMobileOpen(false)}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 w-[86%] max-w-xs transform shadow-2xl transition-transform duration-200',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {sidebar}
        </div>
      </div>

      {/* desktop sidebar */}
      <aside className={cn('fixed inset-y-0 left-0 z-40 hidden lg:block transition-all', collapsed ? 'w-[76px]' : 'w-64')}>
        {sidebar}
      </aside>

      <div className={cn('transition-all', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        {/* topbar */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex items-center gap-2 px-3 py-2.5 sm:px-5">
            <button
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:block"
              onClick={() => setCollapsed((c) => !c)}
              aria-label="Toggle sidebar"
              title={collapsed ? 'Expand menu' : 'Collapse menu'}
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-navy-900 sm:text-base">{organisation.name}</p>
              <p className="hidden truncate text-[11px] text-slate-500 sm:block">
                {organisation.parish}
                {user.membership_no ? ` · ${user.membership_no}` : ''}
              </p>
            </div>

            <Link
              href="/members/search"
              className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 hover:border-navy-300 hover:text-navy-800 md:flex"
            >
              <Search className="h-4 w-4" />
              Search members…
            </Link>

            <Link href="/notifications" className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {unread > 0 ? (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-navy-950">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
            </Link>

            <div className="relative">
              <button
                onClick={() => setUserMenu((v) => !v)}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-slate-100"
                aria-haspopup="menu"
                aria-expanded={userMenu}
              >
                <Avatar name={user.name} src={user.photo_url} size={32} />
                <span className="hidden text-left sm:block">
                  <span className="block max-w-[140px] truncate text-xs font-bold text-navy-900">{user.name}</span>
                  <span className="block text-[10px] text-slate-500">{user.role_name}</span>
                </span>
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </button>
              {userMenu ? (
                <div className="absolute right-0 z-50 mt-2 w-60 animate-fade-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
                  <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                    <p className="truncate text-sm font-bold text-navy-900">{user.name}</p>
                    <p className="truncate text-xs text-slate-500">{user.email || user.phone}</p>
                    <span className="badge-navy mt-1.5">{user.role_name}</span>
                  </div>
                  <div className="p-1.5">
                    {user.member_id ? (
                      <Link href={`/members/${user.member_id}`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                        <UserCircle className="h-4 w-4 text-slate-400" /> My member profile
                      </Link>
                    ) : null}
                    <Link href="/my-profile" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                      <Settings className="h-4 w-4 text-slate-400" /> Account settings
                    </Link>
                    <Link href="/statements" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                      <FileText className="h-4 w-4 text-slate-400" /> My statements
                    </Link>
                    <form
                      action="/api/auth/logout"
                      method="post"
                      onSubmit={() => {
                        toast({ title: 'Signing out…', tone: 'info' });
                      }}
                    >
                      <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
                        <LogOut className="h-4 w-4" /> Logout
                      </button>
                    </form>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-5 sm:py-6">{children}</main>

        <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-[11px] text-slate-400">
          {organisation.name} · Members, Welfare, Contributions, SDP/Sacco, Shares & Loans Management System
          <span className="mx-1.5">·</span> Data handled under the Kenya Data Protection Act, 2019
        </footer>
      </div>

      {userMenu ? <div className="fixed inset-0 z-20" onClick={() => setUserMenu(false)} /> : null}
      <Toaster />
    </div>
  );
}

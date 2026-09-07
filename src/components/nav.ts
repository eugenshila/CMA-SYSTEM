export interface NavItem {
  label: string;
  href: string;
  icon: string;
  permission?: string;
  /** show only to members (self service) */
  memberOnly?: boolean;
  /** hide from ordinary members */
  staffOnly?: boolean;
  badge?: 'notifications';
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: 'layout-dashboard', permission: 'dashboard.view' },
      { label: 'My Profile', href: '/my-profile', icon: 'user-circle', memberOnly: true },
      { label: 'Notifications', href: '/notifications', icon: 'bell', permission: 'notifications.view', badge: 'notifications' },
    ],
  },
  {
    title: 'Membership',
    items: [
      { label: 'Members', href: '/members', icon: 'users', permission: 'members.view' },
      { label: 'Member Search', href: '/members/search', icon: 'search', permission: 'members.view' },
      { label: 'Attendance', href: '/attendance', icon: 'clipboard-check', permission: 'attendance.view' },
      { label: 'Meetings', href: '/meetings', icon: 'calendar-days', permission: 'meetings.view' },
      { label: 'Documents', href: '/documents', icon: 'folder-open', permission: 'documents.view' },
    ],
  },
  {
    title: 'Contributions',
    items: [
      { label: 'Monthly Contributions', href: '/contributions', icon: 'calendar-clock', permission: 'contributions.view' },
      { label: 'Welfare (Sick Members)', href: '/welfare', icon: 'heart-pulse', permission: 'welfare.view' },
      { label: 'Funeral', href: '/funerals', icon: 'cross', permission: 'funerals.view' },
      { label: 'Wedding', href: '/weddings', icon: 'heart-handshake', permission: 'weddings.view' },
      { label: 'Projects & Special', href: '/projects', icon: 'hand-coins', permission: 'projects.view' },
    ],
  },
  {
    title: 'SDP / Sacco',
    items: [
      { label: 'SDP / Sacco', href: '/sacco', icon: 'landmark', permission: 'sacco.view' },
      { label: 'Savings', href: '/sacco/savings', icon: 'piggy-bank', permission: 'savings.view' },
      { label: 'Shares', href: '/sacco/shares', icon: 'pie-chart', permission: 'shares.view' },
      { label: 'Dividends', href: '/sacco/dividends', icon: 'trending-up', permission: 'sacco.view', staffOnly: true },
      { label: 'Loans', href: '/loans', icon: 'banknote', permission: 'loans.view' },
      { label: 'Apply for a Loan', href: '/loans/apply', icon: 'file-plus-2', permission: 'loans.apply' },
      { label: 'Loan Approvals', href: '/loans/approvals', icon: 'stamp', permission: 'loan_approvals.view' },
      { label: 'Guarantor Requests', href: '/loans/guarantor-requests', icon: 'shield-check', permission: 'guarantors.view' },
      { label: 'Loan Products', href: '/loans/types', icon: 'list-checks', permission: 'loans.view', staffOnly: true },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Payments', href: '/payments', icon: 'wallet', permission: 'payments.view' },
      { label: 'Record Payment', href: '/payments/new', icon: 'plus-circle', permission: 'payments.create' },
      { label: 'M-Pesa / Mobile Money', href: '/payments/mobile-money', icon: 'smartphone', permission: 'payments.view' },
      { label: 'Receipts', href: '/receipts', icon: 'receipt', permission: 'receipts.view' },
      { label: 'Statements', href: '/statements', icon: 'file-text', permission: 'statements.view' },
      { label: 'Reports', href: '/reports', icon: 'bar-chart-3', permission: 'reports.view' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Administration', href: '/admin', icon: 'shield', permission: 'users.view' },
      { label: 'Audit Trail', href: '/admin/audit', icon: 'history', permission: 'audit.view' },
      { label: 'Settings', href: '/settings', icon: 'settings', permission: 'settings.view' },
    ],
  },
];

export const SECTION_ICONS: Record<string, string> = {
  Overview: 'compass',
  Membership: 'users',
  Contributions: 'hand-coins',
  'SDP / Sacco': 'landmark',
  Finance: 'wallet',
  System: 'shield',
};

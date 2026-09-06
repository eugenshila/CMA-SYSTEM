import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'CMA Management System',
    template: '%s · CMA Management System',
  },
  description:
    'Catholic Men Association (CMA) member management, welfare, contributions, SDP/Sacco savings, shares and loans management system.',
  applicationName: 'CMA Management System',
  keywords: ['CMA', 'Catholic Men Association', 'Sacco', 'SDP', 'Church management', 'Welfare', 'Loans'],
  authors: [{ name: 'CMA System' }],
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0e2340',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f4f6f9] font-sans">{children}</body>
    </html>
  );
}

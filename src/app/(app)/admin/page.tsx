import type { Metadata } from 'next';
import AdminPage from '@/components/pages/admin';

export const metadata: Metadata = { title: 'Administration · CMA' };
export const dynamic = 'force-dynamic';

export default AdminPage;

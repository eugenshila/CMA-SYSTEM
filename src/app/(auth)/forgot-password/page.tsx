import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ForgotPasswordForm } from '@/components/forms/auth-forms';

export const metadata: Metadata = { title: 'Reset password' };
export const dynamic = 'force-dynamic';

export default async function ForgotPasswordPage() {
  const user = await getCurrentUser();
  if (user) redirect('/settings');
  return <ForgotPasswordForm />;
}

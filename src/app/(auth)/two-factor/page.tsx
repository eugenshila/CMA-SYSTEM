import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CHALLENGE_COOKIE, getCurrentUser } from '@/lib/auth';
import { TwoFactorPage } from '@/components/forms/auth-forms';

export const metadata: Metadata = { title: 'Two-factor verification' };
export const dynamic = 'force-dynamic';

export default async function TwoFactorRoute() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');
  const store = await cookies();
  const challenge = store.get(CHALLENGE_COOKIE)?.value || '';
  const userId = Number(challenge.split(':')[0]);
  if (!userId) {
    return (
      <div className="card card-pad text-center shadow-pop">
        <h1 className="text-lg font-extrabold text-navy-900">Verification session expired</h1>
        <p className="mt-2 text-xs text-slate-500">Please sign in again to receive a new verification code.</p>
        <Link href="/login" className="btn-primary btn-block mt-4">
          Back to sign in
        </Link>
      </div>
    );
  }
  return <TwoFactorPage userId={userId} />;
}

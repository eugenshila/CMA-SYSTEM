'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn, KeyRound, ShieldCheck, UserPlus, ArrowRight, Sparkles, Phone } from 'lucide-react';
import { loginAction, twoFactorAction, requestResetAction, resetPasswordAction, registerAction } from '@/server/actions/auth';
import { SubmitButton, PasswordInput, toastSuccess, toastError } from '@/components/ui/client';
import { Field, FormGrid, Select, TextInput, ResultAlert } from './fields';
import type { ActionResult } from '@/server/actions/auth';

type LoginResult = ActionResult & { requires2fa?: boolean; userId?: number; devCode?: string };

const DEMO_ACCOUNTS = [
  { label: 'Super Administrator', identifier: 'superadmin@cma.or.ke', password: 'Cma@Super2026' },
  { label: 'Administrator', identifier: 'admin@stmonica.or.ke', password: 'Cma@Admin2026' },
  { label: 'Treasurer', identifier: 'treasurer@stmonica.or.ke', password: 'Cma@Treas2026' },
  { label: 'Secretary', identifier: 'secretary@stmonica.or.ke', password: 'Cma@Sec2026' },
  { label: 'SDP / Sacco Officer', identifier: 'sacco@stmonica.or.ke', password: 'Cma@Sacco2026' },
  { label: 'Ordinary member', identifier: '254791752384', password: 'Member@2026' },
];

/* ------------------------------------------------------------------ *
 * LOGIN
 * ------------------------------------------------------------------ */
export function LoginForm({ loggedOut }: { loggedOut?: boolean }) {
  const [state, formAction, pending] = useActionState<LoginResult | null, FormData>(loginAction as any, null);
  const [challenge, setChallenge] = useState<{ userId: number; devCode?: string } | null>(null);

  useEffect(() => {
    if (state?.requires2fa && state?.userId) setChallenge({ userId: state.userId, devCode: state.devCode });
  }, [state]);

  if (challenge) {
    return (
      <TwoFactorCard
        userId={challenge.userId}
        devCode={challenge.devCode}
        note="Enter the 6-digit verification code sent to your phone or email to continue."
        onCancel={() => setChallenge(null)}
      />
    );
  }

  return (
    <div className="card card-pad shadow-pop">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold tracking-tight text-navy-900">Sign in</h1>
        <p className="mt-1 text-xs text-slate-500">
          Use your phone number, email address or CMA membership number.
        </p>
      </div>

      {loggedOut ? <ResultAlert result={{ ok: true, message: 'You have been signed out safely.' }} className="mb-4" /> : null}
      <ResultAlert result={state} className="mb-4" />

      <form action={formAction} className="space-y-4">
        <Field label="Phone, email or CMA number" required>
          <TextInput
            name="identifier"
            placeholder="e.g. 0712 345 678"
            autoComplete="username"
            required
            autoFocus
          />
        </Field>

        <Field label="Password" required>
          <PasswordInput name="password" placeholder="Your password" autoComplete="current-password" required />
        </Field>

        <div className="flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
            <input type="checkbox" name="remember" defaultChecked className="checkbox" />
            Keep me signed in
          </label>
          <Link href="/forgot-password" className="link text-xs">
            Forgot password?
          </Link>
        </div>

        <SubmitButton className="btn-block btn-lg" pendingText="Signing in…" icon={<LogIn className="h-4 w-4" />}>
          Sign in
        </SubmitButton>
      </form>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-gold-600" /> Demo accounts (seeded data)
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {DEMO_ACCOUNTS.map((d) => (
            <button
              key={d.label}
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-[11px] transition hover:border-navy-300 hover:bg-navy-50/40"
              onClick={() => {
                const form = document.querySelector<HTMLFormElement>('form[action]');
                const idInput = document.querySelector<HTMLInputElement>('input[name="identifier"]');
                const pwInput = document.querySelector<HTMLInputElement>('input[name="password"]');
                if (idInput) idInput.value = d.identifier;
                if (pwInput) pwInput.value = d.password;
                form?.requestSubmit();
              }}
            >
              <span className="block font-semibold text-navy-900">{d.label}</span>
              <span className="block tabular-nums text-slate-500">{d.identifier}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="mt-5 text-center text-xs text-slate-500">
        New to the association?{' '}
        <Link href="/register" className="link font-semibold">
          Register as a member
        </Link>
      </p>
      <p className="mt-1 text-center text-[11px] text-slate-400">Pending registrations require Secretary approval.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * TWO FACTOR
 * ------------------------------------------------------------------ */
export function TwoFactorCard({
  userId,
  devCode,
  note,
  onCancel,
}: {
  userId: number;
  devCode?: string;
  note?: string;
  onCancel?: () => void;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(twoFactorAction as any, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.push('/dashboard');
  }, [state, router]);

  return (
    <div className="card card-pad shadow-pop">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-50 text-navy-800">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-extrabold tracking-tight text-navy-900">Two-factor verification</h1>
          <p className="text-xs text-slate-500">{note || 'Confirm it is really you.'}</p>
        </div>
      </div>

      <ResultAlert result={state} className="mb-4" />

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="user_id" value={userId} />
        <Field label="6-digit code" required hint="The code expires after 10 minutes.">
          <TextInput name="code" placeholder="000000" required pattern="[0-9]{6}" className="text-center text-lg tracking-[0.5em]" autoFocus />
        </Field>
        {devCode ? (
          <div className="alert alert-warn">
            <p className="text-xs">
              <strong>Development mode:</strong> no SMS gateway is configured, your code is{' '}
              <span className="font-mono font-bold">{devCode}</span>.
            </p>
          </div>
        ) : null}
        <SubmitButton className="btn-block btn-lg" pendingText="Verifying…" icon={<KeyRound className="h-4 w-4" />}>
          Verify and continue
        </SubmitButton>
        {onCancel ? (
          <button type="button" className="btn-outline btn-block" onClick={onCancel}>
            Back to sign in
          </button>
        ) : null}
      </form>
    </div>
  );
}

export function TwoFactorPage({ userId, devCode }: { userId: number; devCode?: string }) {
  return <TwoFactorCard userId={userId} devCode={devCode} />;
}

/* ------------------------------------------------------------------ *
 * PASSWORD RESET (two steps in one card)
 * ------------------------------------------------------------------ */
export function ForgotPasswordForm() {
  const [requestState, requestAction, requesting] = useActionState<any>(requestResetAction as any, null);
  const [resetState, resetAction, resetting] = useActionState<ActionResult | null, FormData>(resetPasswordAction as any, null);
  const [step, setStep] = useState<1 | 2>(1);
  const [identifier, setIdentifier] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (requestState?.ok) setStep(2);
  }, [requestState]);
  useEffect(() => {
    if (resetState?.ok) {
      toastSuccess('Password reset', resetState.message);
      setTimeout(() => router.push('/login'), 1200);
    } else if (resetState?.error) toastError('Reset failed', resetState.error);
  }, [resetState, router]);

  return (
    <div className="card card-pad shadow-pop">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold tracking-tight text-navy-900">Reset your password</h1>
        <p className="mt-1 text-xs text-slate-500">
          Step {step} of 2 — {step === 1 ? 'request a one-time code' : 'enter the code and choose a new password'}.
        </p>
      </div>

      {step === 1 ? (
        <form action={requestAction} className="space-y-4">
          <ResultAlert result={requestState} />
          <Field label="Phone, email or CMA number" required>
            <TextInput name="identifier" required autoFocus placeholder="e.g. 0712 345 678" onChange={(e) => setIdentifier(e.target.value)} />
          </Field>
          <Field label="Send the code by">
            <div className="flex gap-2">
              <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium">
                <input type="radio" name="channel" value="sms" defaultChecked className="checkbox" />
                <Phone className="h-3.5 w-3.5 text-slate-400" /> SMS
              </label>
              <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium">
                <input type="radio" name="channel" value="email" className="checkbox" />
                Email
              </label>
            </div>
          </Field>
          <SubmitButton className="btn-block btn-lg" pendingText="Sending code…" icon={<ArrowRight className="h-4 w-4" />}>
            Send reset code
          </SubmitButton>
        </form>
      ) : (
        <form action={resetAction} className="space-y-4">
          <ResultAlert result={resetState} />
          {requestState?.devCode ? (
            <div className="alert alert-warn">
              <p className="text-xs">
                <strong>Development mode:</strong> your reset code is <span className="font-mono font-bold">{requestState.devCode}</span>
                {requestState.destination ? ` (sent to ${requestState.destination})` : ''}.
              </p>
            </div>
          ) : (
            <div className="alert alert-info">
              <p className="text-xs">{requestState?.message || 'Check your phone or email for the 6-digit reset code.'}</p>
            </div>
          )}
          <input type="hidden" name="identifier" value={identifier || requestState?.data?.identifier || ''} />
          <Field label="Identifier" hint="Pre-filled from the previous step." required>
            <TextInput name="identifier_display" defaultValue={identifier} required readOnly />
          </Field>
          <Field label="Reset code" required>
            <TextInput name="code" required pattern="[0-9]{6}" placeholder="000000" className="text-center text-lg tracking-[0.5em]" />
          </Field>
          <Field label="New password" required hint="At least 8 characters with a number and a special character.">
            <PasswordInput name="password" autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password" required>
            <PasswordInput name="confirm_password" autoComplete="new-password" required />
          </Field>
          <SubmitButton className="btn-block btn-lg" pendingText="Resetting…" icon={<KeyRound className="h-4 w-4" />}>
            Reset password
          </SubmitButton>
          <button type="button" className="btn-ghost btn-block" onClick={() => setStep(1)}>
            Use a different identifier
          </button>
        </form>
      )}

      <p className="mt-5 text-center text-xs text-slate-500">
        Remembered it?{' '}
        <Link href="/login" className="link font-semibold">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * SELF REGISTRATION
 * ------------------------------------------------------------------ */
export function RegisterForm({
  parishes,
  churches,
  communities,
  contributionAmount,
}: {
  parishes: { value: number; label: string }[];
  churches: { value: number; label: string; parish_id: number | null }[];
  communities: { value: number; label: string; parish_id: number | null }[];
  contributionAmount: number;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(registerAction as any, null);
  const [parishId, setParishId] = useState<number | null>(parishes[0]?.value ?? null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      setDone(true);
      toastSuccess('Registration received', state.message);
    } else if (state?.error) toastError('Registration failed', state.error);
  }, [state]);

  if (done) {
    return (
      <div className="card card-pad text-center shadow-pop">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <ShieldCheck className="h-7 w-7" />
        </span>
        <h1 className="text-lg font-extrabold text-navy-900">Registration received</h1>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-600">{state?.message}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button className="btn-primary btn-block" onClick={() => router.push('/login')}>
            Go to sign in
          </button>
          <Link href="/register" className="btn-outline btn-block">
            Register another member
          </Link>
        </div>
      </div>
    );
  }

  const filteredChurches = churches.filter((c) => !parishId || c.parish_id === parishId);
  const filteredSccs = communities.filter((c) => !parishId || c.parish_id === parishId);

  return (
    <div className="card card-pad shadow-pop">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-50 text-gold-700">
          <UserPlus className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-extrabold tracking-tight text-navy-900">Join the CMA</h1>
          <p className="text-xs text-slate-500">
            Baptised, confirmed Catholic men aged 18+. Monthly contribution KSh {contributionAmount.toLocaleString()}.
          </p>
        </div>
      </div>

      <ResultAlert result={state} className="mb-4" />

      <form action={formAction} className="space-y-4">
        <FormGrid cols={2}>
          <Field label="First name" required>
            <TextInput name="first_name" required autoFocus />
          </Field>
          <Field label="Last name" required>
            <TextInput name="last_name" required />
          </Field>
          <Field label="Middle name">
            <TextInput name="middle_name" />
          </Field>
          <Field label="Phone number" required hint="Used to sign in and receive M-Pesa prompts.">
            <TextInput name="phone" required placeholder="0712 345 678" autoComplete="tel" />
          </Field>
          <Field label="Email address">
            <TextInput name="email" type="email" placeholder="you@example.com" autoComplete="email" />
          </Field>
          <Field label="National ID / Passport no.">
            <TextInput name="national_id" />
          </Field>
          <Field label="Date of birth" required>
            <TextInput name="date_of_birth" type="date" required max={new Date().toISOString().slice(0, 10)} />
          </Field>
          <Field label="Marital status">
            <Select
              name="marital_status"
              defaultValue="single"
              options={[
                { value: 'single', label: 'Single' },
                { value: 'married', label: 'Married' },
                { value: 'widowed', label: 'Widowed' },
                { value: 'separated', label: 'Separated' },
              ]}
            />
          </Field>
        </FormGrid>

        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-navy-800">Church structure</p>
          <FormGrid cols={2}>
            <Field label="Parish" required>
              <Select
                name="parish_id"
                required
                options={parishes}
                defaultValue={parishId}
                onChange={(e) => setParishId(Number(e.target.value) || null)}
              />
            </Field>
            <Field label="Church / Outstation">
              <Select name="church_id" options={filteredChurches} placeholder="Select church" />
            </Field>
            <Field label="Small Christian Community" span>
              <Select name="scc_id" options={filteredSccs} placeholder="Select SCC" />
            </Field>
            <Field label="Residential area" span>
              <TextInput name="residential_area" placeholder="Estate / village" />
            </Field>
          </FormGrid>
        </div>

        <Field label="Choose a password" required hint="Minimum 8 characters, including a number and a special character.">
          <PasswordInput name="password" autoComplete="new-password" required />
        </Field>
        <Field label="Confirm password" required>
          <PasswordInput name="confirm_password" autoComplete="new-password" required />
        </Field>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
          <input type="checkbox" name="dpa_consent" required className="checkbox mt-0.5" />
          <span>
            I consent to the Catholic Men Association processing my personal data for membership, welfare, contributions
            and sacco services in accordance with the <strong>Kenya Data Protection Act, 2019</strong>.
          </span>
        </label>

        <SubmitButton className="btn-block btn-lg" pendingText="Submitting…" icon={<UserPlus className="h-4 w-4" />}>
          Submit registration
        </SubmitButton>
      </form>

      <p className="mt-5 text-center text-xs text-slate-500">
        Already a member?{' '}
        <Link href="/login" className="link font-semibold">
          Sign in
        </Link>
      </p>
    </div>
  );
}

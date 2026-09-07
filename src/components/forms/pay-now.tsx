'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Smartphone, Banknote, Landmark, Wallet, Loader2, CheckCircle2 } from 'lucide-react';
import { Modal, toastSuccess, toastError } from '@/components/ui/client';
import { quickPayAction } from '@/server/actions/payments';
import { money } from '@/lib/money';

export interface Obligation {
  key: string;
  label: string;
  detail?: string;
  allocationType: string;
  referenceId?: number | null;
  period?: string | null;
  shares?: number | null;
  amount: number;
  min?: number;
}

const METHODS = [
  { value: 'mpesa', label: 'M-Pesa (STK push)', icon: Smartphone, hint: 'A prompt is sent to your phone' },
  { value: 'airtel', label: 'Airtel Money', icon: Wallet, hint: 'Recorded for reconciliation' },
  { value: 'bank', label: 'Bank transfer', icon: Landmark, hint: 'Recorded for reconciliation' },
  { value: 'cash', label: 'Cash at the office', icon: Banknote, hint: 'Verified by the Treasurer' },
];

export default function PayNowButton({
  memberId,
  phone,
  obligations,
  label = 'Pay now',
  className = 'btn-gold',
  allowCustom = true,
}: {
  memberId: number;
  phone?: string | null;
  obligations: Obligation[];
  label?: string;
  className?: string;
  allowCustom?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string>(obligations[0]?.key || 'custom');
  const [amount, setAmount] = useState<string>(String(obligations[0]?.amount ?? ''));
  const [method, setMethod] = useState('mpesa');
  const [phoneNo, setPhoneNo] = useState(phone || '');
  const [result, setResult] = useState<{ ok: boolean; message?: string; sandbox?: boolean } | null>(null);

  const current = obligations.find((o) => o.key === selected);

  const pick = (key: string) => {
    setSelected(key);
    const ob = obligations.find((o) => o.key === key);
    if (ob) setAmount(String(ob.amount || ''));
    setResult(null);
  };

  const submit = () => {
    const value = Number(amount);
    if (!value || value <= 0) {
      toastError('Enter an amount', 'The amount must be greater than zero.');
      return;
    }
    start(async () => {
      const res = await quickPayAction({
        memberId,
        amount: value,
        allocationType: current?.allocationType || 'other',
        referenceId: current?.referenceId ?? null,
        period: current?.period ?? null,
        shares: current?.shares ?? null,
        method: method as any,
        phoneNumber: phoneNo || undefined,
        note: current?.label,
      });
      if (res.ok) {
        setResult({ ok: true, message: res.message, sandbox: Boolean((res.data as any)?.sandbox) });
        toastSuccess('Payment submitted', res.message);
        router.refresh();
      } else {
        setResult({ ok: false, message: res.error });
        toastError('Payment failed', res.error);
      }
    });
  };

  return (
    <>
      <button type="button" className={`${className} btn-sm`} onClick={() => { setOpen(true); setResult(null); }}>
        <Wallet className="h-4 w-4" />
        {label}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Make a payment"
        description="Choose what you are paying for and how you want to pay."
        size="md"
        footer={
          result?.ok ? (
            <button className="btn-primary" onClick={() => setOpen(false)}>
              <CheckCircle2 className="h-4 w-4" /> Done
            </button>
          ) : (
            <>
              <button className="btn-outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </button>
              <button className="btn-gold" onClick={submit} disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                {pending ? 'Processing…' : `Pay ${amount ? money(Number(amount)) : ''}`}
              </button>
            </>
          )
        }
      >
        {result?.ok ? (
          <div className="py-4 text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <p className="text-sm font-bold text-navy-900">Payment submitted</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-600">{result.message}</p>
            {result.sandbox ? (
              <p className="mx-auto mt-3 max-w-sm rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                M-Pesa is running in <strong>sandbox mode</strong> (no Daraja credentials). Complete the simulated
                payment from <strong>Payments → M-Pesa / Mobile Money</strong>.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            {result && !result.ok ? <div className="alert alert-error"><p className="text-xs">{result.message}</p></div> : null}

            <div>
              <span className="label">What are you paying for?</span>
              <div className="space-y-1.5">
                {obligations.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => pick(o.key)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                      selected === o.key ? 'border-navy-500 bg-navy-50/60 ring-1 ring-navy-300' : 'border-slate-200 bg-white hover:border-navy-300'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-navy-900">{o.label}</span>
                      {o.detail ? <span className="block truncate text-[11px] text-slate-500">{o.detail}</span> : null}
                    </span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-navy-900">{money(o.amount)}</span>
                  </button>
                ))}
                {allowCustom ? (
                  <button
                    type="button"
                    onClick={() => pick('custom')}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                      selected === 'custom' ? 'border-navy-500 bg-navy-50/60 ring-1 ring-navy-300' : 'border-slate-200 bg-white hover:border-navy-300'
                    }`}
                  >
                    <span className="text-sm font-semibold text-navy-900">Other / custom amount</span>
                    <span className="text-[11px] text-slate-500">unallocated</span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="pay-amount">Amount (KSh)</label>
                <input
                  id="pay-amount"
                  type="number"
                  min={current?.min ?? 1}
                  step="0.01"
                  className="input tabular-nums"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="pay-phone">M-Pesa phone number</label>
                <input
                  id="pay-phone"
                  className="input"
                  placeholder="0712 345 678"
                  value={phoneNo}
                  onChange={(e) => setPhoneNo(e.target.value)}
                />
              </div>
            </div>

            <div>
              <span className="label">Payment method</span>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${
                      method === m.value ? 'border-gold-500 bg-gold-50/60 ring-1 ring-gold-400' : 'border-slate-200 bg-white hover:border-navy-300'
                    }`}
                  >
                    <m.icon className="h-4 w-4 shrink-0 text-navy-800" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-navy-900">{m.label}</span>
                      <span className="block truncate text-[10px] text-slate-500">{m.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

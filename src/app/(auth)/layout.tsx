import { Cross, ShieldCheck, Users, Landmark, Banknote, HeartPulse } from 'lucide-react';
import { getOrganisation } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const FEATURES = [
  { icon: Users, title: 'Membership registry', text: 'Complete member profiles, documents, next of kin and the full parish structure.' },
  { icon: HeartPulse, title: 'Welfare & funeral support', text: 'Sick-member welfare, funeral, wedding and unlimited special project contributions.' },
  { icon: Landmark, title: 'SDP / Sacco', text: 'Savings deposits, share capital, certificates, dividends and member statements.' },
  { icon: Banknote, title: 'Loans & guarantors', text: 'Configurable loan products, guarantor approval, amortisation schedules and penalties.' },
  { icon: ShieldCheck, title: 'Secure & auditable', text: 'Role-based access, encrypted identifiers, M-Pesa reconciliation and a full audit trail.' },
];

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const org = await getOrganisation();
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel */}
      <aside className="relative overflow-hidden bg-navy-950 px-6 py-8 text-white lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:px-12 lg:py-12 bg-grid">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-navy-500/30 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold-500 text-navy-950 shadow-lg">
              <Cross className="h-6 w-6" />
            </span>
            <div>
              <p className="text-lg font-extrabold leading-tight tracking-tight">{org.name}</p>
              <p className="text-xs text-slate-300">
                {org.parish || 'Parish Chapter'} · {org.diocese || 'Diocese'}
              </p>
            </div>
          </div>
          {org.motto ? (
            <p className="mt-6 max-w-md border-l-2 border-gold-500 pl-4 text-sm italic text-slate-200">“{org.motto}”</p>
          ) : null}
        </div>

        <ul className="relative mt-8 hidden space-y-4 lg:block">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold-400">
                <f.icon className="h-[18px] w-[18px]" />
              </span>
              <div>
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="text-xs leading-relaxed text-slate-300">{f.text}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="relative mt-8 hidden text-[11px] text-slate-400 lg:block">
          Member data is processed in line with the Kenya Data Protection Act, 2019. Sensitive identifiers are stored
          encrypted and every financial transaction is permanently audited.
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center bg-[#f4f6f9] px-4 py-8 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

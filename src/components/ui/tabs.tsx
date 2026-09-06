'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/primitives';

export interface TabSection {
  id: string;
  label: string;
  node: React.ReactNode;
  /** Optional badge/count shown next to the label */
  badge?: string | number;
}

/**
 * Client-side tab shell. `sections[].node` may be a server-rendered element
 * (React nodes passed from a server component are serialised as RSC payloads).
 */
export function Tabs({ sections, variant = 'card' }: { sections: TabSection[]; variant?: 'card' | 'plain' }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? '');
  const current = sections.find((s) => s.id === active) ?? sections[0];
  return (
    <div className="space-y-4">
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(s.id)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              active === s.id ? 'bg-navy-800 text-white' : 'border border-slate-200 text-slate-600 hover:border-navy-800/30 hover:text-navy-800'
            }`}
          >
            {s.label}
            {s.badge !== undefined && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active === s.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>{s.badge}</span>
            )}
          </button>
        ))}
      </div>
      {variant === 'card' ? (
        <Card>{current?.node}</Card>
      ) : (
        <div>{current?.node}</div>
      )}
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { Select } from './fields';

export interface PickerOption {
  value: number;
  label: string;
  sub?: string;
}

/**
 * Searchable member picker built on a native <select> so it keeps working on
 * low-end phones and offline, while still filtering thousands of members.
 */
export function MemberPicker({
  name = 'member_id',
  options,
  required = true,
  defaultValue,
  placeholder,
  limit = 200,
  onChange,
}: {
  name?: string;
  options: PickerOption[];
  required?: boolean;
  defaultValue?: number | string | null;
  placeholder?: string;
  limit?: number;
  onChange?: (value: string) => void;
}) {
  const [term, setTerm] = useState('');
  const initial = defaultValue ? String(defaultValue) : '';
  const [value, setValue] = useState(initial);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options;
    // always keep the currently selected member in the list
    if (value && !list.some((o) => String(o.value) === value)) {
      const selected = options.find((o) => String(o.value) === value);
      if (selected) list.unshift(selected);
    }
    return list.slice(0, limit);
  }, [term, options, value, limit]);

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={`Type a name or membership number… (${options.length} members)`}
        className="input"
        aria-label="Filter members"
      />
      <Select
        name={name}
        required={required}
        defaultValue={value}
        placeholder={placeholder || `Select a member (${filtered.length}${filtered.length === limit ? '+' : ''} shown)`}
        options={filtered.map((o) => ({ value: o.value, label: o.sub ? `${o.label} — ${o.sub}` : o.label }))}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(e.target.value);
        }}
      />
    </div>
  );
}

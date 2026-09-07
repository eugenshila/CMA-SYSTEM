'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toastSuccess, toastError } from '@/components/ui/client';
import { togglePermissionAction } from '@/server/actions/admin';

export type MatrixRole = { id: number; key: string; name: string };
export type MatrixPermission = { id: number; key: string; module: string; action: string; description: string | null };

export function PermissionMatrix({
  roles, permissions, grants, locked,
}: {
  roles: MatrixRole[];
  permissions: MatrixPermission[];
  grants: string[]; // encoded "roleId:permissionId"
  locked?: boolean; // e.g. member role — editing not allowed
}) {
  const [roleId, setRoleId] = useState<number>(roles.find((r) => r.key !== 'member')?.id ?? roles[0]?.id);
  const [local, setLocal] = useState<Set<string>>(() => new Set(grants));
  const [busy, setBusy] = useState<string | null>(null);

  const modules = Array.from(new Set(permissions.map((p) => p.module))).sort();
  const activeRole = roles.find((r) => r.id === roleId);
  const isLocked = locked || activeRole?.key === 'member';

  async function toggle(permId: number, granted: boolean) {
    const key = `${roleId}:${permId}`;
    if (isLocked) { toastError('Read-only', 'The member role permissions are fixed for self-service access.'); return; }
    setBusy(key);
    const optimistic = new Set(local);
    if (granted) optimistic.add(key); else optimistic.delete(key);
    setLocal(optimistic);
    const res = await togglePermissionAction(roleId, permId, granted);
    setBusy(null);
    if (res.ok) { toastSuccess(granted ? 'Permission granted' : 'Permission revoked', res.message); }
    else { setLocal(local); toastError(res.error || 'Could not update permission'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Role</span>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoleId(r.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${roleId === r.id ? 'bg-navy-800 text-white' : 'border border-slate-200 text-slate-600 hover:border-navy-800/30'}`}
            >
              {r.name}
            </button>
          ))}
        </div>
      </div>

      {isLocked && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The <strong>{activeRole?.name}</strong> role has fixed self-service permissions and cannot be edited.
        </p>
      )}

      <div className="space-y-5">
        {modules.map((mod) => {
          const perms = permissions.filter((p) => p.module === mod).sort((a, b) => a.action.localeCompare(b.action));
          return (
            <div key={mod}>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-navy-800">
                <ShieldCheck className="h-3.5 w-3.5 text-gold-500" /> {mod.replace(/_/g, ' ')}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {perms.map((p) => {
                  const key = `${roleId}:${p.id}`;
                  const checked = local.has(key);
                  return (
                    <label
                      key={p.id}
                      className={`flex items-start gap-2 rounded-lg border p-2 text-xs transition-colors ${checked ? 'border-navy-800/30 bg-navy-50' : 'border-slate-200 bg-white'} ${isLocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-navy-800/30'}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-navy-800 focus:ring-navy-800"
                        checked={checked}
                        disabled={isLocked || busy === key}
                        onChange={(e) => toggle(p.id, e.target.checked)}
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold text-navy-900">{p.action.replace(/_/g, ' ')}</span>
                        {p.description && <span className="block truncate text-[11px] text-slate-500">{p.description}</span>}
                      </span>
                      {busy === key && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-navy-800" />}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

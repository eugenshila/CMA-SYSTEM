'use client';

import { useState } from 'react';
import { Loader2, Check, CheckCheck, Trash2, Bell } from 'lucide-react';
import { toastSuccess, toastError } from '@/components/ui/client';
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
  deleteNotificationAction,
} from '@/server/actions/records';

export function MarkReadButton({ id }: { id: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      title="Mark as read"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await markNotificationReadAction(id);
        setBusy(false);
        if (res.ok) window.location.reload();
        else toastError(res.error || 'Could not mark as read');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
    </button>
  );
}

export function DeleteNotificationButton({ id }: { id: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm text-red-500 hover:bg-red-50"
      title="Delete"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await deleteNotificationAction(id);
        setBusy(false);
        if (res.ok) window.location.reload();
        else toastError(res.error || 'Could not delete');
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}

export function MarkAllReadButton({ count }: { count: number }) {
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await markAllNotificationsReadAction();
        setBusy(false);
        if (res.ok) {
          toastSuccess(res.message || 'All caught up');
          window.location.reload();
        } else toastError(res.error || 'Could not mark all as read');
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} Mark all read
    </button>
  );
}

export function EmptyBell() {
  return <Bell className="h-6 w-6" />;
}

import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { queryStkStatus, pendingMpesaTransactions } from '@/lib/mpesa';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mpesa/status?checkout=ws_CO_…   → asks Daraja for the STK result
 * GET /api/mpesa/status                     → lists pending transactions
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const checkout = new URL(req.url).searchParams.get('checkout');
  if (!checkout) {
    if (!can(user, 'payments.view')) return Response.json({ error: 'Not permitted' }, { status: 403 });
    const pending = await pendingMpesaTransactions(100);
    return Response.json({ pending });
  }

  if (!can(user, 'payments.view') && !can(user, 'payments.pay_own')) {
    return Response.json({ error: 'Not permitted' }, { status: 403 });
  }

  try {
    const result = await queryStkStatus(checkout);
    return Response.json(result);
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Could not query the STK status.' }, { status: 502 });
  }
}

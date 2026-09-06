import type { NextRequest } from 'next/server';
import { handleStkCallback } from '@/lib/mpesa';

export const dynamic = 'force-dynamic';

/**
 * Daraja STK Push callback (Lipa Na M-Pesa Online).
 * Safaricom posts here; the payload is verified, stored verbatim and, on
 * success, reconciled into a payment with an automatic receipt.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ResultCode: 1, ResultDesc: 'Malformed payload' }, { status: 400 });
  }

  try {
    const result = await handleStkCallback(body);
    // Daraja expects this shape; anything else is retried by Safaricom.
    return Response.json({ ResultCode: 0, ResultDesc: result.ok ? 'Accepted' : result.message });
  } catch (e: any) {
    console.error('[mpesa callback]', e?.message);
    return Response.json({ ResultCode: 1, ResultDesc: 'Internal error' }, { status: 200 });
  }
}

export async function GET() {
  return Response.json({
    service: 'CMA M-Pesa Daraja callback',
    method: 'POST',
    documentation: 'Configure this URL as the STK Push callback in Settings → Payments.',
  });
}

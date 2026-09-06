import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { one } from '@/lib/db';
import { getOrganisation } from '@/lib/settings';
import { paymentAllocations } from '@/lib/payments';
import { receiptPdf } from '@/lib/pdf';

export const dynamic = 'force-dynamic';

/** GET /api/documents/receipt?receipt=CMA/202608/0001  (or ?payment_id=12) */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const url = new URL(req.url);
  const receiptNo = url.searchParams.get('receipt');
  const paymentId = url.searchParams.get('payment_id');
  if (!receiptNo && !paymentId) return Response.json({ error: 'Provide ?receipt= or ?payment_id=' }, { status: 400 });

  const receipt = await one<any>(
    `SELECT r.*, m.full_name, m.membership_no, m.phone, m.email,
            p.name AS parish_name
       FROM receipts r JOIN members m ON m.id = r.member_id
       LEFT JOIN parishes p ON p.id = m.parish_id
      WHERE ${receiptNo ? 'r.receipt_no = $1' : 'r.payment_id = $1'}
      ORDER BY r.id DESC LIMIT 1`,
    [receiptNo || Number(paymentId)],
  );
  if (!receipt) return Response.json({ error: 'Receipt not found' }, { status: 404 });

  const isOwn = user.member_id === Number(receipt.member_id);
  if (!isOwn && !can(user, 'payments.view') && !can(user, 'receipts.view')) {
    return Response.json({ error: 'You do not have permission to view this receipt.' }, { status: 403 });
  }

  const [member, allocations, org] = await Promise.all([
    one<any>('SELECT * FROM members WHERE id = $1', [receipt.member_id]),
    receipt.payment_id ? paymentAllocations(Number(receipt.payment_id)) : Promise.resolve([]),
    getOrganisation(),
  ]);

  const pdf = await receiptPdf({ org, receipt, member, allocations, parishName: receipt.parish_name });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${String(receipt.receipt_no).replace(/\//g, '-')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

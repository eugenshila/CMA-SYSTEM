import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { memberStatement } from '@/lib/payments';
import { getOrganisation } from '@/lib/settings';
import { statementPdf } from '@/lib/pdf';

export const dynamic = 'force-dynamic';

/** GET /api/documents/statement?member_id=6&from=2026-01-01&to=2026-09-06 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const url = new URL(req.url);
  const memberId = Number(url.searchParams.get('member_id')) || (user.member_id ?? 0);
  if (!memberId) return Response.json({ error: 'Provide ?member_id=' }, { status: 400 });
  if (!can(user, 'payments.view') && user.member_id !== memberId) {
    return Response.json({ error: 'You can only download your own statement.' }, { status: 403 });
  }

  try {
    const [statement, org] = await Promise.all([
      memberStatement(memberId, url.searchParams.get('from'), url.searchParams.get('to')),
      getOrganisation(),
    ]);
    const pdf = await statementPdf({ org, statement });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="statement-${statement.member.membership_no.replace(/\//g, '-')}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Could not build the statement.' }, { status: 500 });
  }
}

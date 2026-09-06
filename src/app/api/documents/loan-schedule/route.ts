import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { one, query } from '@/lib/db';
import { getOrganisation } from '@/lib/settings';
import { loanSchedulePdf } from '@/lib/pdf';

export const dynamic = 'force-dynamic';

/** GET /api/documents/loan-schedule?loan_id=3 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const loanId = Number(new URL(req.url).searchParams.get('loan_id'));
  if (!loanId) return Response.json({ error: 'Provide ?loan_id=' }, { status: 400 });

  const loan = await one<any>('SELECT * FROM loans WHERE id = $1', [loanId]);
  if (!loan) return Response.json({ error: 'Loan not found' }, { status: 404 });
  if (user.member_id !== Number(loan.member_id) && !can(user, 'loans.view')) {
    return Response.json({ error: 'You do not have permission to view this loan.' }, { status: 403 });
  }

  const [member, schedule, org] = await Promise.all([
    one<any>('SELECT * FROM members WHERE id = $1', [loan.member_id]),
    query<any>('SELECT * FROM loan_schedules WHERE loan_id = $1 ORDER BY installment_no', [loanId]),
    getOrganisation(),
  ]);

  const pdf = await loanSchedulePdf({ org, member, loan, schedule });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="loan-${loan.loan_no}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

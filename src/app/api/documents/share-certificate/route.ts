import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { one } from '@/lib/db';
import { getOrganisation } from '@/lib/settings';
import { shareCertificatePdf } from '@/lib/pdf';

export const dynamic = 'force-dynamic';

/** GET /api/documents/share-certificate?id=12 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!id) return Response.json({ error: 'Provide ?id=' }, { status: 400 });

  const share = await one<any>(
    `SELECT s.*, m.full_name, m.membership_no, COALESCE(sa.shares_count,0) AS total_shares
       FROM shares s JOIN members m ON m.id = s.member_id
       LEFT JOIN sacco_accounts sa ON sa.id = s.sacco_account_id
      WHERE s.id = $1`,
    [id],
  );
  if (!share) return Response.json({ error: 'Share certificate not found' }, { status: 404 });

  if (user.member_id !== Number(share.member_id) && !can(user, 'sacco.view')) {
    return Response.json({ error: 'You do not have permission to view this certificate.' }, { status: 403 });
  }

  const [member, org] = await Promise.all([one<any>('SELECT * FROM members WHERE id = $1', [share.member_id]), getOrganisation()]);
  const pdf = await shareCertificatePdf({ org, member, share, totalShares: Number(share.total_shares || share.shares_count) });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="share-${String(share.certificate_no).replace(/\//g, '-')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

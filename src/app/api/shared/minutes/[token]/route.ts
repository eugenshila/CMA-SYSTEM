import type { NextRequest } from 'next/server';
import { execute, one } from '@/lib/db';
import { sha256 } from '@/lib/crypto';
import { getOrganisation } from '@/lib/settings';
import { meetingMinutesDocx, meetingMinutesPdf, minutesFileStem } from '@/lib/minutes';

export const dynamic = 'force-dynamic';

/**
 * Bearer-link endpoint used in an SMS or WhatsApp message. The token is a
 * random 256-bit value and only its SHA-256 hash is stored. It is deliberately
 * limited to published minutes and expires after 90 days.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 30) return Response.json({ error: 'Invalid minutes link.' }, { status: 404 });

  const share = await one<any>(
    `SELECT ms.id AS share_id, ms.meeting_id, mt.*, p.name AS parish_name, c.name AS church_name
       FROM meeting_minutes_shares ms
       JOIN meetings mt ON mt.id = ms.meeting_id
       LEFT JOIN parishes p ON p.id = mt.parish_id
       LEFT JOIN churches c ON c.id = mt.church_id
      WHERE ms.token_hash = $1
        AND ms.revoked_at IS NULL
        AND ms.expires_at > now()
        AND mt.minutes_published_at IS NOT NULL`,
    [sha256(token)],
  );
  if (!share || !String(share.minutes || '').trim()) {
    return Response.json({ error: 'This meeting-minutes link has expired or is no longer available.' }, { status: 404 });
  }

  const format = new URL(req.url).searchParams.get('format') || 'pdf';
  if (!['pdf', 'word'].includes(format)) return Response.json({ error: 'Use format=pdf or word.' }, { status: 400 });

  try {
    const org = await getOrganisation();
    const stem = minutesFileStem(share);
    const body = format === 'word'
      ? await meetingMinutesDocx(share, org)
      : await meetingMinutesPdf(share, org);
    await execute(
      `UPDATE meeting_minutes_shares
          SET access_count = access_count + 1, last_accessed_at = now()
        WHERE id = $1`,
      [share.share_id],
    );
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': format === 'word' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
        'Content-Disposition': `${format === 'word' ? 'attachment' : 'inline'}; filename="${stem}.${format === 'word' ? 'docx' : 'pdf'}"`,
        'Cache-Control': 'private, max-age=0, no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'Could not create the minutes document.' }, { status: 500 });
  }
}

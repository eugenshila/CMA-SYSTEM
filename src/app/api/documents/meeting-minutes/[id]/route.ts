import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { one } from '@/lib/db';
import { readStoredFile } from '@/lib/files';
import { getOrganisation } from '@/lib/settings';
import { meetingMinutesDocx, meetingMinutesPdf, minutesFileStem } from '@/lib/minutes';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

async function meetingWithContext(id: number) {
  return one<any>(
    `SELECT mt.*, p.name AS parish_name, c.name AS church_name
       FROM meetings mt
       LEFT JOIN parishes p ON p.id = mt.parish_id
       LEFT JOIN churches c ON c.id = mt.church_id
      WHERE mt.id = $1`,
    [id],
  );
}

/**
 * GET /api/documents/meeting-minutes/:id?format=pdf|word|source
 *
 * Published minutes can be read by meeting participants; source scans and
 * editable Microsoft Word files are restricted to the secretary/staff.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;
  const meetingId = Number(id);
  if (!meetingId) return Response.json({ error: 'Meeting not found' }, { status: 404 });
  const meeting = await meetingWithContext(meetingId);
  if (!meeting) return Response.json({ error: 'Meeting not found' }, { status: 404 });

  const canManage = can(user, 'meetings.update');
  const canReadPublished = can(user, 'meetings.view') && Boolean(meeting.minutes_published_at);
  if (!canManage && !canReadPublished) {
    return Response.json({ error: 'You do not have permission to open these minutes.' }, { status: 403 });
  }

  const format = new URL(req.url).searchParams.get('format') || 'pdf';
  if (!['pdf', 'word', 'source'].includes(format)) {
    return Response.json({ error: 'Use format=pdf, word or source.' }, { status: 400 });
  }
  if ((format === 'source' || format === 'word') && !canManage) {
    return Response.json({ error: 'Only the secretary or an authorised officer can download this version.' }, { status: 403 });
  }
  if (format !== 'source' && !String(meeting.minutes || '').trim()) {
    return Response.json({ error: 'No reviewed minutes have been saved yet.' }, { status: 404 });
  }

  try {
    let body: Buffer;
    let contentType: string;
    let disposition: string;
    const stem = minutesFileStem(meeting);

    if (format === 'source') {
      if (!meeting.minutes_file_url) return Response.json({ error: 'No handwritten source scan was uploaded.' }, { status: 404 });
      const source = await readStoredFile(meeting.minutes_file_url);
      if (!source) return Response.json({ error: 'The saved minutes scan could not be read.' }, { status: 410 });
      body = source.buffer;
      contentType = meeting.minutes_file_mime_type || source.contentType;
      disposition = `inline; filename="${String(meeting.minutes_file_name || `${stem}-source`).replace(/"/g, '')}"`;
    } else if (format === 'word') {
      body = await meetingMinutesDocx(meeting, await getOrganisation());
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      disposition = `attachment; filename="${stem}.docx"`;
    } else {
      body = await meetingMinutesPdf(meeting, await getOrganisation());
      contentType = 'application/pdf';
      disposition = `inline; filename="${stem}.pdf"`;
    }

    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'meeting.minutes_downloaded',
      entityType: 'meetings',
      entityId: meetingId,
      entityLabel: meeting.title,
      description: `Opened ${format} meeting minutes for “${meeting.title}”`,
    });
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'Could not create the minutes document.' }, { status: 500 });
  }
}

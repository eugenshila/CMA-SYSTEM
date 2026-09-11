import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can, isStaff } from '@/lib/rbac';
import { one } from '@/lib/db';
import { readStoredFile } from '@/lib/files';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** GET /api/documents/file?id=5 — streams a stored member document (ID, photo, certificate…). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!id) return Response.json({ error: 'Provide ?id=' }, { status: 400 });

  const doc = await one<any>('SELECT * FROM member_documents WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!doc) return Response.json({ error: 'Document not found' }, { status: 404 });

  // Members may only ever open their OWN documents. Their self-service
  // documents.view permission must never grant access to another member's
  // files — only staff (non-member roles) with the relevant permission may
  // open documents across the parish.
  const isOwn = user.member_id === Number(doc.member_id);
  if (!isOwn && (!isStaff(user) || (!can(user, 'documents.view') && !can(user, 'members.view')))) {
    return Response.json({ error: 'You do not have permission to open this document.' }, { status: 403 });
  }

  const file = await readStoredFile(doc.file_url);
  if (!file) return Response.json({ error: 'The stored file could not be read.' }, { status: 410 });

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'document.viewed',
    entityType: 'member_documents',
    entityId: Number(doc.id),
    entityLabel: doc.title || doc.file_name,
    description: `Opened ${doc.doc_type} document "${doc.file_name}" for member #${doc.member_id}`,
  });

  return new Response(new Uint8Array(file.buffer), {
    headers: {
      'Content-Type': doc.mime_type || file.contentType,
      'Content-Disposition': `inline; filename="${String(doc.file_name || 'document').replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

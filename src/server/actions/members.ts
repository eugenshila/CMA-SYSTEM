'use server';

import { revalidatePath } from 'next/cache';
import { one, query, execute } from '@/lib/db';
import { requireUser, getCurrentUser, requestMeta } from '@/lib/auth';
import { can, assertCan } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { notify, notifyRole } from '@/lib/notify';
import { memberSchema, firstError, formDataToObject } from '@/lib/validators';
import { createMemberRecord, updateMemberRecord, nextMembershipNumber } from '@/server/services/members';
import { storeFile, toBuffer } from '@/lib/files';
import { normalisePhone } from '@/lib/money';
import { hashPassword } from '@/lib/crypto';
import type { ActionResult } from './auth';

async function actor() {
  const user = await requireUser();
  const { ip, userAgent } = await requestMeta();
  return { user, ip, userAgent };
}

/* ------------------------------------------------------------------ *
 * CREATE MEMBER (with photo, membership card, ID and other documents)
 * ------------------------------------------------------------------ */
export async function createMemberAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const { user, ip, userAgent } = await actor();
  if (!can(user, 'members.create')) return { ok: false, error: 'You do not have permission to register members.' };

  const raw = formDataToObject(formData);
  const parsed = memberSchema.safeParse({
    ...raw,
    church_id: raw.church_id ? Number(raw.church_id) : null,
    scc_id: raw.scc_id ? Number(raw.scc_id) : null,
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed) || 'Please correct the highlighted fields.' };
  const data = parsed.data;

  const parish = await one<any>('SELECT * FROM parishes WHERE id = $1', [data.parish_id]);
  if (!parish) return { ok: false, error: 'Select a valid parish.' };

  let member;
  try {
    member = await createMemberRecord({
      data: { ...data, membership_no: (data.membership_no || '').trim() || (await nextMembershipNumber(parish.code)) } as any,
      actor: { id: user.id, name: user.name },
      createLogin: raw.create_login === 'on' && raw.temp_password
        ? { password: String(raw.temp_password), ip, userAgent }
        : undefined,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not register the member.' };
  }

  // uploads
  try {
    const photo = formData.get('photo') as File | null;
    if (photo && photo.size > 0) {
      const stored = await storeFile({
        buffer: await toBuffer(photo),
        fileName: photo.name || 'photo.jpg',
        mimeType: photo.type || 'image/jpeg',
        folder: `members/${member.id}/photo`,
      });
      await execute('UPDATE members SET photo_url = $2 WHERE id = $1', [member.id, stored.file_url]);
    }

    const named: [string, string, string][] = [
      ['membership_card', 'membership_card', 'CMA membership card'],
      ['id_document', 'national_id', 'Identification document'],
      ['other_document', 'other', 'Supporting document'],
    ];
    for (const [field, docType, title] of named) {
      const entries = formData.getAll(field) as File[];
      for (const file of entries) {
        if (!file || !(file as any).size) continue;
        const stored = await storeFile({
          buffer: await toBuffer(file),
          fileName: (file as any).name || 'document',
          mimeType: (file as any).type || 'application/octet-stream',
          folder: `members/${member.id}/${docType}`,
        });
        await execute(
          `INSERT INTO member_documents (member_id, doc_type, title, file_name, file_url, mime_type, size_bytes, checksum, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [member.id, docType, title, stored.file_name, stored.file_url, stored.mime_type, stored.size_bytes, stored.checksum, user.id],
        );
      }
    }
  } catch (e: any) {
    return { ok: true, message: `Member registered (${member.membership_no}) but a document upload failed: ${e?.message}` };
  }

  revalidatePath('/members');
  revalidatePath('/dashboard');
  return { ok: true, message: `${member.full_name} registered successfully with CMA number ${member.membership_no}.`, data: { id: member.id } };
}

/* ------------------------------------------------------------------ *
 * UPDATE MEMBER
 * ------------------------------------------------------------------ */
export async function updateMemberAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const { user } = await actor();
  const memberId = Number(formData.get('member_id'));
  if (!memberId) return { ok: false, error: 'Member not found.' };

  const ownProfile = user.member_id === memberId;
  if (!ownProfile && !can(user, 'members.update')) {
    return { ok: false, error: 'You do not have permission to edit member records.' };
  }

  const raw = formDataToObject(formData);
  const parsed = memberSchema.safeParse({
    ...raw,
    church_id: raw.church_id ? Number(raw.church_id) : null,
    scc_id: raw.scc_id ? Number(raw.scc_id) : null,
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed) || 'Please correct the highlighted fields.' };

  if (ownProfile && !can(user, 'members.update')) {
    // members may only change contact details on their own record
    const allowed = ['alt_phone', 'email', 'residential_area', 'occupation', 'employer', 'next_of_kin',
      'next_of_kin_relation', 'next_of_kin_phone', 'emergency_contact', 'emergency_contact_rel',
      'emergency_contact_phone', 'marital_status'];
    Object.keys(parsed.data).forEach((k) => {
      if (!allowed.includes(k)) delete (parsed.data as any)[k];
    });
  }

  try {
    const updated = await updateMemberRecord({
      memberId,
      data: parsed.data as any,
      actor: { id: user.id, name: user.name },
      nationalId: raw.national_id ? String(raw.national_id) : undefined,
      documentType: raw.document_type === 'passport' ? 'passport' : 'national_id',
    });

    const photo = formData.get('photo') as File | null;
    if (photo && photo.size > 0) {
      const stored = await storeFile({
        buffer: await toBuffer(photo),
        fileName: photo.name || 'photo.jpg',
        mimeType: photo.type || 'image/jpeg',
        folder: `members/${memberId}/photo`,
      });
      await execute('UPDATE members SET photo_url = $2 WHERE id = $1', [memberId, stored.file_url]);
    }

    revalidatePath(`/members/${memberId}`);
    revalidatePath('/members');
    return { ok: true, message: `${updated.full_name}'s record has been updated.` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not update the member.' };
  }
}

export async function setMembershipStatusAction(memberId: number, status: string, reason?: string): Promise<ActionResult> {
  const { user } = await actor();
  if (!can(user, 'members.update')) return { ok: false, error: 'You do not have permission to change membership status.' };
  const member = await one<any>('SELECT * FROM members WHERE id = $1', [memberId]);
  if (!member) return { ok: false, error: 'Member not found.' };

  await execute('UPDATE members SET membership_status = $2, updated_by = $3 WHERE id = $1', [memberId, status, user.id]);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'member.status_updated',
    entityType: 'member',
    entityId: memberId,
    entityLabel: member.membership_no,
    description: `Membership status changed from ${member.membership_status} to ${status}${reason ? ` (${reason})` : ''}`,
    oldValues: { membership_status: member.membership_status },
    newValues: { membership_status: status, reason },
    severity: ['suspended', 'deceased'].includes(status) ? 'warning' : 'info',
  });
  await notify({
    memberId,
    title: 'CMA membership status updated',
    body: `Your membership status is now "${status}".${reason ? ` Reason: ${reason}` : ''}`,
    category: 'membership',
    priority: 'high',
    channels: ['in_system', 'sms'],
    referenceType: 'member',
    referenceId: memberId,
  });
  revalidatePath(`/members/${memberId}`);
  revalidatePath('/members');
  return { ok: true, message: `Membership status set to ${status}.` };
}

export async function approveMemberAction(memberId: number): Promise<ActionResult> {
  const { user } = await actor();
  if (!can(user, 'members.approve') && !can(user, 'members.update')) {
    return { ok: false, error: 'You do not have permission to approve members.' };
  }
  const member = await one<any>('SELECT * FROM members WHERE id = $1', [memberId]);
  if (!member) return { ok: false, error: 'Member not found.' };
  await execute(`UPDATE members SET membership_status = 'active', updated_by = $2 WHERE id = $1`, [memberId, user.id]);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'member.approved',
    entityType: 'member',
    entityId: memberId,
    entityLabel: member.membership_no,
    description: `Membership application approved for ${member.full_name}`,
    oldValues: { membership_status: member.membership_status },
    newValues: { membership_status: 'active' },
  });
  await notify({
    memberId,
    title: 'CMA membership approved',
    body: `Congratulations ${member.full_name}! Your CMA membership (${member.membership_no}) has been approved and is now active.`,
    category: 'membership',
    priority: 'high',
    channels: ['in_system', 'sms'],
    referenceType: 'member',
    referenceId: memberId,
  });
  revalidatePath(`/members/${memberId}`);
  revalidatePath('/members');
  return { ok: true, message: 'Member approved and activated.' };
}

/** Soft delete — member records are never removed from the database. */
export async function archiveMemberAction(memberId: number, reason: string): Promise<ActionResult> {
  const { user } = await actor();
  if (!can(user, 'members.delete')) return { ok: false, error: 'You do not have permission to archive member records.' };
  const member = await one<any>('SELECT * FROM members WHERE id = $1', [memberId]);
  if (!member) return { ok: false, error: 'Member not found.' };
  await execute('UPDATE members SET deleted_at = now(), updated_by = $2 WHERE id = $1', [memberId, user.id]);
  await execute(`UPDATE users SET status = 'disabled' WHERE member_id = $1`, [memberId]);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'member.archived',
    entityType: 'member',
    entityId: memberId,
    entityLabel: member.membership_no,
    description: `Member record archived (soft delete): ${reason}`,
    severity: 'critical',
  });
  revalidatePath('/members');
  return { ok: true, message: 'Member archived. The record is retained for audit purposes.' };
}

/* ------------------------------------------------------------------ *
 * DOCUMENTS
 * ------------------------------------------------------------------ */
export async function uploadMemberDocumentAction(_prev: any, formData: FormData): Promise<ActionResult> {
  const { user } = await actor();
  const memberId = Number(formData.get('member_id'));
  const ownProfile = user.member_id === memberId;
  if (!ownProfile && !can(user, 'documents.create')) {
    return { ok: false, error: 'You do not have permission to upload documents for this member.' };
  }
  if (ownProfile && !can(user, 'documents.create') && !can(user, 'documents.upload_own')) {
    return { ok: false, error: 'You do not have permission to upload documents.' };
  }

  const file = formData.get('file') as File | null;
  if (!file || !file.size) return { ok: false, error: 'Choose a file to upload.' };
  const docType = String(formData.get('doc_type') || 'other');
  const title = String(formData.get('title') || file.name);

  try {
    const stored = await storeFile({
      buffer: await toBuffer(file),
      fileName: file.name,
      mimeType: file.type,
      folder: `members/${memberId}/${docType}`,
    });
    await execute(
      `INSERT INTO member_documents (member_id, doc_type, title, file_name, file_url, mime_type, size_bytes, checksum, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [memberId, docType, title, stored.file_name, stored.file_url, stored.mime_type, stored.size_bytes, stored.checksum, user.id],
    );
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'document.uploaded',
      entityType: 'member_document',
      entityId: memberId,
      description: `Uploaded ${docType}: ${title}`,
    });
    revalidatePath(`/members/${memberId}`);
    return { ok: true, message: `${title} uploaded successfully.` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Upload failed.' };
  }
}

export async function verifyDocumentAction(documentId: number, verified: boolean): Promise<ActionResult> {
  const { user } = await actor();
  if (!can(user, 'documents.update')) return { ok: false, error: 'You do not have permission to verify documents.' };
  await execute('UPDATE member_documents SET verified = $2, verified_by = $3 WHERE id = $1', [documentId, verified, user.id]);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: verified ? 'document.verified' : 'document.unverified',
    entityType: 'member_document',
    entityId: documentId,
    description: `Document ${verified ? 'verified' : 'verification removed'}`,
  });
  revalidatePath('/members');
  revalidatePath('/documents');
  return { ok: true, message: verified ? 'Document verified.' : 'Document verification removed.' };
}

export async function deleteDocumentAction(documentId: number): Promise<ActionResult> {
  const { user } = await actor();
  if (!can(user, 'documents.delete')) return { ok: false, error: 'You do not have permission to delete documents.' };
  await execute('UPDATE member_documents SET deleted_at = now() WHERE id = $1', [documentId]);
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'document.deleted',
    entityType: 'member_document',
    entityId: documentId,
    description: 'Document soft-deleted',
    severity: 'warning',
  });
  revalidatePath('/documents');
  revalidatePath('/members');
  return { ok: true, message: 'Document removed.' };
}

/* ------------------------------------------------------------------ *
 * BULK: create login accounts for members without one
 * ------------------------------------------------------------------ */
export async function createLoginsForMembersAction(memberIds: number[], tempPassword: string): Promise<ActionResult> {
  const { user } = await actor();
  if (!can(user, 'users.create')) return { ok: false, error: 'You do not have permission to create user accounts.' };
  if (tempPassword.length < 8) return { ok: false, error: 'Temporary password must be at least 8 characters.' };

  const role = await one<{ id: number }>("SELECT id FROM roles WHERE key = 'member'");
  const hash = await hashPassword(tempPassword);
  let created = 0;
  for (const id of memberIds) {
    const member = await one<any>('SELECT * FROM members WHERE id = $1 AND user_id IS NULL AND deleted_at IS NULL', [id]);
    if (!member) continue;
    const phoneDup = await one<{ id: number }>('SELECT id FROM users WHERE phone = $1', [member.phone]);
    if (phoneDup) continue;
    const u = await one<any>(
      `INSERT INTO users (member_id, role_id, scope_parish_id, name, email, phone, login_id, password_hash, status, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',TRUE) RETURNING id`,
      [member.id, role!.id, member.parish_id, member.full_name, member.email, member.phone, member.membership_no, hash],
    );
    await execute('UPDATE members SET user_id = $2 WHERE id = $1', [member.id, u.id]);
    created++;
  }
  await logAudit({
    userId: user.id,
    userName: user.name,
    action: 'users.bulk_created',
    entityType: 'user',
    description: `Created ${created} member login account(s) with a temporary password`,
    severity: 'warning',
  });
  revalidatePath('/members');
  revalidatePath('/admin/users');
  return { ok: true, message: `${created} login account(s) created. Members must change the temporary password at first sign-in.` };
}

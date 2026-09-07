import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from './env';

export const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'storage/uploads');

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per document

export interface StoredFile {
  file_name: string;
  file_url: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  storage: 'local' | 'cloudinary';
  disk_path?: string;
}

function safeName(name: string) {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w.\- ]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 120) || 'file'
  );
}

export function validateUpload(opts: { name: string; type: string; size: number }) {
  const ext = path.extname(opts.name).toLowerCase();
  if (!ALLOWED_MIME.has(opts.type) && !['.jpg', '.jpeg', '.png', '.pdf', '.webp', '.docx', '.xlsx', '.csv'].includes(ext)) {
    throw new Error(`File type "${opts.type || ext}" is not allowed. Upload images, PDF, Word, Excel or CSV files only.`);
  }
  if (opts.size > MAX_BYTES) {
    throw new Error(`File is too large (${(opts.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 10 MB.`);
  }
  if (opts.size <= 0) throw new Error('The uploaded file is empty.');
}

/**
 * Persist an uploaded file. Uses Cloudinary when CLOUDINARY_URL is configured,
 * otherwise writes to local disk under ./storage/uploads (git-ignored) which is
 * served back through the authenticated /api/files/[...] route.
 */
export async function storeFile(opts: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  folder: string;
}): Promise<StoredFile> {
  validateUpload({ name: opts.fileName, type: opts.mimeType, size: opts.buffer.length });

  const checksum = crypto.createHash('sha256').update(opts.buffer).digest('hex');
  const folder = opts.folder.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 40) || 'general';
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const unique = `${stamp}-${crypto.randomBytes(6).toString('hex')}`;
  const name = safeName(opts.fileName);

  if (env.storage.cloudinaryUrl) {
    try {
      const uploaded = await uploadToCloudinary(opts.buffer, `${folder}/${unique}-${name}`, opts.mimeType);
      return {
        file_name: name,
        file_url: uploaded.secure_url,
        mime_type: opts.mimeType,
        size_bytes: opts.buffer.length,
        checksum,
        storage: 'cloudinary',
      };
    } catch (err: any) {
      console.error('[files] Cloudinary upload failed, falling back to local disk:', err?.message);
    }
  }

  const rel = path.join(folder, `${unique}-${name}`);
  const abs = path.join(UPLOAD_ROOT, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, opts.buffer, { mode: 0o600 });

  return {
    file_name: name,
    file_url: `/api/files/${rel}`,
    mime_type: opts.mimeType,
    size_bytes: opts.buffer.length,
    checksum,
    storage: 'local',
    disk_path: abs,
  };
}

async function uploadToCloudinary(buffer: Buffer, publicId: string, mimeType: string) {
  const url = new URL(env.storage.cloudinaryUrl);
  const cloudName = url.hostname.split('.')[0].replace('api.cloudinary.com', '') || url.pathname.split('/')[1];
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }));
  form.append('upload_preset', process.env.CLOUDINARY_PRESET || 'cma_uploads');
  form.append('public_id', publicId);
  form.append('folder', 'cma-system');
  const res = await fetch(endpoint, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Cloudinary responded ${res.status}`);
  return (await res.json()) as { secure_url: string; public_id: string };
}

export async function readStoredFile(fileUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!fileUrl) return null;
  if (/^https?:\/\//.test(fileUrl)) {
    const res = await fetch(fileUrl);
    if (!res.ok) return null;
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'application/octet-stream' };
  }
  const rel = fileUrl.replace(/^\/api\/files\//, '');
  const abs = path.join(UPLOAD_ROOT, rel);
  // path traversal protection
  if (!abs.startsWith(UPLOAD_ROOT)) return null;
  try {
    const buffer = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const contentType =
      { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' }[ext] ||
      'application/octet-stream';
    return { buffer, contentType };
  } catch {
    return null;
  }
}

export async function deleteStoredFile(fileUrl: string) {
  if (!fileUrl || /^https?:\/\//.test(fileUrl)) return false;
  const rel = fileUrl.replace(/^\/api\/files\//, '');
  const abs = path.join(UPLOAD_ROOT, rel);
  if (!abs.startsWith(UPLOAD_ROOT)) return false;
  try {
    await fs.unlink(abs);
    return true;
  } catch {
    return false;
  }
}

/** Convert a browser File / Blob / base64 data URL into a Buffer. */
export async function toBuffer(input: File | Blob | string): Promise<Buffer> {
  if (typeof input === 'string') {
    const base64 = input.includes(',') ? input.split(',')[1] : input;
    return Buffer.from(base64, 'base64');
  }
  return Buffer.from(await input.arrayBuffer());
}

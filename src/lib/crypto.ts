import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from './env';

/* ------------------------------------------------------------------ *
 * Password hashing (bcrypt, cost 12)
 * ------------------------------------------------------------------ */
export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export function passwordProblems(pw: string): string[] {
  const problems: string[] = [];
  if (!pw || pw.length < 8) problems.push('Password must be at least 8 characters long.');
  if (pw && !/[A-Za-z]/.test(pw)) problems.push('Password must contain at least one letter.');
  if (pw && !/[0-9]/.test(pw)) problems.push('Password must contain at least one number.');
  return problems;
}

/* ------------------------------------------------------------------ *
 * Field level encryption for sensitive personal data
 * (Kenya Data Protection Act 2019 – security of processing)
 * AES-256-GCM, key derived from ENCRYPTION_KEY.
 * ------------------------------------------------------------------ */
function key(): Buffer {
  return crypto.createHash('sha256').update(String(env.ENCRYPTION_KEY)).digest();
}

export function encryptField(plain?: string | null): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptField(payload?: string | null): string | null {
  if (!payload) return null;
  try {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') return payload; // legacy / plaintext
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Deterministic blind index so encrypted values stay searchable. */
export function blindIndex(plain?: string | null): string | null {
  if (!plain) return null;
  return crypto.createHmac('sha256', key()).update(String(plain).trim().toUpperCase()).digest('hex');
}

export function masked(plain?: string | null, keep = 4): string {
  if (!plain) return '';
  const s = String(plain);
  if (s.length <= keep) return '*'.repeat(s.length);
  return `${'*'.repeat(Math.max(2, s.length - keep))}${s.slice(-keep)}`;
}

/* ------------------------------------------------------------------ *
 * Tokens / OTP / verification codes
 * ------------------------------------------------------------------ */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export function generateOtp(length = 6): string {
  const digits = crypto.randomInt(0, 10 ** length);
  return String(digits).padStart(length, '0');
}

/** Human-friendly temporary password (used for first sign-in / admin reset). */
export function generateTempPassword(): string {
  const words = ['Cma', 'Heritage', 'Meadow', 'Grace', 'Faith', 'Hope', 'StJoseph', 'Riverdale'];
  const word = words[crypto.randomBytes(1)[0] % words.length];
  const digits = crypto.randomInt(1000, 9999);
  const specials = ['!', '@', '#', '$'];
  return `${word}@${digits}${specials[crypto.randomBytes(1)[0] % specials.length]}`;
}

export function generateReceiptNo(prefix = 'CMA'): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const rand = crypto.randomInt(100000, 999999);
  return `${prefix}/${y}${m}/${rand}`;
}

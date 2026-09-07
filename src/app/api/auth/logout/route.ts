import { NextResponse } from 'next/server';
import { logout } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get('next') || '/login?logged_out=1';
  try {
    await logout(false);
  } catch (err) {
    console.error('[logout]', err);
  }
  return NextResponse.redirect(new URL(next, request.url), { status: 303 });
}

export async function GET(request: Request) {
  return POST(request);
}

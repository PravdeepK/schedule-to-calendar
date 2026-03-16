import { NextRequest, NextResponse } from 'next/server';
import {
  clearProviderCookies,
  providerFromParam,
} from '@/lib/calendarAuth';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const provider = providerFromParam(body?.provider || '');
  if (!provider) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  clearProviderCookies(response.cookies, provider);
  return response;
}

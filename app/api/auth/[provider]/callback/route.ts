import { NextRequest, NextResponse } from 'next/server';
import {
  clearProviderCookies,
  exchangeCodeForTokens,
  providerFromParam,
  readOauthState,
  writeTokenCookies,
} from '@/lib/calendarAuth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerParam } = await params;
  const provider = providerFromParam(providerParam);
  if (!provider) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  if (error) {
    const redirectUrl = new URL('/', request.nextUrl.origin);
    redirectUrl.searchParams.set('auth_error', `${provider}:${error}`);
    return NextResponse.redirect(redirectUrl);
  }
  if (!code || !state) {
    return NextResponse.json(
      { error: 'Missing OAuth code or state' },
      { status: 400 }
    );
  }

  const expectedState = await readOauthState(provider);
  if (!expectedState || expectedState !== state) {
    return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
  }

  try {
    const tokenSet = await exchangeCodeForTokens(provider, request.nextUrl.origin, code);

    const redirectUrl = new URL('/', request.nextUrl.origin);
    redirectUrl.searchParams.set('connected', provider);
    const response = NextResponse.redirect(redirectUrl);
    writeTokenCookies(response.cookies, provider, tokenSet);
    return response;
  } catch (err) {
    const redirectUrl = new URL('/', request.nextUrl.origin);
    redirectUrl.searchParams.set(
      'auth_error',
      `${provider}:${err instanceof Error ? err.message : 'OAuth failed'}`
    );
    const response = NextResponse.redirect(redirectUrl);
    clearProviderCookies(response.cookies, provider);
    return response;
  }
}

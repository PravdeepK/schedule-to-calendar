import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthEndpoint,
  getClientId,
  getProviderScopes,
  getRedirectUri,
  providerFromParam,
  storeOauthState,
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

  const clientId = getClientId(provider);
  if (!clientId) {
    return NextResponse.json(
      {
        error:
          provider === 'google'
            ? 'Google OAuth is not configured'
            : 'Microsoft OAuth is not configured',
      },
      { status: 500 }
    );
  }

  const state = crypto.randomBytes(16).toString('hex');
  const origin = request.nextUrl.origin;
  const authUrl = new URL(getAuthEndpoint(provider));
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', getRedirectUri(provider, origin));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', getProviderScopes(provider));
  authUrl.searchParams.set('state', state);

  if (provider === 'google') {
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
  } else {
    authUrl.searchParams.set('response_mode', 'query');
  }

  const response = NextResponse.redirect(authUrl.toString());
  await storeOauthState(response.cookies, provider, state);
  return response;
}

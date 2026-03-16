import { cookies } from 'next/headers';

export type CalendarProvider = 'google' | 'outlook';

type TokenSet = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
};

const COOKIE_KEYS = {
  google: {
    access: 'google_access_token',
    refresh: 'google_refresh_token',
    expiresAt: 'google_access_expires_at',
    state: 'google_oauth_state',
  },
  outlook: {
    access: 'outlook_access_token',
    refresh: 'outlook_refresh_token',
    expiresAt: 'outlook_access_expires_at',
    state: 'outlook_oauth_state',
  },
} as const;

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function getCookieKeys(provider: CalendarProvider) {
  return COOKIE_KEYS[provider];
}

export function getProviderScopes(provider: CalendarProvider): string {
  if (provider === 'google') {
    return 'https://www.googleapis.com/auth/calendar.events';
  }

  return 'offline_access User.Read Calendars.ReadWrite';
}

export function getAuthEndpoint(provider: CalendarProvider): string {
  if (provider === 'google') {
    return 'https://accounts.google.com/o/oauth2/v2/auth';
  }
  return 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
}

export function getTokenEndpoint(provider: CalendarProvider): string {
  if (provider === 'google') {
    return 'https://oauth2.googleapis.com/token';
  }
  return 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
}

export function getClientId(provider: CalendarProvider): string | undefined {
  if (provider === 'google') {
    return process.env.GOOGLE_CLIENT_ID;
  }
  return process.env.MICROSOFT_CLIENT_ID;
}

export function getClientSecret(provider: CalendarProvider): string | undefined {
  if (provider === 'google') {
    return process.env.GOOGLE_CLIENT_SECRET;
  }
  return process.env.MICROSOFT_CLIENT_SECRET;
}

export function getRedirectUri(provider: CalendarProvider, origin: string): string {
  if (provider === 'google') {
    return (
      process.env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`
    );
  }
  return (
    process.env.MICROSOFT_REDIRECT_URI || `${origin}/api/auth/outlook/callback`
  );
}

export async function readStoredTokens(provider: CalendarProvider): Promise<TokenSet> {
  const store = await cookies();
  const keys = getCookieKeys(provider);
  const accessToken = store.get(keys.access)?.value;
  const refreshToken = store.get(keys.refresh)?.value;
  const expiresAtRaw = store.get(keys.expiresAt)?.value;
  const expiresAt = expiresAtRaw ? parseInt(expiresAtRaw, 10) : undefined;
  return {
    accessToken,
    refreshToken,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
  };
}

export function writeTokenCookies(
  response: ResponseCookieWriter,
  provider: CalendarProvider,
  tokenSet: { accessToken: string; refreshToken?: string; expiresAt: number }
) {
  const keys = getCookieKeys(provider);
  const options = baseCookieOptions();

  response.set(keys.access, tokenSet.accessToken, {
    ...options,
    maxAge: 60 * 60,
  });
  response.set(keys.expiresAt, String(tokenSet.expiresAt), {
    ...options,
    maxAge: 60 * 60,
  });
  if (tokenSet.refreshToken) {
    response.set(keys.refresh, tokenSet.refreshToken, {
      ...options,
      maxAge: 60 * 60 * 24 * 90,
    });
  }
}

export function clearProviderCookies(
  response: ResponseCookieWriter,
  provider: CalendarProvider
) {
  const keys = getCookieKeys(provider);
  const options = baseCookieOptions();
  response.set(keys.access, '', { ...options, maxAge: 0 });
  response.set(keys.refresh, '', { ...options, maxAge: 0 });
  response.set(keys.expiresAt, '', { ...options, maxAge: 0 });
  response.set(keys.state, '', { ...options, maxAge: 0 });
}

export async function getConnectedProviders() {
  const store = await cookies();
  return {
    google: Boolean(store.get(COOKIE_KEYS.google.refresh)?.value),
    outlook: Boolean(store.get(COOKIE_KEYS.outlook.refresh)?.value),
  };
}

export async function storeOauthState(
  response: ResponseCookieWriter,
  provider: CalendarProvider,
  state: string
) {
  const keys = getCookieKeys(provider);
  const options = baseCookieOptions();
  response.set(keys.state, state, { ...options, maxAge: 60 * 10 });
}

export async function readOauthState(provider: CalendarProvider): Promise<string | null> {
  const store = await cookies();
  const keys = getCookieKeys(provider);
  return store.get(keys.state)?.value || null;
}

export async function exchangeCodeForTokens(
  provider: CalendarProvider,
  origin: string,
  code: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  const clientId = getClientId(provider);
  const clientSecret = getClientSecret(provider);

  if (!clientId || !clientSecret) {
    throw new Error(
      provider === 'google'
        ? 'Google OAuth env vars are not configured'
        : 'Microsoft OAuth env vars are not configured'
    );
  }

  const form = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getRedirectUri(provider, origin),
    grant_type: 'authorization_code',
  });

  const response = await fetch(getTokenEndpoint(provider), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange ${provider} auth code: ${response.status} ${errorText}`
    );
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`No access token returned from ${provider}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
  };
}

export async function refreshProviderAccessToken(
  provider: CalendarProvider,
  origin: string,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  const clientId = getClientId(provider);
  const clientSecret = getClientSecret(provider);

  if (!clientId || !clientSecret) {
    throw new Error(
      provider === 'google'
        ? 'Google OAuth env vars are not configured'
        : 'Microsoft OAuth env vars are not configured'
    );
  }

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (provider === 'outlook') {
    form.set('scope', getProviderScopes('outlook'));
  }

  const response = await fetch(getTokenEndpoint(provider), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to refresh ${provider} access token: ${response.status} ${errorText}`
    );
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`No refreshed access token returned from ${provider}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
  };
}

export function providerFromParam(value: string): CalendarProvider | null {
  if (value === 'google' || value === 'outlook') {
    return value;
  }
  return null;
}

export type ResponseCookieWriter = {
  set: (
    name: string,
    value: string,
    options?: {
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
      path?: string;
      maxAge?: number;
    }
  ) => void;
};

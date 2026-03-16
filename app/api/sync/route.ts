import { NextRequest, NextResponse } from 'next/server';
import {
  providerFromParam,
  readStoredTokens,
  refreshProviderAccessToken,
  writeTokenCookies,
  type CalendarProvider,
} from '@/lib/calendarAuth';
import {
  extractEventsFromImages,
  expandWeeklyRepeats,
  toLocalDateTimeString,
  uniqueAndSortedEvents,
} from '@/lib/schedule';

function parseRepeatOptions(formData: FormData) {
  const repeatWeekly = formData.get('repeatWeekly') === 'true';
  const repeatMode = (formData.get('repeatMode') as 'weeks' | 'date') || 'weeks';
  const repeatWeeks =
    repeatWeekly && repeatMode === 'weeks'
      ? parseInt(formData.get('repeatWeeks') as string, 10) || 4
      : undefined;
  const repeatUntilDate =
    repeatWeekly && repeatMode === 'date'
      ? (formData.get('repeatUntilDate') as string)
      : undefined;

  return { repeatWeekly, repeatMode, repeatWeeks, repeatUntilDate };
}

async function ensureAccessToken(
  provider: CalendarProvider,
  origin: string
): Promise<{ accessToken: string; refreshed?: { accessToken: string; refreshToken?: string; expiresAt: number } }> {
  const stored = await readStoredTokens(provider);
  const stillValid =
    stored.accessToken && stored.expiresAt && stored.expiresAt > Date.now() + 60_000;
  if (stillValid) {
    return { accessToken: stored.accessToken as string };
  }
  if (!stored.refreshToken) {
    throw new Error(`No ${provider} refresh token found. Please connect ${provider} first.`);
  }

  const refreshed = await refreshProviderAccessToken(
    provider,
    origin,
    stored.refreshToken
  );
  return { accessToken: refreshed.accessToken, refreshed };
}

async function createGoogleEvent(
  accessToken: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
    timeZone: string;
  }
) {
  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: event.summary,
        description: event.description || undefined,
        location: event.location || undefined,
        start: {
          dateTime: event.startDateTime,
          timeZone: event.timeZone,
        },
        end: {
          dateTime: event.endDateTime,
          timeZone: event.timeZone,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Calendar API error (${response.status}): ${errorText}`);
  }
}

async function createOutlookEvent(
  accessToken: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
    timeZone: string;
  }
) {
  const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject: event.summary,
      body: event.description
        ? { contentType: 'text', content: event.description }
        : undefined,
      location: event.location ? { displayName: event.location } : undefined,
      start: {
        dateTime: event.startDateTime,
        timeZone: event.timeZone,
      },
      end: {
        dateTime: event.endDateTime,
        timeZone: event.timeZone,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Outlook Calendar API error (${response.status}): ${errorText}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        {
          error:
            'Anthropic API key is not configured. Please set ANTHROPIC_API_KEY.',
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const provider = providerFromParam((formData.get('provider') as string) || '');
    if (!provider) {
      return NextResponse.json({ error: 'Invalid sync provider' }, { status: 400 });
    }

    const userTimeZone =
      (formData.get('timeZone') as string) || 'America/New_York';
    const images = formData.getAll('images') as File[];

    if (!images || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    const { repeatWeekly, repeatMode, repeatWeeks, repeatUntilDate } =
      parseRepeatOptions(formData);
    if (repeatWeekly) {
      if (
        repeatMode === 'weeks' &&
        (repeatWeeks === undefined || repeatWeeks < 1 || repeatWeeks > 52)
      ) {
        return NextResponse.json(
          { error: 'Invalid repeat weeks. Must be between 1 and 52' },
          { status: 400 }
        );
      }
      if (repeatMode === 'date' && !repeatUntilDate) {
        return NextResponse.json(
          { error: 'Repeat until date is required for date repeat mode' },
          { status: 400 }
        );
      }
    }

    const token = await ensureAccessToken(provider, request.nextUrl.origin);
    const { events: extractedEvents, errors } = await extractEventsFromImages(images);
    if (extractedEvents.length === 0) {
      const message =
        errors.length > 0
          ? `Failed to extract events from images. ${errors.join(' ')}`
          : 'No schedule events found in images.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const uniqueEvents = uniqueAndSortedEvents(extractedEvents);
    const eventsToSync = expandWeeklyRepeats(
      uniqueEvents,
      repeatWeekly,
      repeatMode,
      repeatWeeks,
      repeatUntilDate
    );

    let syncedCount = 0;
    for (const event of eventsToSync) {
      const payload = {
        summary: event.title || 'Work Schedule',
        description: event.description || undefined,
        location: event.location || undefined,
        startDateTime: toLocalDateTimeString(event.start),
        endDateTime: toLocalDateTimeString(event.end),
        timeZone: userTimeZone,
      };

      if (provider === 'google') {
        await createGoogleEvent(token.accessToken, payload);
      } else {
        await createOutlookEvent(token.accessToken, payload);
      }
      syncedCount += 1;
    }

    const response = NextResponse.json({
      success: true,
      provider,
      syncedCount,
      extractedCount: uniqueEvents.length,
    });
    if (token.refreshed) {
      writeTokenCookies(response.cookies, provider, token.refreshed);
    }
    return response;
  } catch (error) {
    console.error('Calendar sync failed:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to sync events to calendar.',
      },
      { status: 500 }
    );
  }
}

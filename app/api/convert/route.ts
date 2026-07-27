import { NextRequest, NextResponse } from 'next/server';
import {
  extractEventsFromFiles,
  generateCalendar,
  uniqueAndSortedEvents,
} from '@/lib/schedule';
import { validateUploads } from '@/lib/uploadLimits';

// Extraction is slow by nature: a dense multi-page timetable can take ~3 minutes
// of model time. Serverless hosts kill a function long before that on their default
// timeout, so raise it explicitly. Vercel caps this at 60 on Hobby and 300 on Pro;
// no effect on `next dev` or a long-lived Node server.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Anthropic API key is not configured. Please set ANTHROPIC_API_KEY environment variable.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const format = formData.get('format') as 'outlook' | 'apple';
    const repeatWeekly = formData.get('repeatWeekly') === 'true';
    const repeatMode = (formData.get('repeatMode') as 'weeks' | 'date') || 'weeks';
    const repeatWeeks = repeatWeekly && repeatMode === 'weeks' ? parseInt(formData.get('repeatWeeks') as string) || 4 : undefined;
    const repeatUntilDate = repeatWeekly && repeatMode === 'date' ? formData.get('repeatUntilDate') as string : undefined;
    
    if (files.length === 0) {
      return NextResponse.json({ error: 'No schedule files provided' }, { status: 400 });
    }

    const uploadError = validateUploads(files);
    if (uploadError) {
      return NextResponse.json({ error: uploadError }, { status: 400 });
    }

    if (!format || (format !== 'outlook' && format !== 'apple')) {
      return NextResponse.json({ error: 'Invalid format. Must be "outlook" or "apple"' }, { status: 400 });
    }
    
    if (repeatWeekly) {
      if (repeatMode === 'weeks' && (repeatWeeks === undefined || repeatWeeks < 1 || repeatWeeks > 52)) {
        return NextResponse.json({ error: 'Invalid repeat weeks. Must be between 1 and 52' }, { status: 400 });
      }
      if (repeatMode === 'date' && !repeatUntilDate) {
        return NextResponse.json({ error: 'Repeat until date is required when repeat mode is set to date' }, { status: 400 });
      }
      if (repeatMode === 'date' && repeatUntilDate) {
        const endDate = new Date(repeatUntilDate);
        if (isNaN(endDate.getTime())) {
          return NextResponse.json({ error: 'Invalid repeat until date format' }, { status: 400 });
        }
      }
    }
    
    const { events: allEvents, errors } = await extractEventsFromFiles(files);
    
    if (allEvents.length === 0) {
      const errorMsg = errors.length > 0 
        ? `Failed to extract events from files. ${errors.join(' ')}`
        : 'No schedule events found. Please ensure the images or PDFs are clear and contain readable work schedules.';
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }
    
    const uniqueEvents = uniqueAndSortedEvents(allEvents);
    const calendarContent = generateCalendar(
      uniqueEvents,
      repeatWeekly,
      repeatMode,
      repeatWeeks,
      repeatUntilDate
    );
    
    return new NextResponse(calendarContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar',
        'Content-Disposition': `attachment; filename="schedule.ics"`,
      },
    });
    
  } catch (error) {
    console.error('Error processing schedule:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error 
          ? error.message 
          : 'Failed to process schedule. Please ensure the images or PDFs are clear and contain readable schedule information.' 
      },
      { status: 500 }
    );
  }
}

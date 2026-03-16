import { NextRequest, NextResponse } from 'next/server';
import {
  extractEventsFromImages,
  generateCalendar,
  uniqueAndSortedEvents,
} from '@/lib/schedule';

export async function POST(request: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Anthropic API key is not configured. Please set ANTHROPIC_API_KEY environment variable.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const images = formData.getAll('images') as File[];
    const format = formData.get('format') as 'outlook' | 'apple';
    const repeatWeekly = formData.get('repeatWeekly') === 'true';
    const repeatMode = (formData.get('repeatMode') as 'weeks' | 'date') || 'weeks';
    const repeatWeeks = repeatWeekly && repeatMode === 'weeks' ? parseInt(formData.get('repeatWeeks') as string) || 4 : undefined;
    const repeatUntilDate = repeatWeekly && repeatMode === 'date' ? formData.get('repeatUntilDate') as string : undefined;
    
    if (!images || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
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
    
    const { events: allEvents, errors } = await extractEventsFromImages(images);
    
    if (allEvents.length === 0) {
      const errorMsg = errors.length > 0 
        ? `Failed to extract events from images. ${errors.join(' ')}`
        : 'No schedule events found in any of the images. Please ensure the images are clear and contain readable work schedules.';
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
          : 'Failed to process schedule. Please ensure the images are clear and contain readable schedule information.' 
      },
      { status: 500 }
    );
  }
}

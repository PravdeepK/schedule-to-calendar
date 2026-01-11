import { NextRequest, NextResponse } from 'next/server';
import ical from 'ical-generator';
import OpenAI from 'openai';

interface ScheduleEvent {
  start: Date;
  end: Date;
  title?: string;
  description?: string;
  location?: string;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function parseEventsFromJSON(eventsData: any[]): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];
  
  for (const event of eventsData) {
    try {
      const startDate = new Date(event.start);
      const endDate = new Date(event.end);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        continue;
      }
      
      events.push({
        start: startDate,
        end: endDate,
        title: event.title || event.summary || 'Work Schedule',
        description: event.description || '',
        location: event.location || '',
      });
    } catch (err) {
      console.error('Error parsing event:', err);
    }
  }
  
  return events;
}

async function processImage(file: File): Promise<ScheduleEvent[]> {
  // Convert image to base64
  const arrayBuffer = await file.arrayBuffer();
  const base64Image = Buffer.from(arrayBuffer).toString('base64');
  const mimeType = file.type || 'image/png';
  
  // Use GPT-4 Vision to extract schedule information
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this work schedule image and extract all scheduled shifts/events. Return a JSON object with an "events" array containing events in this exact format:

{
  "events": [
    {
      "start": "ISO 8601 datetime string (e.g., 2026-01-10T15:00:00)",
      "end": "ISO 8601 datetime string (e.g., 2026-01-10T22:00:00)",
      "title": "Event title (e.g., Coverage, Task, or Work Schedule)",
      "description": "Optional description (e.g., hours worked)",
      "location": "Optional location"
    }
  ]
}

Important:
- Parse dates carefully. If only month/day is shown, infer the year from context (current year or next year if dates appear to be in the future).
- Extract times in 12-hour or 24-hour format and convert to ISO 8601 datetime strings.
- Include all work shifts, time-off requests, and scheduled events.
- For time-off or approved requests, set appropriate start/end times.
- Return ONLY valid JSON in the format above, no markdown, no code blocks, just the JSON object.`
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
            },
          },
        ],
      },
    ],
    temperature: 0.1,
  });
  
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from AI model');
  }
  
  // Parse the JSON response
  let eventsData;
  try {
    // Try to extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1] : content.trim();
    const parsed = JSON.parse(jsonText);
    // Handle both { events: [...] } and direct array formats
    eventsData = Array.isArray(parsed) ? parsed : (parsed.events || parsed.data || []);
  } catch (err) {
    console.error('JSON parsing error:', err, 'Content:', content);
    throw new Error('Failed to parse AI response');
  }
  
  if (!Array.isArray(eventsData)) {
    return [];
  }
  
  // Convert to ScheduleEvent format
  return parseEventsFromJSON(eventsData);
}

function generateCalendar(events: ScheduleEvent[], format: 'outlook' | 'apple'): string {
  const calendar = ical({
    prodId: {
      company: 'Schedule to Calendar',
      product: 'Schedule Converter',
      language: 'EN'
    },
    name: 'Work Schedule',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  });
  
  events.forEach(event => {
    calendar.createEvent({
      start: event.start,
      end: event.end,
      summary: event.title || 'Work Schedule',
      description: event.description || '',
      location: event.location || '',
      allDay: false
    });
  });
  
  return calendar.toString();
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key is not configured. Please set OPENAI_API_KEY environment variable.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const images = formData.getAll('images') as File[];
    const format = formData.get('format') as 'outlook' | 'apple';
    
    if (!images || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }
    
    if (!format || (format !== 'outlook' && format !== 'apple')) {
      return NextResponse.json({ error: 'Invalid format. Must be "outlook" or "apple"' }, { status: 400 });
    }
    
    // Process all images and collect events
    const allEvents: ScheduleEvent[] = [];
    const errors: string[] = [];
    
    for (let i = 0; i < images.length; i++) {
      try {
        const events = await processImage(images[i]);
        allEvents.push(...events);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Image ${i + 1}: ${errorMessage}`);
        console.error(`Error processing image ${i + 1}:`, err);
      }
    }
    
    if (allEvents.length === 0) {
      const errorMsg = errors.length > 0 
        ? `Failed to extract events from images. ${errors.join(' ')}`
        : 'No schedule events found in any of the images. Please ensure the images are clear and contain readable work schedules.';
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }
    
    // Remove duplicate events (same start time and title)
    const uniqueEvents = allEvents.filter((event, index, self) =>
      index === self.findIndex((e) => 
        e.start.getTime() === event.start.getTime() &&
        e.end.getTime() === event.end.getTime() &&
        e.title === event.title
      )
    );
    
    // Sort events by start time
    uniqueEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
    
    // Generate calendar file with all events
    const calendarContent = generateCalendar(uniqueEvents, format);
    
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

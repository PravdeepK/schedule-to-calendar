import { NextRequest, NextResponse } from 'next/server';
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
      // Parse ISO string and create local Date objects (treat as local time, not UTC)
      // Example: "2026-01-10T15:00:00" -> local Date for Jan 10, 2026 at 3:00 PM
      const startStr = event.start;
      const endStr = event.end;
      
      // Extract date/time components from ISO string (YYYY-MM-DDTHH:MM:SS)
      const startMatch = startStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      const endMatch = endStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      
      if (!startMatch || !endMatch) {
        // Fallback to standard Date parsing if format doesn't match
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
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
        continue;
      }
      
      // Create local Date objects (not UTC)
      const startDate = new Date(
        parseInt(startMatch[1]), // year
        parseInt(startMatch[2]) - 1, // month (0-indexed)
        parseInt(startMatch[3]), // day
        parseInt(startMatch[4]), // hour
        parseInt(startMatch[5]), // minute
        parseInt(startMatch[6])  // second
      );
      
      const endDate = new Date(
        parseInt(endMatch[1]), // year
        parseInt(endMatch[2]) - 1, // month (0-indexed)
        parseInt(endMatch[3]), // day
        parseInt(endMatch[4]), // hour
        parseInt(endMatch[5]), // minute
        parseInt(endMatch[6])  // second
      );
      
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
            text: `Analyze this work schedule image and extract all scheduled work shifts/events. Return a JSON object with an "events" array containing events in this exact format:

{
  "events": [
    {
      "start": "ISO 8601 datetime string without timezone (e.g., 2026-01-10T15:00:00)",
      "end": "ISO 8601 datetime string without timezone (e.g., 2026-01-10T22:00:00)",
      "title": "Event title (e.g., Coverage, Task, or Work Schedule)",
      "description": "Optional description (e.g., hours worked)",
      "location": "Optional location"
    }
  ]
}

Important:
- Parse dates carefully. If only month/day is shown, infer the year from context (current year or next year if dates appear to be in the future).
- Extract times exactly as shown in the schedule (12-hour or 24-hour format) and convert to ISO 8601 format WITHOUT timezone (format: YYYY-MM-DDTHH:MM:SS).
- Times should be treated as local time - do NOT add timezone information.
- For 12-hour format with AM/PM, convert correctly (e.g., 3:00 PM = 15:00, 3:00 AM = 03:00).
- ONLY include actual work shifts, coverage, tasks, and scheduled work events.
- DO NOT include time-off requests, approved time-off, vacation days, or any non-work events.
- Only extract shifts that have specific start and end times (work hours).
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

function formatICSDateTime(date: Date): string {
  // Format as YYYYMMDDTHHMMSS (floating time, no timezone)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function escapeICSValue(value: string): string {
  // Escape special characters for ICS format
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function generateCalendar(events: ScheduleEvent[], format: 'outlook' | 'apple'): string {
  // Generate ICS file manually with floating times (no timezone)
  let ics = 'BEGIN:VCALENDAR\r\n';
  ics += 'VERSION:2.0\r\n';
  ics += 'PRODID:-//Schedule to Calendar//Schedule Converter//EN\r\n';
  ics += 'CALSCALE:GREGORIAN\r\n';
  ics += 'METHOD:PUBLISH\r\n';
  ics += `X-WR-CALNAME:Work Schedule\r\n`;
  
  events.forEach(event => {
    const start = formatICSDateTime(event.start);
    const end = formatICSDateTime(event.end);
    const summary = escapeICSValue(event.title || 'Work Schedule');
    const description = escapeICSValue(event.description || '');
    const location = escapeICSValue(event.location || '');
    
    ics += 'BEGIN:VEVENT\r\n';
    ics += `DTSTART:${start}\r\n`;
    ics += `DTEND:${end}\r\n`;
    ics += `SUMMARY:${summary}\r\n`;
    if (description) {
      ics += `DESCRIPTION:${description}\r\n`;
    }
    if (location) {
      ics += `LOCATION:${location}\r\n`;
    }
    ics += 'END:VEVENT\r\n';
  });
  
  ics += 'END:VCALENDAR\r\n';
  return ics;
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

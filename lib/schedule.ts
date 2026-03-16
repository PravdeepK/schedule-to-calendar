import Anthropic from '@anthropic-ai/sdk';

export interface ScheduleEvent {
  start: Date;
  end: Date;
  title?: string;
  description?: string;
  location?: string;
}

interface ParsedModelEvent {
  start?: string;
  end?: string;
  title?: string;
  summary?: string;
  description?: string;
  location?: string;
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export function getSupportedImageMimeType(
  mimeType: string
): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'image/gif' ||
    mimeType === 'image/webp'
  ) {
    return mimeType;
  }

  return 'image/png';
}

export function parseEventsFromJSON(eventsData: unknown[]): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];

  for (const item of eventsData) {
    try {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const event = item as ParsedModelEvent;
      if (typeof event.start !== 'string' || typeof event.end !== 'string') {
        continue;
      }

      const startStr = event.start;
      const endStr = event.end;

      const startMatch = startStr.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/
      );
      const endMatch = endStr.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/
      );

      if (!startMatch || !endMatch) {
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

      const startDate = new Date(
        parseInt(startMatch[1], 10),
        parseInt(startMatch[2], 10) - 1,
        parseInt(startMatch[3], 10),
        parseInt(startMatch[4], 10),
        parseInt(startMatch[5], 10),
        parseInt(startMatch[6], 10)
      );

      const endDate = new Date(
        parseInt(endMatch[1], 10),
        parseInt(endMatch[2], 10) - 1,
        parseInt(endMatch[3], 10),
        parseInt(endMatch[4], 10),
        parseInt(endMatch[5], 10),
        parseInt(endMatch[6], 10)
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
  const arrayBuffer = await file.arrayBuffer();
  const base64Image = Buffer.from(arrayBuffer).toString('base64');
  const mimeType = getSupportedImageMimeType(file.type || 'image/png');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
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
- Return ONLY valid JSON in the format above, no markdown, no code blocks, just the JSON object.`,
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: base64Image,
            },
          },
        ],
      },
    ],
    temperature: 0.1,
  });

  const content = response.content
    .filter((block) => block.type === 'text')
    .map((block) => ('text' in block ? block.text : ''))
    .join('\n')
    .trim();

  if (!content) {
    throw new Error('No response from AI model');
  }

  let eventsData;
  try {
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1] : content.trim();
    const parsed = JSON.parse(jsonText);
    eventsData = Array.isArray(parsed) ? parsed : parsed.events || parsed.data || [];
  } catch (err) {
    console.error('JSON parsing error:', err, 'Content:', content);
    throw new Error('Failed to parse AI response');
  }

  if (!Array.isArray(eventsData)) {
    return [];
  }

  return parseEventsFromJSON(eventsData);
}

export async function extractEventsFromImages(images: File[]): Promise<{
  events: ScheduleEvent[];
  errors: string[];
}> {
  const allEvents: ScheduleEvent[] = [];
  const errors: string[] = [];

  for (let i = 0; i < images.length; i += 1) {
    try {
      const events = await processImage(images[i]);
      allEvents.push(...events);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Image ${i + 1}: ${errorMessage}`);
      console.error(`Error processing image ${i + 1}:`, err);
    }
  }

  return { events: allEvents, errors };
}

function formatICSDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function escapeICSValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function formatICSDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function generateCalendar(
  events: ScheduleEvent[],
  repeatWeekly?: boolean,
  repeatMode?: 'weeks' | 'date',
  repeatWeeks?: number,
  repeatUntilDate?: string
): string {
  let ics = 'BEGIN:VCALENDAR\r\n';
  ics += 'VERSION:2.0\r\n';
  ics += 'PRODID:-//Schedule to Calendar//Schedule Converter//EN\r\n';
  ics += 'CALSCALE:GREGORIAN\r\n';
  ics += 'METHOD:PUBLISH\r\n';
  ics += 'X-WR-CALNAME:Work Schedule\r\n';

  events.forEach((event) => {
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

    if (repeatWeekly) {
      if (repeatMode === 'weeks' && repeatWeeks && repeatWeeks > 0) {
        ics += `RRULE:FREQ=WEEKLY;COUNT=${repeatWeeks}\r\n`;
      } else if (repeatMode === 'date' && repeatUntilDate) {
        const untilDate = new Date(`${repeatUntilDate}T23:59:59`);
        const untilDateStr = formatICSDate(untilDate);
        ics += `RRULE:FREQ=WEEKLY;UNTIL=${untilDateStr}\r\n`;
      }
    }

    ics += 'END:VEVENT\r\n';
  });

  ics += 'END:VCALENDAR\r\n';
  return ics;
}

export function uniqueAndSortedEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  const uniqueEvents = events.filter(
    (event, index, self) =>
      index ===
      self.findIndex(
        (e) =>
          e.start.getTime() === event.start.getTime() &&
          e.end.getTime() === event.end.getTime() &&
          e.title === event.title
      )
  );

  uniqueEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
  return uniqueEvents;
}

export function expandWeeklyRepeats(
  events: ScheduleEvent[],
  repeatWeekly?: boolean,
  repeatMode?: 'weeks' | 'date',
  repeatWeeks?: number,
  repeatUntilDate?: string
): ScheduleEvent[] {
  if (!repeatWeekly) {
    return events;
  }

  const expanded: ScheduleEvent[] = [];

  events.forEach((event) => {
    const occurrences: ScheduleEvent[] = [];

    if (repeatMode === 'date' && repeatUntilDate) {
      const until = new Date(`${repeatUntilDate}T23:59:59`);
      let cursorStart = new Date(event.start);
      let cursorEnd = new Date(event.end);
      while (cursorStart <= until) {
        occurrences.push({
          start: new Date(cursorStart),
          end: new Date(cursorEnd),
          title: event.title,
          description: event.description,
          location: event.location,
        });
        cursorStart = new Date(cursorStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        cursorEnd = new Date(cursorEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
      }
    } else {
      const count = Math.max(1, Math.min(52, repeatWeeks || 1));
      for (let i = 0; i < count; i += 1) {
        const delta = i * 7 * 24 * 60 * 60 * 1000;
        occurrences.push({
          start: new Date(event.start.getTime() + delta),
          end: new Date(event.end.getTime() + delta),
          title: event.title,
          description: event.description,
          location: event.location,
        });
      }
    }

    expanded.push(...occurrences);
  });

  return uniqueAndSortedEvents(expanded);
}

export function toLocalDateTimeString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

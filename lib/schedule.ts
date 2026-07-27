import Anthropic from '@anthropic-ai/sdk';
import { renderPdfPages } from './pdf';

export interface ScheduleEvent {
  start: Date;
  end: Date;
  title?: string;
  description?: string;
  location?: string;
  /** Last date this event repeats weekly through, from the schedule itself. */
  repeatUntil?: Date;
  /**
   * True once an event came from a recurring block in the source document and
   * has already been expanded into concrete occurrences. These opt out of the
   * user's global "repeat weekly" option, which would otherwise repeat a series
   * that the document already fully described.
   */
  recurring?: boolean;
}

interface ParsedModelEvent {
  start?: string;
  end?: string;
  title?: string;
  summary?: string;
  description?: string;
  location?: string;
  repeatUntil?: string;
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * How hard the model thinks before answering. This is by far the main speed
 * lever — nearly all of a request's wall-clock time is thinking, not transfer.
 *
 * It stays at `high` despite that, because lowering it was measured and it cost
 * accuracy. On one page in isolation the levels look interchangeable — high 100s
 * / 10.5k output tokens, medium 30s / 3.2k, low 17s / 1.7k, all three returning
 * the same 7 events. On the real 4-page timetable in testingFiles they are not:
 * across two runs each, `medium` read a 09:00-12:00 block as 09:00-13:00 both
 * times and once placed it on the wrong weekday column, while `high` read it
 * correctly both times. A wrong end time is worse than a slow answer here — it
 * lands in someone's calendar looking correct.
 *
 * SCHEDULE_EXTRACTION_EFFORT overrides it. If you lower it, check the result
 * against the "Total Hours" figure printed on the page (see the prompt below);
 * that reconciliation is the first thing lower effort skimps on.
 */
const EXTRACTION_EFFORT = (process.env.SCHEDULE_EXTRACTION_EFFORT ||
  'high') as 'low' | 'medium' | 'high';

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

  throw new Error(`Unsupported image type: ${mimeType || 'unknown'}`);
}

function parseRepeatUntil(value: unknown): Date | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return undefined;
  }

  const date = new Date(
    parseInt(match[1], 10),
    parseInt(match[2], 10) - 1,
    parseInt(match[3], 10),
    23,
    59,
    59
  );

  return isNaN(date.getTime()) ? undefined : date;
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
          repeatUntil: parseRepeatUntil(event.repeatUntil),
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
        repeatUntil: parseRepeatUntil(event.repeatUntil),
      });
    } catch (err) {
      console.error('Error parsing event:', err);
    }
  }

  return events;
}


/**
 * Adds whole weeks by calendar date rather than by milliseconds, so an event
 * keeps its wall-clock time across a daylight saving change. A term that runs
 * into November would otherwise drift by an hour partway through.
 */
function addWeeks(date: Date, weeks: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + weeks * 7,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  );
}

/**
 * Ceiling on a series the *model* claimed, as a guard against a hallucinated
 * far-future end date turning one block into thousands of events. No real
 * academic term runs beyond a year, so this never binds on valid input.
 */
const MAX_DOCUMENT_WEEKS = 60;

/**
 * Ceiling on a series the *user* asked for by picking an end date. They chose
 * the date explicitly, so this is only a runaway guard and must stay far above
 * any plausible request — truncating here would silently drop occurrences the
 * user can see they asked for.
 */
const MAX_USER_WEEKS = 520;

/**
 * Turns events that the source document itself describes as weekly (a timetable
 * block spanning a range of weeks) into concrete occurrences. Marked recurring
 * so the user's global repeat option leaves them alone.
 */
export function expandDocumentRecurrence(
  events: ScheduleEvent[]
): ScheduleEvent[] {
  const expanded: ScheduleEvent[] = [];

  for (const event of events) {
    if (!event.repeatUntil || event.repeatUntil <= event.start) {
      expanded.push(event);
      continue;
    }

    for (let week = 0; week < MAX_DOCUMENT_WEEKS; week += 1) {
      const start = addWeeks(event.start, week);
      if (start > event.repeatUntil) {
        break;
      }
      expanded.push({
        start,
        end: addWeeks(event.end, week),
        title: event.title,
        description: event.description,
        location: event.location,
        recurring: true,
      });
    }
  }

  return expanded;
}

type AnalysisSource = {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
};

/** One unit of work: a single page, or a whole image. */
interface AnalysisUnit {
  /** Human-readable origin, used to attribute errors back to a page. */
  label: string;
  content: AnalysisSource;
}

/**
 * Turns an upload into the units that will be analyzed concurrently.
 *
 * PDFs are rendered to one PNG per page rather than sent as PDF documents —
 * reading a shaded block's edges against the hour scale proved unreliable on
 * vector input, and the rendered image is what a person would look at anyway.
 * Uploaded images pass through untouched.
 */
async function buildAnalysisUnits(file: File): Promise<AnalysisUnit[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name || 'file';

  if (file.type !== 'application/pdf') {
    return [
      {
        label: name,
        content: {
          type: 'image',
          source: {
            type: 'base64',
            media_type: getSupportedImageMimeType(file.type),
            data: Buffer.from(bytes).toString('base64'),
          },
        },
      },
    ];
  }

  const pages = await renderPdfPages(bytes);

  return pages.map((page) => ({
    label: pages.length > 1 ? `${name} page ${page.pageNumber}` : name,
    content: {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: Buffer.from(page.data).toString('base64'),
      },
    },
  }));
}

async function analyzeUnit(unit: AnalysisUnit): Promise<ScheduleEvent[]> {
  const fileContent = unit.content;

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-5',
    // Thinking is on by default and shares this budget with the response text, so
    // the ceiling has to cover both. A dense multi-page timetable can spend
    // several thousand tokens reasoning about the grid before it writes any JSON;
    // at 16000 the output was truncated mid-object, which surfaced only as an
    // opaque parse failure. Anything this large must stream or the request risks
    // an HTTP timeout.
    max_tokens: 32000,
    output_config: { effort: EXTRACTION_EFFORT },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this schedule image or PDF document and extract every scheduled event. It may be a work shift schedule (a list of shifts on specific dates) or an academic/class timetable (a weekly grid of blocks that repeat over a term). Return a JSON object with an "events" array in this exact format:

{
  "events": [
    {
      "start": "ISO 8601 datetime string without timezone (e.g., 2026-01-10T15:00:00)",
      "end": "ISO 8601 datetime string without timezone (e.g., 2026-01-10T22:00:00)",
      "title": "Event title (e.g., a course code and name, or Coverage / Work Schedule)",
      "description": "Optional description",
      "location": "Optional location",
      "repeatUntil": "Optional YYYY-MM-DD date; only for events that repeat weekly"
    }
  ]
}

Reading times and dates:
- Parse dates carefully. If only month/day is shown, infer the year from context (the year printed on the document, or the next year if dates appear to be in the future).
- Convert times to ISO 8601 WITHOUT timezone (format: YYYY-MM-DDTHH:MM:SS). Treat all times as local time - do NOT add timezone information.
- For 12-hour format with AM/PM, convert correctly (e.g., 3:00 PM = 15:00, 3:00 AM = 03:00).

Weekly grid timetables (very important):
- Many timetables are a grid with weekdays as columns and hours as rows. Each shaded block is a class that repeats WEEKLY, not a one-time event.
- Read a block's start and end time from where its top and bottom edges fall against the hour gridlines on the left. A block whose top edge is at the 09:00 line and bottom edge at the 13:00 line runs 09:00-13:00.
- A page usually has a header "Date Range : <start> - <end>" with a week count. That range is the span of weeks the whole grid covers.
- A block often ALSO prints its own date range (e.g. "9/8/2026-12/4/2026") as its last line. That is the course's overall run, which may be wider than the page's date range.
- For each block, the actual span is the OVERLAP of the page's date range and the block's own date range. Emit "start"/"end" on the FIRST date within that overlap that falls on the block's weekday column, and set "repeatUntil" to the LAST date of that overlap.
- Example: a block in the Friday column, page date range 9/13/2026 - 10/10/2026, block range 9/8/2026-12/4/2026. The overlap is 9/13/2026-10/10/2026, the first Friday in it is 9/18/2026, so start is 2026-09-18T09:00:00 and repeatUntil is 2026-10-10.
- Emit one event per block per page. You may be given a single page taken from a longer document, or the whole document - either way, process every page you are shown and emit the blocks on it. The same block often recurs across pages under different page date ranges; duplicates are removed later, so never skip a block because it looks like one you have already seen.
- If a block genuinely occurs only once (its overlap covers a single week), omit "repeatUntil".
- CRITICAL: do NOT list every weekly occurrence separately. A block covering 13 weeks is ONE event with "repeatUntil" set, never 13 events. The weekly occurrences are generated automatically from "repeatUntil" after you respond. A typical 4-page timetable should produce well under 40 events in total; if you are writing more than that, you are enumerating occurrences instead of collapsing them into "repeatUntil".

Titles and locations:
- If a block shows a course code and a course name, combine them, e.g. "USUS112 - Ultrasound Scanning". Put any section/offering code in the description.
- If several rooms are listed for one block, join them with commas into a single "location" string.

Inclusion rules:
- Include work shifts, coverage, tasks, classes, labs, lectures, and tutorials.
- DO NOT include time-off requests, approved time-off, vacation days, or holidays.
- Only extract entries that have specific start and end times.
- Return ONLY valid JSON in the format above, no markdown, no code blocks, just the JSON object.`,
            // The instructions are identical for every page and every upload and
            // measure ~1400 tokens, comfortably over the 1024-token minimum, so
            // caching them means only the page itself is billed and processed as
            // fresh input on each of the concurrent per-page requests. The block
            // must stay first in the content array: a cache prefix ends here, so
            // putting the file before it would make the varying part the prefix
            // and nothing would ever hit.
            cache_control: { type: 'ephemeral' },
          },
          fileContent,
        ],
      },
    ],
  });

  const response = await stream.finalMessage();

  const content = response.content
    .filter((block) => block.type === 'text')
    .map((block) => ('text' in block ? block.text : ''))
    .join('\n')
    .trim();

  // Checked before parsing: a truncated response is still syntactically broken
  // JSON, so without this the user gets "Failed to parse AI response" and no clue
  // that the real problem is document size.
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      'The schedule was too long to process in one pass. Try splitting it into fewer pages per upload.'
    );
  }

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

  return expandDocumentRecurrence(parseEventsFromJSON(eventsData));
}

/**
 * How many pages are analyzed at once. Each page is its own model request, so
 * this trades wall-clock time against burst rate-limit pressure.
 */
const MAX_CONCURRENCY = Math.max(
  1,
  Number(process.env.SCHEDULE_MAX_CONCURRENCY) || 4
);

/**
 * Runs `worker` over `items` with at most `limit` in flight. Every item is
 * attempted even if others fail, so one unreadable page cannot discard the
 * pages that did parse.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(runners);
  return results;
}

export async function extractEventsFromFiles(files: File[]): Promise<{
  events: ScheduleEvent[];
  errors: string[];
}> {
  const allEvents: ScheduleEvent[] = [];
  const errors: string[] = [];

  // Flatten every file into pages first, so pages from different uploads share
  // the same concurrency budget instead of each file waiting its turn.
  const units: AnalysisUnit[] = [];
  for (let i = 0; i < files.length; i += 1) {
    try {
      units.push(...(await buildAnalysisUnits(files[i])));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${files[i].name || `File ${i + 1}`}: ${message}`);
      console.error(`Error reading file ${i + 1}:`, err);
    }
  }

  const settled = await mapWithConcurrency(units, MAX_CONCURRENCY, analyzeUnit);

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
      return;
    }
    const message =
      result.reason instanceof Error ? result.reason.message : 'Unknown error';
    errors.push(`${units[index].label}: ${message}`);
    console.error(`Error processing ${units[index].label}:`, result.reason);
  });

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

    // Events the document already described as a full weekly series are emitted
    // as concrete occurrences, so a global RRULE would repeat them a second time.
    if (repeatWeekly && !event.recurring) {
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
    // Already a complete series from the source document - leave it as is.
    if (event.recurring) {
      expanded.push(event);
      return;
    }

    const occurrences: ScheduleEvent[] = [];

    if (repeatMode === 'date' && repeatUntilDate) {
      const until = new Date(`${repeatUntilDate}T23:59:59`);
      for (let week = 0; week < MAX_USER_WEEKS; week += 1) {
        const start = addWeeks(event.start, week);
        if (start > until) {
          break;
        }
        occurrences.push({
          start,
          end: addWeeks(event.end, week),
          title: event.title,
          description: event.description,
          location: event.location,
        });
      }
    } else {
      const count = Math.max(1, Math.min(52, repeatWeeks || 1));
      for (let i = 0; i < count; i += 1) {
        occurrences.push({
          start: addWeeks(event.start, i),
          end: addWeeks(event.end, i),
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

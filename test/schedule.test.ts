import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandDocumentRecurrence,
  expandWeeklyRepeats,
  generateCalendar,
  parseEventsFromJSON,
  parseTotalHoursMinutes,
  sumEventMinutes,
  uniqueAndSortedEvents,
  type ScheduleEvent,
} from '../lib/schedule';

/** These run under TZ=America/Toronto (set by the test script) so the DST cases are stable. */
const at = (iso: string) => new Date(iso);

function event(start: string, end: string, extra: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return { start: at(start), end: at(end), title: 'Class', ...extra };
}

describe('expandDocumentRecurrence', () => {
  test('leaves an event without repeatUntil untouched', () => {
    const [only] = expandDocumentRecurrence([event('2026-09-08T09:00', '2026-09-08T11:00')]);
    assert.equal(only.recurring, undefined);
    assert.equal(only.start.getHours(), 9);
  });

  test('does not expand when repeatUntil is on or before the start', () => {
    const input = [
      event('2026-09-08T09:00', '2026-09-08T11:00', { repeatUntil: at('2026-09-01T23:59:59') }),
    ];
    const out = expandDocumentRecurrence(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].recurring, undefined);
  });

  test('expands weekly through repeatUntil inclusive and marks occurrences recurring', () => {
    const out = expandDocumentRecurrence([
      event('2026-09-08T09:00', '2026-09-08T11:00', { repeatUntil: at('2026-09-29T23:59:59') }),
    ]);
    assert.deepEqual(
      out.map((e) => e.start.toISOString().slice(0, 10)),
      ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']
    );
    assert.ok(out.every((e) => e.recurring === true));
  });

  test('holds wall-clock time across the end of DST', () => {
    // DST ends 2026-11-01 in this zone; stepping by 168h would slide 09:00 to 08:00.
    const out = expandDocumentRecurrence([
      event('2026-10-30T09:00', '2026-10-30T13:00', { repeatUntil: at('2026-11-20T23:59:59') }),
    ]);
    assert.ok(out.length >= 4);
    assert.ok(out.every((e) => e.start.getHours() === 9 && e.end.getHours() === 13));
  });

  test('caps a hallucinated far-future series at MAX_DOCUMENT_WEEKS', () => {
    const out = expandDocumentRecurrence([
      event('2026-09-08T09:00', '2026-09-08T11:00', { repeatUntil: at('2099-01-01T23:59:59') }),
    ]);
    assert.equal(out.length, 60);
  });
});

describe('expandWeeklyRepeats', () => {
  const single = [event('2026-09-08T09:00', '2026-09-08T11:00')];

  test('returns input untouched when the toggle is off', () => {
    assert.equal(expandWeeklyRepeats(single, false, 'weeks', 4).length, 1);
  });

  test('repeats for the requested number of weeks', () => {
    assert.equal(expandWeeklyRepeats(single, true, 'weeks', 4).length, 4);
  });

  test('leaves document-declared series alone so they are not repeated twice', () => {
    const recurring = [event('2026-09-08T09:00', '2026-09-08T11:00', { recurring: true })];
    assert.equal(expandWeeklyRepeats(recurring, true, 'weeks', 10).length, 1);
  });

  test('repeats up to a user-chosen end date, inclusive', () => {
    const out = expandWeeklyRepeats(single, true, 'date', undefined, '2026-09-29');
    assert.deepEqual(
      out.map((e) => e.start.toISOString().slice(0, 10)),
      ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']
    );
  });

  test('a user end date beyond MAX_USER_WEEKS is capped, not truncated at 60', () => {
    // Regression: an earlier 60-week bound silently cut date-based series at ~14 months.
    const out = expandWeeklyRepeats(single, true, 'date', undefined, '2099-01-01');
    assert.equal(out.length, 520);
  });

  test('holds wall-clock time across the end of DST', () => {
    const out = expandWeeklyRepeats(
      [event('2026-10-30T09:00', '2026-10-30T13:00')], true, 'date', undefined, '2026-11-20'
    );
    assert.ok(out.every((e) => e.start.getHours() === 9));
  });
});

describe('parseTotalHoursMinutes', () => {
  test('parses the HH:MM form printed on page headers', () => {
    assert.equal(parseTotalHoursMinutes('18:00'), 1080);
    assert.equal(parseTotalHoursMinutes('7:30'), 450);
    assert.equal(parseTotalHoursMinutes(' 18:00 '), 1080);
  });

  test('parses plain and decimal hours', () => {
    assert.equal(parseTotalHoursMinutes('18'), 1080);
    assert.equal(parseTotalHoursMinutes('7.5'), 450);
    assert.equal(parseTotalHoursMinutes(18), 1080);
  });

  test('returns null when there is nothing to check against', () => {
    // null must mean "no printed total", never "zero hours" - otherwise every
    // page without a header would fail its own check and be re-read forever.
    for (const value of [null, undefined, '', 'n/a', '18:75', {}, -1]) {
      assert.equal(parseTotalHoursMinutes(value), null, `expected null for ${JSON.stringify(value)}`);
    }
  });
});

describe('sumEventMinutes', () => {
  test('totals durations and ignores inverted events', () => {
    assert.equal(sumEventMinutes([event('2026-09-08T09:00', '2026-09-08T11:00')]), 120);
    assert.equal(sumEventMinutes([event('2026-09-08T11:00', '2026-09-08T09:00')]), 0);
    assert.equal(sumEventMinutes([]), 0);
  });

  test('reconciles the fixture page against its printed Total Hours', () => {
    // Page 1 of the sample timetable prints "Total Hours: 18:00" and its seven
    // blocks are 6h Tue + 6h Wed + 6h Fri. This is the exact check that catches
    // the 09:00-12:00 block being misread as 09:00-13:00.
    const blocks = [
      event('2026-09-08T09:00', '2026-09-08T11:00'),
      event('2026-09-08T11:00', '2026-09-08T12:00'),
      event('2026-09-08T13:00', '2026-09-08T16:00'),
      event('2026-09-09T09:00', '2026-09-09T12:00'),
      event('2026-09-09T13:00', '2026-09-09T16:00'),
      event('2026-09-11T09:00', '2026-09-11T13:00'),
      event('2026-09-11T14:00', '2026-09-11T16:00'),
    ];
    assert.equal(sumEventMinutes(blocks), parseTotalHoursMinutes('18:00'));

    const misread = blocks.map((b, i) =>
      i === 3 ? event('2026-09-09T09:00', '2026-09-09T13:00') : b
    );
    assert.notEqual(sumEventMinutes(misread), parseTotalHoursMinutes('18:00'));
  });
});

describe('parseEventsFromJSON', () => {
  test('skips entries that are not usable instead of failing the batch', () => {
    const out = parseEventsFromJSON([
      { start: '2026-09-08T09:00:00', end: '2026-09-08T11:00:00', title: 'Good' },
      { start: '2026-09-08T09:00:00' },
      { start: 'nonsense', end: 'nonsense' },
      null,
      'not an object',
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'Good');
  });

  test('reads local wall-clock time without applying a timezone offset', () => {
    const [only] = parseEventsFromJSON([
      { start: '2026-09-08T09:00:00', end: '2026-09-08T11:00:00' },
    ]);
    assert.equal(only.start.getHours(), 9);
    assert.equal(only.title, 'Work Schedule');
  });
});

describe('uniqueAndSortedEvents', () => {
  test('drops cross-page duplicates and sorts by start', () => {
    const out = uniqueAndSortedEvents([
      event('2026-09-15T09:00', '2026-09-15T11:00'),
      event('2026-09-08T09:00', '2026-09-08T11:00'),
      event('2026-09-08T09:00', '2026-09-08T11:00'),
    ]);
    assert.equal(out.length, 2);
    assert.ok(out[0].start < out[1].start);
  });
});

describe('generateCalendar', () => {
  test('omits the global RRULE for events the document already expanded', () => {
    const ics = generateCalendar(
      [event('2026-09-08T09:00', '2026-09-08T11:00', { recurring: true })], true, 'weeks', 4
    );
    assert.ok(!ics.includes('RRULE'));
  });

  test('applies the global RRULE to ordinary events', () => {
    const ics = generateCalendar([event('2026-09-08T09:00', '2026-09-08T11:00')], true, 'weeks', 4);
    assert.ok(ics.includes('RRULE:FREQ=WEEKLY;COUNT=4'));
  });

  test('escapes values that would otherwise break the ICS grammar', () => {
    const ics = generateCalendar([
      event('2026-09-08T09:00', '2026-09-08T11:00', { title: 'A; B, C\\D' }),
    ]);
    assert.ok(ics.includes('SUMMARY:A\\; B\\, C\\\\D'));
  });
});

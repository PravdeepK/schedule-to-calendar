# Review brief — academic timetable PDF support

> **Revision 2.** Round 1 raised three issues; all three are now fixed. See
> [Round 1 findings](#round-1-findings) for what changed and what to re-check.

## What this is

Support for uploading an **academic timetable PDF** and converting it to calendar
events.

**Goal:** a user uploads the term timetable and gets every class occurrence for
2026-09-07 → 2026-12-04, at the right wall-clock times, in the right rooms.

### Diff size

| | |
|---|---|
| Tracked, modified | 6 files, **+386 / −108** |
| New, untracked | `lib/uploadLimits.ts` (82 lines) |

`README.md`, `app/api/convert/route.ts`, `app/api/sync/route.ts`, `app/layout.tsx`,
`app/page.tsx`, `lib/schedule.ts`, plus the new `lib/uploadLimits.ts`. This brief itself
is excluded from the counts.

> ⚠️ **The fixture PDF is no longer in the repo.** `testingfiles/US1C.pdf` was removed
> from the working tree between review rounds. The source file still exists at
> `~/Downloads/US1C.pdf`. Anything below that cites fixture output was measured while it
> was present — re-verifying means restoring it first. This is Q6, now unresolved rather
> than open.

## Provenance — read this before reviewing the diff

`HEAD` (`4537edf`) has **zero** PDF support (`git show HEAD:lib/schedule.ts | grep -c
application/pdf` → 0). The working tree contains two layers, and `git diff` shows them
merged together:

| Layer | What it covers | Review posture |
|---|---|---|
| **A — pre-existing uncommitted** | Basic PDF plumbing: the `isPdf` → `document` content-block branch, `getSupportedImageMimeType`, `preview: string \| null` and its placeholder tile | Not written in these sessions. Already working. |
| **B — these sessions** | Model-ID fix, timetable-recurrence extraction, DST-safe expansion, upload validation, all user-facing copy | **This is what needs scrutiny.** |

Everything below is layer B unless marked otherwise.

## Round 1 findings

All three are fixed. Re-check these first.

### ✅ P2 — Advertised 20 MB uploads fail on Vercel

**Was:** `MAX_FILE_BYTES` hard-coded at 20 MB while Vercel functions cap request bodies at
~4.5 MB, so a large upload died at the platform before validation ran.

**Now:** both limits are configurable and read from one place.
`lib/uploadLimits.ts` resolves `NEXT_PUBLIC_MAX_FILE_MB` / `NEXT_PUBLIC_MAX_TOTAL_MB`,
defaulting to 20/40. The UI copy, the client check, and the server check all read the same
constants, so the advertised number can't diverge from the enforced one. The README's
deploy section now tells Vercel users to set `4`/`4`, and notes that genuinely large
uploads require bypassing the function via blob storage.

The default stays 20 MB because that was an explicit product decision and is correct for a
host without a body cap; the fix makes it *adjustable* rather than overriding the call.
**If this app is definitely deploying to Vercel, the defaults should just be lowered to 4 —
say so and I'll change them.**

### ✅ P2 — Date-based sync truncated after 60 weeks

**Was:** a regression I introduced. Rewriting `expandWeeklyRepeats` for DST safety replaced
an unbounded `while (cursor <= until)` with `for (week = 0; week < 60; …)`, silently
capping any user-chosen end date at ~14 months.

**Now:** two named constants with deliberately different values
(`lib/schedule.ts`, above `expandDocumentRecurrence`):

| Constant | Value | Applies to | Rationale |
|---|---|---|---|
| `MAX_DOCUMENT_WEEKS` | 60 | Series the **model** claimed via `repeatUntil` | Guard against a hallucinated far-future date. No real term exceeds a year, so it never binds on valid input. |
| `MAX_USER_WEEKS` | 520 | Series the **user** asked for via an end date | The user picked the date explicitly; truncating would drop occurrences they can see they requested. Pure runaway guard. |

The asymmetry is intentional — one bounds untrusted model output, the other bounds a
deliberate user choice.

### ✅ P3 — Browser omitted the documented 40 MB total

**Was:** the client validated per-file size only, so an oversized *batch* uploaded and was
rejected server-side after the wait.

**Now:** `handleFilesSelect` (`app/page.tsx`) seeds a running total from already-staged
files and accepts new ones only while the total still fits, with a distinct message for
each rejection reason (wrong type / too big / would exceed total). Counting the existing
selection matters — files arrive across multiple drops via "Add More Files".

## Change inventory

### 1. Dead model ID — `lib/schedule.ts`

`claude-sonnet-4-20250514` 404s on this account. **Every upload was failing**, PDF or
image, surfacing only as a generic "Failed to extract events" — the per-file catch in
`extractEventsFromFiles` swallowed the 404 into a string.

- → `claude-sonnet-5`
- Removed `temperature: 0.1` — non-default sampling params are **rejected with a 400** on
  this model.
- `max_tokens` 8192 → 16000, added `output_config: { effort: 'high' }`. Thinking is on by
  default on Sonnet 5 and counts against `max_tokens`; the old ceiling risked truncating
  mid-JSON.

### 2. Timetable recurrence — the substantive change

**The problem.** The PDF is not a list of shifts. It is 4 pages, each a Mon–Fri grid where
every shaded block **repeats weekly**. Two date ranges interact per block:

- the page header — `Date Range : 9/13/2026 - 10/10/2026  Weeks : 2 - 5`
- the block's own printed range — `9/8/2026-12/4/2026`

A block's true span is the **intersection**. The same block reappears on multiple pages
under different page ranges, so the union across pages reconstructs the full series.

The old prompt modelled one-off shifts and said *"ONLY include actual work shifts […] DO
NOT include […] non-work events"* — classes would have been dropped entirely.

**The implementation:**

| Piece | Role |
|---|---|
| Rewritten prompt | Reads block edges against hour gridlines; intersects page range × block range; emits first occurrence + `repeatUntil`. Includes a worked example using the PDF's actual page-2 Friday block. |
| `repeatUntil?: Date` | Model-declared weekly series end |
| `recurring?: boolean` | Marks already-expanded occurrences |
| `parseRepeatUntil` | Parses `YYYY-MM-DD` → local `23:59:59` |
| `expandDocumentRecurrence` | Expands to concrete occurrences, bounded by `MAX_DOCUMENT_WEEKS` |

**Why expand server-side instead of emitting one `RRULE`:** each page declares a different
range, so a single global rule can't express the series. Expanding also lets
`uniqueAndSortedEvents` dedupe the cross-page overlaps.

**Double-repeat guard:** expanded events set `recurring: true`; `generateCalendar` skips the
global `RRULE` for them and `expandWeeklyRepeats` passes them through untouched. Without
this, a user who also ticks "repeat weekly" would multiply a complete series. The UI copy
now states this so the toggle doing nothing isn't mysterious.

### 3. DST correctness — `addWeeks`

The term crosses **2026-11-01** (DST ends). The original `expandWeeklyRepeats` stepped by
`7*24*60*60*1000` ms, which shifts wall-clock time by an hour across the boundary — a
09:00 class becomes 08:00 for all of November. `addWeeks` steps by calendar date instead.

**This also fixes a pre-existing bug** on the `/api/sync` path that affected image uploads
too. Scope creep — flagged deliberately, see Q3.

### 4. Upload validation — `lib/uploadLimits.ts`, both routes, `app/page.tsx`

Previously there was **no size limit and no server-side MIME check** anywhere — type
filtering existed only on the client, and `processFile` treated any non-PDF as an image, so
a bad type surfaced as an opaque per-file error. Now centralised, configurable, and
enforced on both sides.

### 5. User-facing copy

Text across `app/page.tsx` and `app/layout.tsx` referred only to "work schedule
screenshots". Updated to cover timetables and PDFs, state the size limit (interpolated from
the constants), and explain the repeat toggle's two cases. README corrected for the model
name, the excluded-time-off behaviour it previously claimed as *supported*, and the unused
`ical-generator` dependency.

## Evidence

Measured on the fixture while it was present in the repo:

```
97 events, 2026-09-08 → 2026-12-04     (PDF header: 9/7/2026 - 12/4/2026)

  USUS112 - Ultrasound Scanning          25
  PPUS110 - Professional Practice 1      25
  ABUS111 - Ultrasound of the Abdomen I  23
  APIG110 - Cross Sectional Anat         12
  PHUS110 - Physics of Ultrasound        12

LOCATIONS
   71  Online-Online-Online
   13  Main-1103, Main-1104
   13  Main-320, …-321, …-322, …-323, …-318/319

DST — Friday 09:00 series across Nov 1
   Fri 10-30 09:00 → 13:00
   Fri 11-06 09:00 → 13:00      ← wall clock holds
   Fri 11-27 09:00 → 13:00

ICS: 97 VEVENTs, 0 RRULEs        ← no double-repeat
```

**This has not been re-run since the round-1 fixes.** None of those fixes touch the
extraction or recurrence arithmetic — they alter limits, bounds, and copy — but the claim
is from the previous revision, and the fixture would need restoring to re-verify.

Current state: `npx tsc --noEmit` clean, `npx eslint app lib` one pre-existing
`no-img-element` warning, `npm run build` succeeds.

## Open questions

**Q1 — Model tier.** Kept Sonnet (`claude-sonnet-5`) rather than moving to `claude-opus-5`,
on the reasoning that the original code deliberately chose a Sonnet. Grid-reading is a
vision-reasoning task where Opus may be materially more accurate. Is preserving the tier
right, or should accuracy win?

**Q2 — Extraction is non-deterministic.** The recurrence model rests on the model correctly
reading block edges and intersecting two date ranges. Verified on **one** document, **one**
run. A different export — different week counts, a block spanning a term break, a Saturday
column — is unverified.

**Q3 — Scope.** The DST fix to `expandWeeklyRepeats` is a pre-existing bug on a path the
timetable doesn't use. Fixed because it's the same change and the same class of bug. Split
into its own commit?

**Q4 — No test coverage.** Still the most defensible criticism, and raised in both review
rounds. `addWeeks`, `expandDocumentRecurrence`, `expandWeeklyRepeats`, and `validateUploads`
are **pure functions** — the DST boundary, the two week ceilings, `repeatUntil <= start`,
and the running-total logic are all testable with no API call. There is no test runner in
`package.json`; `node:test` + `tsx` would add one devDependency. **Not done because it was
never asked for — say the word.**

**Q6 — Fixture.** `testingfiles/US1C.pdf` has been removed from the working tree. If the
extraction path should stay verifiable, it needs to come back (and may carry institutional
data worth checking before committing).

## Suggested review focus

1. `MAX_DOCUMENT_WEEKS` vs `MAX_USER_WEEKS` — is 520 high enough, 60 low enough, and is
   the asymmetry justified?
2. The running-total logic in `handleFilesSelect` — it `break`s on the first file that
   doesn't fit rather than continuing to look for smaller ones. Intentional (predictable
   ordering) but arguable.
3. `addWeeks` — month-overflow behaviour of `new Date(y, m, d+7n, …)`.
4. The `recurring` flag threading through `generateCalendar` and `expandWeeklyRepeats` — is
   there any path where a recurring event still picks up a global `RRULE`?
5. `uniqueAndSortedEvents` dedupes on `start`/`end`/`title` but **not** `location`. Two
   same-titled blocks at the same time in different rooms would collapse. Not triggered by
   this PDF (Tue-online vs Fri-on-campus differ by day) — latent bug?
6. Whether the prompt's worked example over-fits to this one document's layout.

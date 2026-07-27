# Schedule to Calendar

Convert work schedules and class timetables — as PDFs or images — into calendar events, either as a downloadable `.ics` file or synced straight to Google or Outlook.

## Features

- 📄 Upload PDFs or images (drag & drop or click to upload, multiple files at once)
- 🤖 AI-powered extraction using Claude Sonnet 5
- 🔁 Recognises recurring timetables — a term grid that repeats weekly is expanded into every occurrence automatically
- 📅 Generate `.ics` calendar files for manual import
- 🔗 Native Google Calendar sync with OAuth
- 🔗 Native Outlook Calendar sync with OAuth
- ✨ Modern, responsive UI with dark mode support

### Accepted files

| | |
|---|---|
| Formats | PDF, JPEG, PNG, GIF, WebP |
| Size | 20 MB per file, 40 MB per upload (configurable — see below) |

Both limits are defined once in `lib/uploadLimits.ts` and enforced in the browser
*and* on the API routes, so the two can't drift apart.

## Getting Started

### Prerequisites

- Node.js 18+ 
- Anthropic API key ([Get one here](https://console.anthropic.com/settings/keys))

### Installation

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Create a `.env.local` file in the root directory:
```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
MICROSOFT_REDIRECT_URI=http://localhost:3000/api/auth/outlook/callback
MICROSOFT_TENANT_ID=consumers
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Configuration

### Environment Variables

- `ANTHROPIC_API_KEY` (required): Your Anthropic API key, used for Claude Sonnet 5 document and image extraction
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: Google OAuth credentials for direct sync
- `GOOGLE_REDIRECT_URI`: OAuth callback URL registered in Google Cloud Console
- `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`: Microsoft OAuth credentials for Outlook sync
- `MICROSOFT_REDIRECT_URI`: OAuth callback URL registered in Azure App Registration
- `MICROSOFT_TENANT_ID` (optional): Microsoft tenant segment (`consumers`, `common`, or your tenant ID). Use `consumers` for personal accounts only apps.
- `NEXT_PUBLIC_MAX_FILE_MB` (optional, default `20`): Largest single upload accepted
- `NEXT_PUBLIC_MAX_TOTAL_MB` (optional, default `40`): Largest combined upload accepted

Set the two `NEXT_PUBLIC_MAX_*` values to match whatever your host allows through — see
the Vercel note below. They are inlined at build time, so changing them needs a rebuild,
not just a restart.

### Setting up on Vercel

1. Push your code to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Add the environment variable:
   - Go to Project Settings → Environment Variables
   - Add `ANTHROPIC_API_KEY` with your API key
4. Deploy!

> **⚠️ Upload size on Vercel — action required.** Vercel serverless functions cap request
> bodies at **~4.5 MB**, far below the 20 MB default. A larger upload is rejected by the
> platform *before* it reaches the app's validation, so the user sees a generic network
> failure instead of a useful message. When deploying to Vercel, set:
>
> ```env
> NEXT_PUBLIC_MAX_FILE_MB=4
> NEXT_PUBLIC_MAX_TOTAL_MB=4
> ```
>
> The UI, the client-side check, and the server-side check all read these, so the advertised
> limit stays truthful. Hosts without a body cap (a container, a VPS, Fly.io) can keep the
> 20 MB default. If you need genuinely large uploads on Vercel, the request has to bypass
> the function entirely — upload to blob storage from the browser and pass a URL instead.

## How It Works

1. **Upload**: User uploads one or more PDFs or images of a work schedule or class timetable
2. **Rasterize**: Each PDF page is rendered to a high-resolution PNG (`lib/pdf.ts`, via the
   `mupdf` WebAssembly build). PDFs are never sent to the model as PDFs — see below
3. **AI Analysis**: Claude Sonnet 5 reads each page image and extracts its events. Pages are
   analyzed concurrently (`SCHEDULE_MAX_CONCURRENCY`, default 4), so a 4-page timetable takes
   about as long as its slowest page instead of the sum of all four
4. **Recurrence**: Events the document itself describes as weekly are expanded into concrete
   occurrences (see below)
5. **Processing**: Events are parsed, de-duplicated, and sorted
6. **Delivery**: User either downloads an `.ics` file or syncs events directly to Google/Outlook

### Why PDFs are rendered to images

Sending the PDF straight to the model is the obvious approach and measured *worse*.
Repeated runs over the same file returned different **end times** for the same class: with
vector input there is no strong visual cue for where a shaded block stops relative to the
hour scale. On the sample timetable one course was read as 09:00–13:00 on every run when the
block actually ends at 12:00.

Rendering each page at ~2000px on the long edge gives the model the same pixels a person
would look at, and measurably improved accuracy on that block. It does **not** make
extraction deterministic — block-edge reading still varies run to run, so verify important
times after importing.

This also means asking users to upload screenshots instead would gain nothing: the app
already does the screenshotting for them, at a controlled resolution.

## Supported Schedule Formats

The AI handles a range of layouts:
- Calendar view schedules (monthly/weekly)
- Grid-based weekly schedules
- List-based shift schedules
- Multi-week academic timetables with a printed date range

Time-off requests, approved time off, vacation days, and holidays are deliberately
**excluded** — only entries with concrete start and end times are extracted.

### Recurring timetables

Academic timetables are a grid of weekday columns and hour rows, where each block repeats
weekly rather than occurring once. Two date ranges interact:

- the page header — `Date Range : 3/9/2026 - 4/5/2026   Weeks : 2 - 5`
- the block's own printed range — `3/2/2026-5/29/2026`

A block's real span is the **intersection** of the two, and the same block reappears across
pages under different page ranges. The app resolves this per block and expands it into one
event per week, so a 4-page term timetable becomes the full set of dated events.

Because those events already carry their own dates, the **"Repeat schedule weekly"** option
does not apply to them — it exists for schedules that show a single week and need repeating.
Applying both would double the series, so the app skips it for document-declared
recurrences.

Weekly steps are computed by calendar date rather than by adding 168 hours, so events keep
their wall-clock time across a daylight-saving change mid-term.

## Technology Stack

- **Next.js 16** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Anthropic Claude Sonnet 5** - Page image analysis and data extraction
- **mupdf (WebAssembly)** - Renders PDF pages to images server-side
- **Google Calendar / Microsoft Graph APIs** - Direct calendar sync

> `ical-generator` is listed in `package.json` but is not imported anywhere — `.ics` output
> is built by hand in `generateCalendar` (`lib/schedule.ts`). The dependency can be dropped.

## License

MIT

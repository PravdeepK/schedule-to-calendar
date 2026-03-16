# Schedule to Calendar

Convert work schedule screenshots to calendar files (.ics format) using AI vision technology.

## Features

- 📸 Upload schedule screenshots (drag & drop or click to upload)
- 🤖 AI-powered extraction using Claude Sonnet 4 Vision
- 📅 Generate `.ics` calendar files for manual import
- 🔗 Native Google Calendar sync with OAuth
- 🔗 Native Outlook Calendar sync with OAuth
- ✨ Modern, responsive UI with dark mode support

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
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Configuration

### Environment Variables

- `ANTHROPIC_API_KEY` (required): Your Anthropic API key for Claude Sonnet 4 Vision access
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: Google OAuth credentials for direct sync
- `GOOGLE_REDIRECT_URI`: OAuth callback URL registered in Google Cloud Console
- `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`: Microsoft OAuth credentials for Outlook sync
- `MICROSOFT_REDIRECT_URI`: OAuth callback URL registered in Azure App Registration

### Setting up on Vercel

1. Push your code to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Add the environment variable:
   - Go to Project Settings → Environment Variables
   - Add `ANTHROPIC_API_KEY` with your API key
4. Deploy!

## How It Works

1. **Upload**: User uploads a screenshot of their work schedule
2. **AI Analysis**: Claude Sonnet 4 Vision analyzes the image and extracts schedule information
3. **Processing**: The extracted data is parsed and structured
4. **Delivery**: User either downloads an `.ics` file or syncs events directly to Google/Outlook

## Supported Schedule Formats

The AI can handle various schedule formats including:
- Calendar view schedules (monthly/weekly)
- Grid-based weekly schedules
- List-based schedules
- Time-off requests and approvals

## Technology Stack

- **Next.js 16** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Anthropic Claude Sonnet 4** - Image analysis and data extraction
- **ical-generator** - Calendar file generation

## License

MIT

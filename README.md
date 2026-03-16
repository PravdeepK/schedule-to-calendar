# Schedule to Calendar

Convert work schedule screenshots to calendar files (.ics format) using AI vision technology.

## Features

- 📸 Upload schedule screenshots (drag & drop or click to upload)
- 🤖 AI-powered extraction using Claude Sonnet 4 Vision
- 📅 Generate calendar files for Outlook or Apple Calendar
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
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Configuration

### Environment Variables

- `ANTHROPIC_API_KEY` (required): Your Anthropic API key for Claude Sonnet 4 Vision access

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
4. **Generation**: A standard .ics calendar file is generated
5. **Download**: User downloads the calendar file and imports it into their calendar app

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

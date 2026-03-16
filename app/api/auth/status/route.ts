import { NextResponse } from 'next/server';
import { getConnectedProviders } from '@/lib/calendarAuth';

export async function GET() {
  const connected = await getConnectedProviders();
  return NextResponse.json(connected);
}

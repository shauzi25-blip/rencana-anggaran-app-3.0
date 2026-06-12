import { NextRequest, NextResponse } from 'next/server';
import { syncGoogleSheetsToSupabase } from '@/lib/sync/googleSheetsSync.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function getRequestToken(request: NextRequest): string {
  const authHeader = request.headers.get('authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1] || request.nextUrl.searchParams.get('secret') || '';
}

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.SYNC_SECRET || process.env.CRON_SECRET || '';
  if (!expectedSecret) return false;
  return getRequestToken(request) === expectedSecret;
}

async function runSync(request: NextRequest, dryRunOverride?: boolean, defaultMode?: 'full' | 'incremental' | 'new-only') {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, error: 'SYNC_SECRET/CRON_SECRET tidak valid atau belum dikonfigurasi' },
      { status: 401 }
    );
  }

  const dryRun = dryRunOverride ?? request.nextUrl.searchParams.get('dryRun') === 'true';
  const mode = request.nextUrl.searchParams.get('mode') || defaultMode || 'full';
  const result = await syncGoogleSheetsToSupabase({
    dryRun,
    incremental: mode === 'incremental',
    newOnly: mode === 'new-only' || mode === 'newOnly',
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  try {
    return await runSync(request);
  } catch (error) {
    console.error('Google Sheets sync failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Gagal sync Google Sheets',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    return await runSync(request, false, 'new-only');
  } catch (error) {
    console.error('Google Sheets sync failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Gagal sync Google Sheets',
      },
      { status: 500 }
    );
  }
}

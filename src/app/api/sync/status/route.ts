import { NextRequest, NextResponse } from 'next/server';
import { getLatestSyncRun } from '@/lib/sync/googleSheetsSync.mjs';

export const dynamic = 'force-dynamic';

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

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { success: false, error: 'SYNC_SECRET/CRON_SECRET tidak valid atau belum dikonfigurasi' },
        { status: 401 }
      );
    }

    const latest = await getLatestSyncRun();

    return NextResponse.json({
      success: true,
      data: latest,
    });
  } catch (error) {
    console.error('Error fetching sync status:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Gagal mengambil status sync',
      },
      { status: 500 }
    );
  }
}

// ============================================================
// API Route: Fetch Dashboard Data (Unpaid PIs) from Prisma/Supabase
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { decimalToNumber } from '@/lib/decimal';
import { syncGoogleSheetsToSupabase } from '@/lib/sync/googleSheetsSync.mjs';

const prisma = new PrismaClient();
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const shouldSync = request.nextUrl.searchParams.get('sync') === 'true';

    if (shouldSync) {
      await syncGoogleSheetsToSupabase({
        dryRun: false,
        newOnly: true,
        logger: {
          log: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      });
    }

    const rawInvoices = await prisma.purchaseInvoice.findMany({
      where: {
        paymentState: { not: 'paid' }, // assuming 'paid' is fully paid
        budgetStatus: { in: ['pending', 'returned'] }, // Hide budgeted PIs
        sourceActive: true,
      },
      include: {
        vendor: true,
        company: true
      },
      orderBy: { tglBeli: 'desc' }
    });

    const rows = rawInvoices.map(inv => {
      const isLate = inv.tempoHari < 0; // simplistic example, can be based on diff days
      return {
        id: inv.id,
        noPi: inv.noPi,
        tglBeli: inv.tglBeli.toISOString().split('T')[0],
        namaSupplier: inv.vendor.name,
        namaPenerima: inv.vendor.accountName || inv.vendor.name,
        noRekening: inv.vendor.bankAccount || '-',
        totalPembelian: decimalToNumber(inv.totalRencanaBayar),
        hutang: decimalToNumber(inv.hutang),
        tempo: inv.tempoHari,
        paymentState: inv.paymentState,
        paymentDueState: isLate ? 'late' : 'on_time',
        vendorCode: inv.vendor.code,
        perusahaan: inv.company.name // New property
      };
    });

    return NextResponse.json({
      success: true,
      data: rows,
      meta: {
        totalPayables: rows.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch data',
      },
      { status: 500 }
    );
  }
}

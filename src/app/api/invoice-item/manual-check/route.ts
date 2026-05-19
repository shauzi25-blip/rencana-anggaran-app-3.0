import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const dynamic = 'force-dynamic';

const RESOLVED_STATUSES = new Set(['Selisih', 'Rekening Tidak Valid', 'Tidak Valid']);

function normalizeResolvedStatuses(value: unknown): string[] {
  const rawStatuses = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  return Array.from(new Set(
    rawStatuses
      .map((status) => typeof status === 'string' ? status.trim() : '')
      .filter((status) => RESOLVED_STATUSES.has(status))
  ));
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
    const reset = Boolean(body.reset);

    if (!itemId) {
      return NextResponse.json({ success: false, error: 'itemId wajib diisi' }, { status: 400 });
    }

    if (reset) {
      const item = await prisma.invoiceItem.update({
        where: { id: itemId },
        data: {
          manualStatusOcr: null,
          manualReason: null,
          manualCheckedAt: null,
          manualCheckedBy: null,
        },
        select: {
          id: true,
          statusOcr: true,
          ocrReason: true,
          manualStatusOcr: true,
          manualReason: true,
          manualCheckedAt: true,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          ...item,
          finalStatusOcr: item.statusOcr,
          finalReason: item.ocrReason || '',
        },
      });
    }

    const resolvedStatuses = normalizeResolvedStatuses(body.resolvedStatuses || body.manualStatusOcr);
    const manualReasonInput = typeof body.manualReason === 'string' ? body.manualReason.trim() : '';
    const resolvedNote = resolvedStatuses.length > 0
      ? `Direvisi manual: ${resolvedStatuses.join(', ')}`
      : 'Direvisi manual';
    const manualReason = manualReasonInput
      ? `${resolvedNote}\nCatatan: ${manualReasonInput}`
      : resolvedNote;

    const item = await prisma.invoiceItem.update({
      where: { id: itemId },
      data: {
        manualStatusOcr: 'Valid',
        manualReason,
        manualCheckedAt: new Date(),
        manualCheckedBy: 'manual-user',
      },
      select: {
        id: true,
        statusOcr: true,
        ocrReason: true,
        manualStatusOcr: true,
        manualReason: true,
        manualCheckedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...item,
        finalStatusOcr: 'Valid',
        finalReason: item.manualReason || '',
      },
    });
  } catch (error) {
    console.error('Manual check update error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gagal menyimpan checking manual' },
      { status: 500 }
    );
  }
}

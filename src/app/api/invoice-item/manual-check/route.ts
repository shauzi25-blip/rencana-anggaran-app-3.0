import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = new Set(['Valid', 'Selisih', 'Rekening Tidak Valid', 'Tidak Valid']);

function normalizeManualStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const statuses = value
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean);

  if (statuses.length === 0) return null;
  if (statuses.includes('Valid')) return 'Valid';

  const uniqueStatuses = Array.from(new Set(statuses));
  const isValid = uniqueStatuses.every((status) => ALLOWED_STATUSES.has(status));
  return isValid ? uniqueStatuses.join(', ') : null;
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

    const manualStatusOcr = normalizeManualStatus(body.manualStatusOcr);
    const manualReason = typeof body.manualReason === 'string' ? body.manualReason.trim() : '';

    if (!manualStatusOcr) {
      return NextResponse.json(
        { success: false, error: 'Status manual tidak valid' },
        { status: 400 }
      );
    }

    const item = await prisma.invoiceItem.update({
      where: { id: itemId },
      data: {
        manualStatusOcr,
        manualReason: manualReason || null,
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
        finalStatusOcr: item.manualStatusOcr || item.statusOcr,
        finalReason: item.manualReason || item.ocrReason || '',
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

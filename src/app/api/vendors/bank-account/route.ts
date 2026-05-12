import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const vendorId = typeof body.vendorId === 'string' ? body.vendorId.trim() : '';
    const bankAccount = typeof body.bankAccount === 'string' ? body.bankAccount.trim() : '';

    if (!vendorId) {
      return NextResponse.json(
        { success: false, error: 'vendorId wajib diisi' },
        { status: 400 }
      );
    }

    const vendor = await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        bankAccount: bankAccount || null,
      },
      select: {
        id: true,
        bankAccount: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        vendorId: vendor.id,
        bankAccount: vendor.bankAccount || '',
      },
    });
  } catch (error) {
    console.error('Error updating vendor bank account:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Gagal update nomor rekening vendor',
      },
      { status: 500 }
    );
  }
}

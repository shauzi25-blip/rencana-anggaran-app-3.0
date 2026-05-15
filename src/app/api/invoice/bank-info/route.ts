import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId.trim() : '';
    const accountName = typeof body.accountName === 'string' ? body.accountName.trim() : '';
    const bankAccount = typeof body.bankAccount === 'string' ? body.bankAccount.trim() : '';

    if (!invoiceId) {
      return NextResponse.json(
        { success: false, error: 'invoiceId wajib diisi' },
        { status: 400 }
      );
    }

    const invoice = await prisma.purchaseInvoice.update({
      where: { id: invoiceId },
      data: {
        accountNameOverride: accountName || null,
        bankAccountOverride: bankAccount || null,
        bankInfoEditedAt: new Date(),
        bankInfoSource: 'manual',
      },
      select: {
        id: true,
        accountNameOverride: true,
        bankAccountOverride: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        invoiceId: invoice.id,
        namaRekening: invoice.accountNameOverride || '',
        nomorRekening: invoice.bankAccountOverride || '',
      },
    });
  } catch (error) {
    console.error('Error updating invoice bank info:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Gagal update data rekening invoice',
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { piList } = body as { piList: { noPi: string; company?: string }[] };

    if (!piList || !Array.isArray(piList) || piList.length === 0) {
      return NextResponse.json({ success: false, error: 'piList wajib diisi (array of { noPi, company? })' }, { status: 400 });
    }

    const cleanedInputs = piList
      .map((item) => ({
        noPi: typeof item.noPi === 'string' ? item.noPi.trim() : '',
        company: typeof item.company === 'string' ? item.company.trim() : '',
      }))
      .filter((item) => item.noPi);
    const piNumbers = Array.from(new Set(cleanedInputs.map((item) => item.noPi)));
    
    const existingInvoices = await prisma.purchaseInvoice.findMany({
      where: {
        noPi: { in: piNumbers },
        paymentState: { not: 'paid' },
        budgetStatus: { in: ['pending', 'returned'] },
        sourceActive: true,
      },
      select: { id: true, noPi: true }
    });

    const existingMap = new Map(existingInvoices.map(inv => [inv.noPi, inv.id]));
    const matched: string[] = [];
    const notFound: string[] = [];

    piNumbers.forEach((noPi) => {
      if (existingMap.has(noPi)) {
        matched.push(noPi);
      } else {
        notFound.push(noPi);
      }
    });

    const matchedItems: { id: string; noPi: string; company: string }[] = [];
    cleanedInputs.forEach((p) => {
      const id = existingMap.get(p.noPi);
      if (id) {
        matchedItems.push({ id, noPi: p.noPi, company: p.company || '' });
      }
    });

    const matchedIds = matchedItems.map((item) => item.id);

    return NextResponse.json({
      success: true,
      data: {
        matchedIds,
        matchedItems,
        matched,
        notFound,
        totalMatched: matched.length,
        totalNotFound: notFound.length,
      }
    });
  } catch (error: any) {
    console.error('Bulk select error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

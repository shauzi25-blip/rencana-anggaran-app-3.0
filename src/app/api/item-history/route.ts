// ============================================================
// API Route: Get Purchase History for an Item by Name
// Returns ALL historical purchases of the same item from InvoiceItem
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { decimalToNumber } from '@/lib/decimal';

const prisma = new PrismaClient();
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { namaBarang } = await req.json();

    if (!namaBarang || typeof namaBarang !== 'string') {
      return NextResponse.json(
        { success: false, error: 'namaBarang is required' },
        { status: 400 }
      );
    }

    // Strategy: exact match first, then fallback to contains (case-insensitive via MySQL collation)
    let items = await prisma.invoiceItem.findMany({
      where: {
        namaBarang: namaBarang,
        sourceActive: true,
        invoice: { sourceActive: true },
      },
      include: {
        invoice: {
          include: {
            vendor: true,
            company: true,
          },
        },
      },
      orderBy: {
        invoice: {
          tglBeli: 'desc',
        },
      },
      take: 500, // Show all — removed limit of 50
    });

    // If exact match returns few results, also try contains search
    if (items.length < 5) {
      const containsItems = await prisma.invoiceItem.findMany({
        where: {
          namaBarang: {
            contains: namaBarang,
          },
          sourceActive: true,
          invoice: { sourceActive: true },
          id: { notIn: items.map(i => i.id) },
        },
        include: {
          invoice: {
            include: {
              vendor: true,
              company: true,
            },
          },
        },
        orderBy: {
          invoice: {
            tglBeli: 'desc',
          },
        },
        take: 500,
      });
      items = [...items, ...containsItems];
    }

    // Also try partial match for cases where name might be shortened
    // e.g. "Ayam Broiler" should also find "Ayam Broiler Utuh"
    if (items.length < 5 && namaBarang.length > 4) {
      // Take first meaningful word (at least 4 chars)
      const words = namaBarang.split(/\s+/).filter(w => w.length >= 4);
      if (words.length > 0) {
        const partialItems = await prisma.invoiceItem.findMany({
          where: {
            namaBarang: {
              contains: words[0],
            },
            sourceActive: true,
            invoice: { sourceActive: true },
            id: { notIn: items.map(i => i.id) },
          },
          include: {
            invoice: {
              include: {
                vendor: true,
                company: true,
              },
            },
          },
          orderBy: {
            invoice: {
              tglBeli: 'desc',
            },
          },
          take: 200,
        });
        items = [...items, ...partialItems];
      }
    }

    const history = items.map((item) => ({
      id: item.id,
      namaBarang: item.namaBarang,
      keterangan: item.keterangan || '-',
      qtyPI: item.qtyPI,
      hargaPI: decimalToNumber(item.hargaPI),
      totalHarga: decimalToNumber(item.totalHarga),
      noPi: item.invoice.noPi,
      tglBeli: item.invoice.tglBeli.toISOString().split('T')[0],
      vendorName: item.invoice.vendor.name,
      vendorCode: item.invoice.vendor.code,
      companyName: item.invoice.company.name,
    }));

    // Calculate statistics
    const prices = history.map((h) => h.hargaPI).filter((p) => p > 0);
    const stats = {
      totalRecords: history.length,
      avgPrice: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
      minPrice: prices.length > 0 ? Math.min(...prices) : 0,
      maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
      totalQty: history.reduce((sum, h) => sum + h.qtyPI, 0),
    };

    return NextResponse.json({
      success: true,
      data: history,
      stats,
    });
  } catch (error) {
    console.error('Error fetching item history:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch item history',
      },
      { status: 500 }
    );
  }
}

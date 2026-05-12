import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import type { InvoiceFile } from '@/types/finance';
import { decimalToNumber } from '@/lib/decimal';

const prisma = new PrismaClient();
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { selectedRows, invoiceData } = body as {
      selectedRows: any[];
      invoiceData: Record<string, InvoiceFile[]>;
    };

    if (!selectedRows || selectedRows.length === 0) {
      return NextResponse.json({ success: false, error: 'selectedRows is required' }, { status: 400 });
    }

    const piIds = selectedRows.map((r: any) => r.id);

    // Fetch invoices with relations
    const invoices = await prisma.purchaseInvoice.findMany({
      where: { id: { in: piIds } },
      include: { vendor: true, company: true, items: true }
    });

    // Build a map from row id -> perusahaan override (from frontend dropdown)
    const companyOverride: Record<string, string> = {};
    selectedRows.forEach((r: any) => {
      if (r.perusahaan) {
        companyOverride[r.id] = r.perusahaan;
      }
    });

    const companyGroupsMap = new Map<string, any>();
    let grandTotal = 0;

    invoices.forEach(inv => {
      // Use the override from the dropdown if available, otherwise use DB company
      const companyName = companyOverride[inv.id] || inv.company.name;
      const vendorName = inv.vendor.name;

      if (!companyGroupsMap.has(companyName)) {
        companyGroupsMap.set(companyName, {
          companyName,
          vendorsMap: new Map<string, any>(),
          subtotalCompany: 0
        });
      }

      const compData = companyGroupsMap.get(companyName);
      if (!compData.vendorsMap.has(vendorName)) {
        compData.vendorsMap.set(vendorName, {
          vendorName,
          rows: [],
          subtotal: 0
        });
      }

      const vendorData = compData.vendorsMap.get(vendorName);

      const itemsMapped = inv.items.map(item => ({
        id: item.id,
        namaBarang: item.namaBarang,
        keterangan: item.keterangan || '',
        qtyPI: item.qtyPI,
        qtyPS: item.qtyPS,
        hargaPI: decimalToNumber(item.hargaPI),
        hargaPS: decimalToNumber(item.hargaPS),
        statusOcr: item.statusOcr,
        ocrReason: item.ocrReason || '',
        rekomendasi: item.recommendationNote || '',
        priorityScore: item.priorityScore || 0,
        marketPrice: item.marketPrice ? decimalToNumber(item.marketPrice) : null,
        referensi: '' // Will be filled by AI validate
      }));

      const row = {
        vendorId: inv.vendorId,
        invoiceId: inv.id,
        nomorInvoice: inv.noPi,
        tglFaktur: inv.tglFaktur ? inv.tglFaktur.toISOString().split('T')[0] : inv.tglBeli.toISOString().split('T')[0],
        namaRekening: inv.vendor.accountName || inv.vendor.name,
        nomorRekening: inv.vendor.bankAccount || '-',
        totalRencanaBayar: decimalToNumber(inv.totalRencanaBayar),
        hutang: decimalToNumber(inv.hutang),
        items: itemsMapped,
        invoiceLinks: invoiceData && invoiceData[inv.noPi] ? invoiceData[inv.noPi] : [],
      };

      vendorData.rows.push(row);
      const hutang = decimalToNumber(inv.hutang);
      vendorData.subtotal += hutang;
      compData.subtotalCompany += hutang;
      grandTotal += hutang;
    });

    // Convert Map to array
    const companyGroups = Array.from(companyGroupsMap.values()).map(c => ({
      companyName: c.companyName,
      subtotalCompany: c.subtotalCompany,
      vendorGroups: Array.from(c.vendorsMap.values())
    }));

    return NextResponse.json({
      success: true,
      data: {
        companyGroups,
        grandTotal,
        totalPI: selectedRows.length,
      },
    });
  } catch (error) {
    console.error('Error generating rekap:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to generate rekap' },
      { status: 500 }
    );
  }
}

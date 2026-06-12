const EXCEL_COL_COUNT = 21;

const headers = [
  'No',
  'Nama Vendor',
  'Nomor Invoice',
  'Tgl. Faktur',
  'Nama Rekening',
  'Nomor Rekening',
  'Total Rencana Bayar',
  'Hutang',
  'Nama Barang',
  'Keterangan',
  'Qty PI',
  'Qty PS',
  'Harga PI',
  'Harga PS',
  'Total',
  'Lampiran',
  'Status Dok.',
  'Checking Manual',
  'Prioritas',
  'Rekomendasi',
  'Referensi Harga',
];

const columnWidths = [6, 28, 18, 14, 22, 20, 18, 16, 28, 34, 12, 12, 16, 16, 16, 22, 20, 20, 14, 36, 24];

function getVisibleItems(row: any) {
  if (row.items?.length > 0) return row.items;

  return [{
    isPlaceholder: true,
    namaBarang: 'Item belum tersedia di RAW - PI',
    keterangan: 'PI ini belum memiliki baris item aktif dari spreadsheet.',
    qtyPI: 0,
    qtyPS: 0,
    hargaPI: 0,
    hargaPS: 0,
    statusOcr: 'pending',
    finalStatusOcr: 'pending',
    finalReason: 'Data item belum tersedia, sehingga AI check belum bisa dijalankan untuk PI ini.',
    manualStatusOcr: null,
    manualReason: '',
    ocrReason: '',
    rekomendasi: '',
    priorityScore: 0,
    marketPrice: null,
  }];
}

function countTotalItemRows(group: any): number {
  return group.rows.reduce((sum: number, row: any) => sum + Math.max((row.items || []).length, 1), 0);
}

function splitStatus(status?: string | null) {
  return (status || 'pending').split(',').map((value) => value.trim()).filter(Boolean);
}

function hasProblemStatus(status?: string | null) {
  return splitStatus(status).some((value) => ['discrepancy', 'Selisih', 'Tidak Valid', 'Rekening Tidak Valid'].includes(value));
}

function getStatusText(item: any) {
  const hasManualCheck = Boolean(item.manualStatusOcr || item.manualCheckedAt);
  const status = hasManualCheck ? 'Valid' : (item.finalStatusOcr || item.statusOcr || 'pending');
  return splitStatus(status)
    .map((value) => value === 'match' ? 'Valid' : value === 'discrepancy' ? 'Selisih' : value)
    .join(', ');
}

function getManualText(item: any) {
  if (item.isPlaceholder) return '-';
  return item.manualStatusOcr || item.manualCheckedAt ? 'Valid' : 'Belum dicek';
}

function getPriorityText(score: number) {
  if (score >= 80) return 'Urgent';
  if (score >= 50) return 'High';
  return 'Normal';
}

function getItemRecommendation(item: any) {
  const parts = [];
  if (item.rekomendasi) parts.push(String(item.rekomendasi).split('|')[0]?.trim() || '');
  if (item.marketPrice > 0) parts.push(`Pasar: ${item.marketPrice}`);
  return parts.filter(Boolean).join('\n') || '-';
}

function getInvoiceLinksText(row: any) {
  if (!row.invoiceLinks?.length) return '-';
  return row.invoiceLinks.map((file: any) => file.name || 'Lampiran').join('\n');
}

function getFirstInvoiceLink(row: any) {
  return row.invoiceLinks?.[0]?.webViewLink || '';
}

function getReferenceText(item: any) {
  if (item.isPlaceholder || !item.namaBarang || item.namaBarang === '-') return '-';
  return 'Tokopedia\nShopee';
}

function getReferenceLinks(item: any) {
  if (item.isPlaceholder || !item.namaBarang || item.namaBarang === '-') return [];
  const keyword = encodeURIComponent(item.namaBarang);
  return [
    `Tokopedia: https://www.tokopedia.com/search?q=${keyword}`,
    `Shopee: https://shopee.co.id/search?keyword=${keyword}`,
  ];
}

function toNumber(value: unknown) {
  const num = typeof value === 'number' ? value : Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function todayFileDate() {
  return new Date().toISOString().slice(0, 10);
}

function applyBorders(row: any) {
  row.eachCell({ includeEmpty: true }, (cell: any) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };
    cell.alignment = { vertical: 'top', wrapText: true };
  });
}

function styleCurrencyCell(cell: any) {
  cell.numFmt = '"Rp" #,##0';
  cell.alignment = { vertical: 'top', horizontal: 'right' };
}

function styleNumberCell(cell: any) {
  cell.numFmt = '#,##0.####';
  cell.alignment = { vertical: 'top', horizontal: 'right' };
}

function styleStatusCell(cell: any, status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('valid') && !normalized.includes('tidak')) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
    cell.font = { color: { argb: 'FF059669' }, bold: true };
  } else if (normalized.includes('selisih') || normalized.includes('tidak valid')) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
    cell.font = { color: { argb: 'FFDC2626' }, bold: true };
  } else {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    cell.font = { color: { argb: 'FF64748B' }, bold: true };
  }
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
}

function mergeIfNeeded(worksheet: any, startRow: number, endRow: number, col: number) {
  if (endRow > startRow) {
    worksheet.mergeCells(startRow, col, endRow, col);
  }
}

export async function exportRekapToExcel(companyGroups: any[], grandTotal: number) {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Rencana Anggaran App';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Rekap Anggaran', {
    views: [{ state: 'frozen', ySplit: 2 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  worksheet.columns = headers.map((header, index) => ({
    header,
    key: `col${index + 1}`,
    width: columnWidths[index],
  }));

  let currentRow = 1;

  companyGroups.forEach((companyGroup: any) => {
    worksheet.mergeCells(currentRow, 1, currentRow, EXCEL_COL_COUNT);
    const companyHeader = worksheet.getRow(currentRow);
    companyHeader.getCell(1).value = `${companyGroup.companyName}    Total PT: ${toNumber(companyGroup.subtotalCompany)}`;
    companyHeader.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    companyHeader.getCell(1).font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 14 };
    companyHeader.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    companyHeader.height = 24;
    currentRow += 1;

    const headerRow = worksheet.getRow(currentRow);
    headerRow.values = [undefined, ...headers];
    headerRow.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.font = { bold: true, color: { argb: 'FF334155' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    });
    headerRow.height = 28;
    currentRow += 1;

    companyGroup.vendorGroups.forEach((group: any, groupIndex: number) => {
      const vendorStartRow = currentRow;
      const totalVendorItemRows = countTotalItemRows(group);

      group.rows.forEach((row: any) => {
        const visibleItems = getVisibleItems(row);
        const invoiceStartRow = currentRow;

        visibleItems.forEach((item: any) => {
          const statusText = getStatusText(item);
          const manualText = getManualText(item);
          const isDiscrepancy = hasProblemStatus(statusText);
          const dataRow = worksheet.getRow(currentRow);
          dataRow.values = [
            undefined,
            groupIndex + 1,
            group.vendorName,
            row.nomorInvoice,
            row.tglFaktur || '-',
            row.namaRekening || '-',
            row.nomorRekening || '-',
            toNumber(row.totalRencanaBayar),
            toNumber(row.hutang),
            item.namaBarang || '-',
            item.keterangan || '-',
            toNumber(item.qtyPI),
            toNumber(item.qtyPS),
            toNumber(item.hargaPI),
            toNumber(item.hargaPS),
            toNumber(item.qtyPI) * toNumber(item.hargaPI),
            getInvoiceLinksText(row),
            statusText,
            manualText,
            item.isPlaceholder ? '-' : getPriorityText(toNumber(item.priorityScore)),
            getItemRecommendation(item),
            getReferenceText(item),
          ];

          applyBorders(dataRow);
          [7, 8, 13, 14, 15].forEach((col) => styleCurrencyCell(dataRow.getCell(col)));
          [11, 12].forEach((col) => styleNumberCell(dataRow.getCell(col)));
          [1, 16, 17, 18, 19, 21].forEach((col) => {
            dataRow.getCell(col).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          });
          styleStatusCell(dataRow.getCell(17), statusText);
          styleStatusCell(dataRow.getCell(18), manualText);

          if (isDiscrepancy) {
            dataRow.getCell(9).font = { color: { argb: 'FFDC2626' }, bold: true };
            dataRow.getCell(13).font = { color: { argb: 'FFDC2626' }, bold: true };
          }

          const invoiceLink = getFirstInvoiceLink(row);
          if (invoiceLink) {
            dataRow.getCell(16).value = { text: getInvoiceLinksText(row), hyperlink: invoiceLink };
            dataRow.getCell(16).font = { color: { argb: 'FF0F766E' }, underline: true };
          }

          const referenceLinks = getReferenceLinks(item);
          if (referenceLinks.length > 0) {
            dataRow.getCell(21).value = referenceLinks.join('\n');
            dataRow.getCell(21).font = { color: { argb: 'FF059669' }, underline: true };
          }

          dataRow.height = 34;
          currentRow += 1;
        });

        const invoiceEndRow = currentRow - 1;
        [3, 4, 5, 6, 7, 8, 16].forEach((col) => mergeIfNeeded(worksheet, invoiceStartRow, invoiceEndRow, col));
      });

      const vendorEndRow = vendorStartRow + totalVendorItemRows - 1;
      [1, 2].forEach((col) => mergeIfNeeded(worksheet, vendorStartRow, vendorEndRow, col));
    });

    const subtotalRow = worksheet.getRow(currentRow);
    worksheet.mergeCells(currentRow, 1, currentRow, EXCEL_COL_COUNT - 1);
    subtotalRow.getCell(1).value = `Subtotal ${companyGroup.companyName}`;
    subtotalRow.getCell(EXCEL_COL_COUNT).value = toNumber(companyGroup.subtotalCompany);
    subtotalRow.getCell(EXCEL_COL_COUNT).numFmt = '"Rp" #,##0';
    subtotalRow.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFFDF5' } };
      cell.font = { bold: true, color: { argb: 'FF0F766E' } };
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    });
    currentRow += 2;
  });

  const grandTotalRow = worksheet.getRow(currentRow);
  worksheet.mergeCells(currentRow, 1, currentRow, EXCEL_COL_COUNT - 1);
  grandTotalRow.getCell(1).value = 'GRAND TOTAL';
  grandTotalRow.getCell(EXCEL_COL_COUNT).value = toNumber(grandTotal);
  grandTotalRow.getCell(EXCEL_COL_COUNT).numFmt = '"Rp" #,##0';
  grandTotalRow.eachCell({ includeEmpty: true }, (cell: any) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.alignment = { vertical: 'middle', horizontal: 'right' };
  });

  worksheet.eachRow((row: any) => {
    row.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.protection = { locked: false };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `Rekap_Anggaran_CK_${todayFileDate()}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

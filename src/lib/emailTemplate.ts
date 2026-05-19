// ============================================================
// HTML Email Template for Director Approval
// (with item-level detail: Nama Barang, Qty PI/PS, Harga PI/PS)
// ============================================================

import type { RekapVendorGroup } from '@/types/finance';
import { formatRupiah, formatNumber, getTodayIndonesia } from './format';

/**
 * Generate HTML email body for director approval
 */
export function generateApprovalEmail(params: {
  directorName: string;
  companyGroups: any[];
  grandTotal: number;
  totalPI: number;
  senderName?: string;
}): string {
  const { directorName, companyGroups, grandTotal, totalPI, senderName } = params;
  const today = getTodayIndonesia();

  // Count total item rows for rowSpan
  function countGroupItemRows(group: any): number {
    return group.rows.reduce((sum: number, r: any) => sum + Math.max(r.items.length, 1), 0);
  }

  function splitStatus(status?: string | null): string[] {
    return (status || 'pending').split(', ').map((value) => value.trim()).filter(Boolean);
  }

  function renderStatusHtml(item: any): string {
    const effectiveStatus = item.finalStatusOcr || item.manualStatusOcr || item.statusOcr || 'pending';
    const effectiveReason = item.finalReason || item.manualReason || item.ocrReason || '';
    const statusHtml = splitStatus(effectiveStatus).map((status) => {
      if (status === 'Valid' || status === 'match') return '<span style="color:#059669;font-weight:700;">Valid</span>';
      if (status === 'Selisih' || status === 'discrepancy') return '<span style="color:#ea580c;font-weight:700;">Selisih</span>';
      if (status === 'Rekening Tidak Valid') return '<span style="color:#92400e;font-weight:700;">Rek. Tidak Valid</span>';
      if (status === 'Tidak Valid') return '<span style="color:#dc2626;font-weight:700;">Tidak Valid</span>';
      return '<span style="color:#9ca3af;">Pending</span>';
    }).join('<br/>');

    const reasonHtml = effectiveReason
      ? `<br/><span style="font-size:9px;color:#6b7280;font-weight:400;display:block;margin-top:2px;">${effectiveReason}</span>`
      : '';
    const manualHtml = item.manualStatusOcr
      ? '<br/><span style="font-size:9px;color:#1d4ed8;font-weight:700;display:block;margin-top:2px;">Manual Check</span>'
      : '';

    return statusHtml + reasonHtml + manualHtml;
  }

  // Build company and vendor table rows
  const companyRowsHtml = companyGroups.map((cg: any) => {
    const companyHeader = `
      <tr style="background-color:#1e3a8a;color:white;">
        <td colspan="16" style="padding:10px 12px;font-weight:700;font-size:12px;">🏛️ ${cg.companyName} — Total PT: ${formatRupiah(cg.subtotalCompany)}</td>
      </tr>`;

    let vendorNo = 1;
    const vendorRowsHtml = cg.vendorGroups.map((group: any) => {
      const totalGroupRows = countGroupItemRows(group);
      let isFirstVendorRow = true;

      const invoiceRowsHtml = group.rows.map((row: any) => {
        const itemCount = Math.max(row.items.length, 1);

        const itemRowsHtml = row.items.map((item: any, iIndex: number) => {
          const isFirstItem = iIndex === 0;
          const isFirstOfVendor = isFirstVendorRow && isFirstItem;
          if (isFirstOfVendor) isFirstVendorRow = false;

          const cells: string[] = [];

          // Vendor cells (rowSpan across all items of this vendor)
          if (isFirstOfVendor) {
            cells.push(`<td rowspan="${totalGroupRows}" style="padding:6px 8px;vertical-align:top;font-weight:700;background:#f0f4f8;border-right:2px solid #e5e7eb;text-align:center;font-size:12px;">${vendorNo++}</td>`);
            cells.push(`<td rowspan="${totalGroupRows}" style="padding:6px 8px;vertical-align:top;font-weight:600;background:#f0f4f8;border-right:2px solid #e5e7eb;font-size:12px;">${group.vendorName}</td>`);
          }

          // Invoice cells (rowSpan across items of this invoice)
          if (isFirstItem) {
            cells.push(`<td rowspan="${itemCount}" style="padding:6px 8px;vertical-align:top;font-family:monospace;font-size:11px;color:#1e40af;font-weight:600;">${row.nomorInvoice}</td>`);
            cells.push(`<td rowspan="${itemCount}" style="padding:6px 8px;vertical-align:top;font-size:11px;">${row.tglFaktur}</td>`);
            
            let lampiranHtml = '-';
            if (row.invoiceLinks && row.invoiceLinks.length > 0) {
              lampiranHtml = row.invoiceLinks.map((f: any) => 
                 `<a href="${f.webViewLink}" target="_blank" style="color:#2563eb;text-decoration:underline;">Lihat PDF</a>`
              ).join('<br/>');
            }
            cells.push(`<td rowspan="${itemCount}" style="padding:6px 8px;vertical-align:top;text-align:center;font-size:11px;white-space:nowrap;">${lampiranHtml}</td>`);
            
            cells.push(`<td rowspan="${itemCount}" style="padding:6px 8px;vertical-align:top;font-size:11px;">${row.namaRekening}</td>`);
            cells.push(`<td rowspan="${itemCount}" style="padding:6px 8px;vertical-align:top;font-size:11px;">${row.nomorRekening}</td>`);
            cells.push(`<td rowspan="${itemCount}" style="padding:6px 8px;vertical-align:top;text-align:right;font-family:monospace;font-weight:600;font-size:11px;">${formatRupiah(row.totalRencanaBayar)}</td>`);
            cells.push(`<td rowspan="${itemCount}" style="padding:6px 8px;vertical-align:top;text-align:right;font-family:monospace;font-weight:600;font-size:11px;">${formatRupiah(row.hutang)}</td>`);
          }

          // Item cells (one per row)
          cells.push(`<td style="padding:5px 8px;font-size:11px;">${item.namaBarang}</td>`);
          cells.push(`<td style="padding:5px 8px;font-size:11px;color:#6b7280;">${item.keterangan}</td>`);
          cells.push(`<td style="padding:5px 8px;text-align:right;font-family:monospace;font-size:11px;">${item.qtyPI > 0 ? formatNumber(item.qtyPI) : '-'}</td>`);
          cells.push(`<td style="padding:5px 8px;text-align:right;font-family:monospace;font-size:11px;">${item.qtyPS > 0 ? formatNumber(item.qtyPS) : '-'}</td>`);
          cells.push(`<td style="padding:5px 8px;text-align:right;font-family:monospace;font-size:11px;">${item.hargaPI > 0 ? formatRupiah(item.hargaPI) : '-'}</td>`);
          cells.push(`<td style="padding:5px 8px;text-align:right;font-family:monospace;font-size:11px;">${item.hargaPS > 0 ? formatRupiah(item.hargaPS) : '-'}</td>`);
          cells.push(`<td style="padding:5px 8px;text-align:center;font-size:11px;">${renderStatusHtml(item)}</td>`);

          const borderStyle = iIndex === itemCount - 1 ? '1px solid #d1d5db' : '1px solid #f3f4f6';
          return `<tr style="border-bottom:${borderStyle};">${cells.join('')}</tr>`;
        }).join('');

        return itemRowsHtml;
      }).join('');

      // Subtotal row
      const subtotalRow = `
        <tr style="background-color:#eff6ff;font-weight:600;">
          <td colspan="7" style="padding:8px;text-align:right;font-size:12px;">Subtotal ${group.vendorName}:</td>
          <td style="padding:8px;text-align:right;font-family:monospace;font-size:12px;color:#1e40af;">${formatRupiah(group.subtotal)}</td>
          <td colspan="8" style="padding:8px;"></td>
        </tr>`;

      return invoiceRowsHtml + subtotalRow;
    }).join('');

    return companyHeader + vendorRowsHtml;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <div style="max-width:1200px;margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:24px 28px;color:white;">
      <h1 style="margin:0;font-size:18px;font-weight:700;">📋 Rekap Rencana Anggaran - Central Kitchen</h1>
      <p style="margin:4px 0 0;font-size:13px;opacity:0.9;">A/P Tracking BCA Pembelian Central Kitchen</p>
    </div>

    <!-- Body -->
    <div style="padding:24px 28px;">

      <!-- Greeting -->
      <p style="font-size:14px;color:#374151;line-height:1.6;">
        Yth. <strong>${directorName}</strong>,<br/><br/>
        Berikut ini kami sampaikan rencana pembayaran yang memerlukan persetujuan Bapak/Ibu:
      </p>

      <!-- Summary Cards -->
      <div style="display:flex;gap:12px;margin:16px 0;">
        <div style="flex:1;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Tanggal</div>
          <div style="font-size:14px;font-weight:700;color:#1e3a5f;margin-top:4px;">${today}</div>
        </div>
        <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Jumlah PI</div>
          <div style="font-size:14px;font-weight:700;color:#166534;margin-top:4px;">${totalPI}</div>
        </div>
        <div style="flex:1;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Total Bayar</div>
          <div style="font-size:14px;font-weight:700;color:#92400e;margin-top:4px;">${formatRupiah(grandTotal)}</div>
        </div>
      </div>

      <!-- Data Table (Landscape-optimized, item-level detail) -->
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:11px;margin-top:20px;">
        <thead>
          <tr style="background:linear-gradient(180deg,#1e3a5f 0%,#1e40af 100%);color:white;">
            <th style="padding:8px;text-align:center;font-weight:600;font-size:10px;">No</th>
            <th style="padding:8px;text-align:left;font-weight:600;font-size:10px;">Vendor</th>
            <th style="padding:8px;text-align:left;font-weight:600;font-size:10px;">No. Invoice</th>
            <th style="padding:8px;text-align:left;font-weight:600;font-size:10px;">Tgl Faktur</th>
            <th style="padding:8px;text-align:center;font-weight:600;font-size:10px;">Lampiran</th>
            <th style="padding:8px;text-align:left;font-weight:600;font-size:10px;">Nama Rek.</th>
            <th style="padding:8px;text-align:left;font-weight:600;font-size:10px;">No. Rek.</th>
            <th style="padding:8px;text-align:right;font-weight:600;font-size:10px;">Rencana Bayar</th>
            <th style="padding:8px;text-align:right;font-weight:600;font-size:10px;">Hutang</th>
            <th style="padding:8px;text-align:left;font-weight:600;font-size:10px;">Nama Barang</th>
            <th style="padding:8px;text-align:left;font-weight:600;font-size:10px;">Keterangan</th>
            <th style="padding:8px;text-align:right;font-weight:600;font-size:10px;">Qty PI</th>
            <th style="padding:8px;text-align:right;font-weight:600;font-size:10px;">Qty PS</th>
            <th style="padding:8px;text-align:right;font-weight:600;font-size:10px;">Harga PI</th>
            <th style="padding:8px;text-align:right;font-weight:600;font-size:10px;">Harga PS</th>
            <th style="padding:8px;text-align:center;font-weight:600;font-size:10px;">Status Dok.</th>
          </tr>
        </thead>
        <tbody>
          ${companyRowsHtml}
        </tbody>
        <tfoot>
          <tr style="background:linear-gradient(180deg,#1e3a5f 0%,#1e40af 100%);color:white;font-weight:700;">
            <td colspan="7" style="padding:12px;text-align:right;font-size:14px;">GRAND TOTAL:</td>
            <td style="padding:12px;text-align:right;font-family:monospace;font-size:14px;">${formatRupiah(grandTotal)}</td>
            <td colspan="8" style="padding:12px;"></td>
          </tr>
        </tfoot>
      </table>

      <!-- Closing -->
      <div style="margin-top:24px;padding:16px;background-color:#f9fafb;border-radius:8px;border-left:4px solid #2563eb;">
        <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">
          Mohon persetujuan Bapak/Ibu untuk proses pembayaran di atas.<br/>
          Apabila ada pertanyaan atau koreksi, silakan hubungi bagian finance.
        </p>
      </div>

      <!-- Signature -->
      <div style="margin-top:24px;font-size:13px;color:#374151;">
        <p style="margin:0;">Hormat kami,</p>
        <p style="margin:4px 0 0;font-weight:600;">${senderName || 'Tim Finance'}</p>
        <p style="margin:2px 0 0;font-size:11px;color:#9ca3af;">Central Kitchen Finance Division</p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color:#f9fafb;padding:14px 28px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:10px;color:#9ca3af;">
        Email ini di-generate otomatis oleh Aplikasi Rencana Anggaran - Central Kitchen<br/>
        © ${new Date().getFullYear()} Central Kitchen Finance
      </p>
    </div>
  </div>
</body>
</html>`;
}

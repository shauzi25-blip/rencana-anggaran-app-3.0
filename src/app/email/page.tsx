'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import { useSelectedPIStore } from '@/store/useSelectedPI';
import { formatRupiah, getTodayIndonesia, formatNumber } from '@/lib/format';
import type { InvoiceFile } from '@/types/finance';
import {
  ArrowLeft,
  Send,
  Eye,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Mail,
  Copy,
  User,
  AtSign,
} from 'lucide-react';
import Link from 'next/link';

function splitStatus(status?: string | null) {
  return (status || 'pending').split(', ').map((s: string) => s.trim()).filter(Boolean);
}

export default function EmailPage() {
  const { selectedIds, getSelectedRows, invoiceData, rekapGroups, rekapGrandTotal } = useSelectedPIStore();
  const selectedRows = getSelectedRows();

  const [companyGroups, setCompanyGroups] = useState<any[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [emailHtml, setEmailHtml] = useState('');

  // Form fields
  const [toEmail, setToEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [directorName, setDirectorName] = useState('Pak Hendra');
  const [senderName, setSenderName] = useState('Tim Finance');

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load rekap data — prefer store data (AI-enriched), fallback to API
  useEffect(() => {
    if (selectedRows.length === 0) return;

    if (rekapGroups && rekapGroups.length > 0) {
      setCompanyGroups(rekapGroups);
      setGrandTotal(rekapGrandTotal);
      return;
    }

    const loadData = async () => {
      setLoading(true);
      try {
        const rekapRes = await fetch('/api/rekap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedRows,
            invoiceData,
          }),
        });
        const rekapJson = await rekapRes.json();
        if (rekapJson.success) {
          setCompanyGroups(rekapJson.data.companyGroups || []);
          setGrandTotal(rekapJson.data.grandTotal || 0);
        }
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Gagal memuat data rekap');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRows.length, rekapGroups]);



  const getPriorityText = (score: number) => {
    if (score >= 80) return '🔴 Urgent';
    if (score >= 50) return '🟡 High';
    return '🟢 Normal';
  };

  // Generate HTML string synchronously — Full 20-column table matching Rekap
  const generateHtmlLocal = useCallback(() => {
    const today = getTodayIndonesia();
    let tableRows = '';
    let rowNum = 1;
    
    companyGroups.forEach((cg: any) => {
      tableRows += `<tr style="background:#0f766e;color:white;"><td colspan="20" style="padding:10px 12px;font-weight:700;font-size:14px;">🏛️ ${cg.companyName} — Total: ${formatRupiah(cg.subtotalCompany)}</td></tr>`;
      
      cg.vendorGroups?.forEach((vg: any) => {
        const totalVendorItems = vg.rows?.reduce((s: number, r: any) => s + Math.max((r.items || []).length, 1), 0) || 0;
        let isFirstVendorRow = true;

        vg.rows?.forEach((row: any) => {
          const items = row.items || [];
          const itemCount = Math.max(items.length, 1);

          items.forEach((item: any, idx: number) => {
            const isFirstItem = idx === 0;
            const isFirstOfVendor = isFirstVendorRow && isFirstItem;
            if (isFirstOfVendor) isFirstVendorRow = false;

            const effectiveStatus = item.finalStatusOcr || item.manualStatusOcr || item.statusOcr || 'pending';
            const effectiveReason = item.finalReason || item.manualReason || item.ocrReason || '';
            const statusArr = splitStatus(effectiveStatus);
            const isDiscrepancy = statusArr.includes('discrepancy') || statusArr.includes('Selisih') || statusArr.includes('Tidak Valid') || statusArr.includes('Rekening Tidak Valid');
            const rowBg = isDiscrepancy ? 'background:#fef2f2;' : '';

            tableRows += `<tr style="border-bottom:1px solid #e5e7eb;color:black;${rowBg}">`;
            
            // Vendor columns (rowspan)
            if (isFirstOfVendor) {
              tableRows += `<td rowspan="${totalVendorItems}" style="padding:6px 8px;font-size:12px;text-align:center;border-right:1px solid #e5e7eb;font-weight:700;background:#f8fafc;vertical-align:top;">${rowNum}</td>`;
              tableRows += `<td rowspan="${totalVendorItems}" style="padding:6px 8px;font-size:12px;border-right:1px solid #e5e7eb;font-weight:600;background:#f8fafc;vertical-align:top;">${vg.vendorName}</td>`;
            }

            // Invoice columns (rowspan)
            if (isFirstItem) {
              tableRows += `<td rowspan="${itemCount}" style="padding:6px 8px;font-size:11px;color:#0f766e;font-weight:600;vertical-align:top;font-family:monospace;">${row.nomorInvoice}</td>`;
              tableRows += `<td rowspan="${itemCount}" style="padding:6px 8px;font-size:11px;vertical-align:top;">${row.tglFaktur || '-'}</td>`;
              tableRows += `<td rowspan="${itemCount}" style="padding:6px 8px;font-size:11px;vertical-align:top;">${row.namaRekening || '-'}</td>`;
              tableRows += `<td rowspan="${itemCount}" style="padding:6px 8px;font-size:11px;vertical-align:top;font-family:monospace;">${row.nomorRekening || '-'}</td>`;
              tableRows += `<td rowspan="${itemCount}" style="padding:6px 8px;font-size:11px;text-align:right;font-family:monospace;font-weight:600;vertical-align:top;">${formatRupiah(row.totalRencanaBayar)}</td>`;
              tableRows += `<td rowspan="${itemCount}" style="padding:6px 8px;font-size:11px;text-align:right;font-family:monospace;font-weight:600;vertical-align:top;color:#dc2626;">${formatRupiah(row.hutang || 0)}</td>`;
            }

            // Item columns
            tableRows += `<td style="padding:5px 8px;font-size:11px;${isDiscrepancy ? 'color:#dc2626;font-weight:700;' : ''}">${item.namaBarang}</td>`;
            tableRows += `<td style="padding:5px 8px;font-size:11px;color:#6b7280;">${item.keterangan || '-'}</td>`;
            tableRows += `<td style="padding:5px 8px;font-size:11px;text-align:right;font-family:monospace;">${item.qtyPI > 0 ? formatNumber(item.qtyPI) : '-'}</td>`;
            tableRows += `<td style="padding:5px 8px;font-size:11px;text-align:right;font-family:monospace;">${item.qtyPS > 0 ? formatNumber(item.qtyPS) : '-'}</td>`;
            tableRows += `<td style="padding:5px 8px;font-size:11px;text-align:right;font-family:monospace;">${item.hargaPI > 0 ? formatRupiah(item.hargaPI) : '-'}</td>`;
            tableRows += `<td style="padding:5px 8px;font-size:11px;text-align:right;font-family:monospace;">${item.hargaPS > 0 ? formatRupiah(item.hargaPS) : '-'}</td>`;
            tableRows += `<td style="padding:5px 8px;font-size:11px;text-align:right;font-family:monospace;font-weight:600;">${formatRupiah((item.qtyPI || 0) * (item.hargaPI || 0))}</td>`;
            
            // STATUS DOK
            let finalStatusStr = statusArr.map((st: string) => {
              if (st === 'Valid' || st === 'match') return '<span style="color:#059669;font-weight:700;">✅ Valid</span>';
              if (st === 'Selisih' || st === 'discrepancy') return '<span style="color:#ea580c;font-weight:700;">⚠️ Selisih</span>';
              if (st === 'Rekening Tidak Valid') return '<span style="color:#92400e;font-weight:700;">🔴 Rek. Tidak Valid</span>';
              if (st === 'Tidak Valid') return '<span style="color:#dc2626;font-weight:700;">❌ Tidak Valid</span>';
              return '<span style="color:#9ca3af;">⏳ Pending</span>';
            }).join('<br/>');

            if (isDiscrepancy && effectiveReason) {
              finalStatusStr += `<br/><span style="font-size:9px;color:#dc2626;font-weight:400;display:block;margin-top:2px;">${effectiveReason}</span>`;
            }

            if (item.manualStatusOcr) {
              finalStatusStr += `<br/><span style="font-size:9px;color:#1d4ed8;font-weight:700;display:block;margin-top:2px;">Manual Check</span>`;
            }
            tableRows += `<td style="padding:5px 8px;font-size:11px;text-align:center;">${finalStatusStr}</td>`;

            // Prioritas
            tableRows += `<td style="padding:5px 8px;font-size:11px;text-align:center;">${getPriorityText(item.priorityScore || 0)}</td>`;

            // Rekomendasi + Detail Link
            const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://rencana-anggaran-app.vercel.app';
            const rekomText = item.rekomendasi && item.rekomendasi.trim() !== '' 
              ? item.rekomendasi.split('|')[0]?.trim()?.substring(0, 80) + (item.rekomendasi.length > 80 ? '...' : '') 
              : '-';
            const detailLink = item.namaBarang && item.namaBarang !== '-'
              ? `<br/><a href="${baseUrl}/history?item=${encodeURIComponent(item.namaBarang)}&price=${item.hargaPI || 0}" target="_blank" style="display:inline-block;margin-top:6px;padding:4px 8px;background:#f0fdfa;color:#0f766e;text-decoration:none;font-weight:600;border-radius:6px;border:1px solid #99f6e4;font-size:10px;">📋 Cek Histori</a>`
              : '';
            tableRows += `<td style="padding:5px 8px;font-size:10px;color:#374151;max-width:200px;">${rekomText}${item.marketPrice > 0 ? `<br/><span style="color:#059669;font-weight:600;margin-top:4px;display:block;">Pasar: ${formatRupiah(item.marketPrice)}</span>` : ''}${detailLink}</td>`;

            // Referensi Harga
            if (item.namaBarang && item.namaBarang !== '-') {
              tableRows += `<td style="padding:5px 8px;font-size:10px;vertical-align:middle;"><a href="https://www.tokopedia.com/search?q=${encodeURIComponent(item.namaBarang)}" target="_blank" style="color:#059669;text-decoration:none;font-weight:600;">Tokopedia</a><br/><a href="https://shopee.co.id/search?keyword=${encodeURIComponent(item.namaBarang)}" target="_blank" style="color:#ea580c;text-decoration:none;font-weight:600;">Shopee</a></td>`;
            } else {
              tableRows += `<td style="padding:5px 8px;font-size:10px;color:#9ca3af;">-</td>`;
            }

            // Lampiran (only on the first item of invoice)
            if (isFirstItem) {
              const lampiran = (row.invoiceLinks && row.invoiceLinks.length > 0)
                ? row.invoiceLinks.map((f: any) => `<a href="${f.webViewLink}" target="_blank" style="color:#0f766e;text-decoration:underline;display:inline-block;margin-bottom:2px;">PDF</a>`).join('<br/>')
                : '-';
              tableRows += `<td rowspan="${itemCount}" style="padding:6px 8px;font-size:11px;vertical-align:top;text-align:center;">${lampiran}</td>`;
            }

            tableRows += `</tr>`;
          });
          rowNum++;
        });
      });
    });

    const thSt = 'padding:8px 6px;font-size:10px;border:1px solid #93a3b8;white-space:nowrap;';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:1600px;margin:0 auto;padding:20px;color:black;">
        <div style="text-align:center;margin-bottom:20px;">
          <h2 style="color:#0f766e;margin:0;">Rencana Anggaran - Central Kitchen</h2>
          <p style="color:#6b7280;margin:4px 0;">Tanggal: ${today} • ${selectedRows.length} PI • Total: ${formatRupiah(grandTotal)}</p>
        </div>

        <p>Yth. ${directorName},</p>
        <p>Bersama email ini, kami sampaikan rencana anggaran pembelian Central Kitchen yang memerlukan persetujuan Bapak/Ibu:</p>

        <table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #d1d5db;">
          <thead>
            <tr style="background:#0f766e;color:white;">
              <th style="${thSt}">No</th>
              <th style="${thSt}min-width:220px;">Nama Vendor</th>
              <th style="${thSt}">Nomor Invoice</th>
              <th style="${thSt}">Tgl. Faktur</th>
              <th style="${thSt}">Nama Rekening</th>
              <th style="${thSt}">Nomor Rekening</th>
              <th style="${thSt}text-align:right;">Total Rencana Bayar</th>
              <th style="${thSt}text-align:right;">Hutang</th>
              <th style="${thSt}min-width:160px;">Nama Barang</th>
              <th style="${thSt}min-width:200px;">Keterangan</th>
              <th style="${thSt}text-align:right;">Qty PI</th>
              <th style="${thSt}text-align:right;">Qty PS</th>
              <th style="${thSt}text-align:right;">Harga PI</th>
              <th style="${thSt}text-align:right;">Harga PS</th>
              <th style="${thSt}text-align:right;">Total</th>
              <th style="${thSt}min-width:180px;">Status Dok.</th>
              <th style="${thSt}">Prioritas</th>
              <th style="${thSt}min-width:280px;">Rekomendasi</th>
              <th style="${thSt}">Referensi Harga</th>
              <th style="${thSt}">Lampiran</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
            <tr style="background:#0f766e;color:white;font-weight:700;">
              <td colspan="19" style="padding:12px;text-align:right;font-size:14px;">GRAND TOTAL</td>
              <td style="padding:12px;text-align:right;font-family:monospace;font-size:14px;">${formatRupiah(grandTotal)}</td>
            </tr>
          </tbody>
        </table>

        <p>Demikian kami sampaikan, atas perhatian dan persetujuan Bapak/Ibu, kami ucapkan terima kasih.</p>

        <p style="margin-top:24px;">
          Hormat kami,<br/>
          <strong>${senderName}</strong>
        </p>
      </div>
    `;
    return html;
  }, [companyGroups, grandTotal, selectedRows.length, directorName, senderName]);

  // Preview email - trigger visualization
  const previewEmail = useCallback(() => {
    const html = generateHtmlLocal();
    setEmailHtml(html);
    setShowPreview(true);
  }, [generateHtmlLocal]);

  // Send email via Server (Old Method)
  const sendEmail = useCallback(async () => {
    if (!toEmail || !directorName) {
      setError('Email dan nama direktur harus diisi');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail,
          cc: ccEmail || undefined,
          directorName,
          companyGroups,
          grandTotal,
          totalPI: selectedRows.length,
          piList: selectedRows.map(r => r.noPi),
          piIds: selectedRows.map(r => r.id),
          senderName,
        }),
      });

      const json = await res.json();

      if (json.success) {
        setSent(true);
      } else {
        setError(json.error || 'Gagal mengirim email via server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim email via server');
    } finally {
      setSending(false);
    }
  }, [toEmail, ccEmail, directorName, companyGroups, grandTotal, selectedRows, senderName]);

  // Open Gmail with Rich HTML automatically copied to clipboard
  const openGmailWithClipboard = useCallback(async () => {
    if (!toEmail || !directorName) {
      setError('Email tujuan & Direktur harus terisi');
      return;
    }
    
    setError(null);
    const html = generateHtmlLocal();
    setEmailHtml(html);
    setShowPreview(true);

    try {
      // Create a ClipboardItem holding rich text/html
      const clipboardItem = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html.replace(/<[^>]+>/g, '')], { type: 'text/plain' })
      });
      await navigator.clipboard.write([clipboardItem]);

      // Open new tab to Gmail Compose
      const subject = encodeURIComponent(`[Approval Required] A/P Tracking BCA Pembelian Central Kitchen - ${getTodayIndonesia()}`);
      const ccParam = ccEmail ? `&cc=${ccEmail}` : '';
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${toEmail}${ccParam}&su=${subject}`;
      
      window.open(gmailUrl, '_blank');
      
      // Auto-archive the PIs manually since we are bypassing SMTP server
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: toEmail,
            cc: ccEmail || undefined,
            directorName,
            companyGroups: [], // Dummy, to save DB only
            grandTotal,
            totalPI: selectedRows.length,
            piList: selectedRows.map(r => r.noPi),
            piIds: selectedRows.map(r => r.id),
            senderName,
          }), // Since SMPT is configured not to send if dummy email but will update DB
        });
      } catch (e) {
        console.error("Failed to auto archive", e);
      }

      // We consider it sent manually
      alert("✅ Berhasil meng-copy template HTML!\n\n1. Telah membuka tab Gmail baru.\n2. Klik di kotak isian isi email (isi pesan) pada Gmail.\n3. Tekan tombol Ctrl + V atau Klik-Kanan Paste untuk menempel tabel!");
      setSent(true);

    } catch (err) {
      console.error('Clipboard injection error', err);
      alert("⚠️ Gagal mencopy format secara otomatis karena policy browser. Buka Preview HTML, blok semua kode tabel di layar, tekan Ctrl+C, lalu buka email baru.");
    }
  }, [toEmail, ccEmail, directorName, generateHtmlLocal, grandTotal, selectedRows, senderName]);

  // Update iframe content when HTML changes
  useEffect(() => {
    if (iframeRef.current && emailHtml) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(emailHtml);
        doc.close();
      }
    }
  }, [emailHtml, showPreview]);

  const today = getTodayIndonesia();

  if (selectedIds.size === 0) {
    return (
      <div>
        <Sidebar />
        <main className="main-content">
          <div className="page-header">
            <h2>Email Approval</h2>
            <p>Generate dan kirim email approval ke direktur</p>
          </div>
          <div style={{ padding: '0 32px' }}>
            <div className="glass-card" style={{ padding: 60, textAlign: 'center' }}>
              <Mail size={48} color="#6b7280" style={{ margin: '0 auto 16px' }} />
              <h3 style={{ color: '#374151', marginBottom: 8 }}>Belum ada PI yang dipilih</h3>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
                Kembali ke Modal Anggaran untuk memilih PI yang akan dibayar.
              </p>
              <Link href="/" className="btn btn-primary">
                <ArrowLeft size={16} />
                Ke Modal Anggaran
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (sent) {
    return (
      <div>
        <Sidebar />
        <main className="main-content">
          <div className="page-header">
            <h2>Email Terkirim ✓</h2>
          </div>
          <div style={{ padding: '0 32px' }}>
            <div className="glass-card" style={{ padding: 60, textAlign: 'center' }}>
              <div style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #059669, #10b981)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}>
                <CheckCircle2 size={40} color="white" />
              </div>
              <h3 style={{ color: '#059669', marginBottom: 8, fontSize: 22 }}>Email Berhasil Dikirim!</h3>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 8 }}>
                Email approval telah dikirim ke <strong>{toEmail}</strong>
              </p>
              <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 24 }}>
                {selectedRows.length} PI • {formatRupiah(grandTotal)} • {today}
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <Link href="/" className="btn btn-secondary">
                  <ArrowLeft size={16} />
                  Ke Modal Anggaran
                </Link>
                <Link href="/log" className="btn btn-primary">
                  Lihat Log
                </Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div>
      <Sidebar />
      <main className="main-content">
        {/* Header */}
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Email Approval</h2>
            <p>Generate dan kirim email persetujuan direktur</p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link href="/rekap" className="btn btn-secondary">
              <ArrowLeft size={16} />
              Rekap
            </Link>
          </div>
        </div>

        <div style={{ padding: '0 32px 32px', display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24 }}>
          {/* Email Form */}
          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', marginBottom: 20 }}>
              📧 Pengaturan Email
            </h3>

            {/* Subject (readonly) */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Subject
              </label>
              <div style={{
                padding: '10px 14px',
                background: '#f3f4f6',
                borderRadius: 8,
                fontSize: 13,
                color: '#374151',
                border: '1px solid #e5e7eb',
              }}>
                [Approval Required] A/P Tracking BCA Pembelian Central Kitchen - {today}
              </div>
            </div>

            {/* To */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <AtSign size={12} style={{ display: 'inline', marginRight: 4 }} />
                Kepada (To)
              </label>
              <input
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                className="search-input"
                style={{ paddingLeft: 14 }}
                placeholder="email@company.com"
                id="email-to-input"
              />
            </div>

            {/* CC */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                CC (Opsional)
              </label>
              <input
                type="email"
                value={ccEmail}
                onChange={(e) => setCcEmail(e.target.value)}
                className="search-input"
                style={{ paddingLeft: 14 }}
                placeholder="cc@company.com"
                id="email-cc-input"
              />
            </div>

            {/* Director Name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <User size={12} style={{ display: 'inline', marginRight: 4 }} />
                Nama Direktur
              </label>
              <input
                type="text"
                value={directorName}
                onChange={(e) => setDirectorName(e.target.value)}
                className="search-input"
                style={{ paddingLeft: 14 }}
                placeholder="Pak Hendra"
                id="director-name-input"
              />
            </div>

            {/* Sender Name */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Pengirim
              </label>
              <input
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="search-input"
                style={{ paddingLeft: 14 }}
                placeholder="Tim Finance"
                id="sender-name-input"
              />
            </div>

            {/* Summary */}
            <div style={{
              padding: 14,
              background: 'rgba(240, 253, 250, 0.6)',
              borderRadius: 12,
              border: '1px solid rgba(153, 246, 228, 0.4)',
              marginBottom: 20,
              fontSize: 13,
            }}>
              <div style={{ fontWeight: 600, color: '#0f766e', marginBottom: 8 }}>Ringkasan</div>
              <div style={{ color: '#374151', lineHeight: 1.8 }}>
                <div>📅 Tanggal: <strong>{today}</strong></div>
                <div>📦 Jumlah PI: <strong>{selectedRows.length}</strong></div>
                <div>🏢 Perusahaan: <strong>{companyGroups.length}</strong></div>
                <div>💰 Total: <strong>{formatRupiah(grandTotal)}</strong></div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                padding: 12,
                background: '#fef2f2',
                borderRadius: 8,
                border: '1px solid #fecaca',
                marginBottom: 16,
                fontSize: 13,
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <AlertTriangle size={16} />
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn btn-secondary"
                onClick={previewEmail}
                disabled={loading || companyGroups.length === 0}
                style={{ width: '100%' }}
                id="preview-email-btn"
              >
                <Eye size={16} />
                Preview Email
              </button>
              
              <button
                className="btn btn-primary btn-lg"
                onClick={openGmailWithClipboard}
                disabled={sending || loading || companyGroups.length === 0 || !toEmail}
                style={{ width: '100%', background: 'linear-gradient(135deg, #059669, #10b981)', border: 'none', boxShadow: '0 4px 16px rgba(5, 150, 105, 0.3)' }}
                id="gmail-auto-btn"
              >
                <Mail size={18} />
                Copy Template & Buka Gmail Tab
              </button>
              
              <button
                className="btn btn-secondary"
                onClick={sendEmail}
                disabled={sending || loading || companyGroups.length === 0 || !toEmail}
                style={{ width: '100%', fontSize: 13, background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }}
                id="send-email-server-btn"
                title="Menggunakan SMTP Server (Rawan diblokir Google 535 Error)"
              >
                {sending ? <Loader2 size={16} className="pulse" /> : <Send size={16} />}
                {sending ? 'Mengirim...' : 'Kirim via Server (Backend)'}
              </button>
            </div>
          </div>

          {/* Email Preview */}
          <div className="glass-card" style={{ padding: 24, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>
                👁️ Preview Email
              </h3>
              {emailHtml && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(emailHtml);
                  }}
                >
                  <Copy size={14} />
                  Copy HTML
                </button>
              )}
            </div>

            {loading ? (
              <div style={{ padding: 60, textAlign: 'center' }}>
                <div className="spinner" style={{ margin: '0 auto 16px' }} />
                <p style={{ color: '#6b7280', fontSize: 14 }}>Mempersiapkan preview...</p>
              </div>
            ) : showPreview && emailHtml ? (
              <div className="email-preview">
                <iframe
                  ref={iframeRef}
                  title="Email Preview"
                  style={{
                    width: '100%',
                    minHeight: 500,
                    border: 'none',
                    borderRadius: 8,
                  }}
                  sandbox="allow-same-origin"
                />
              </div>
            ) : (
              <div style={{
                padding: 60,
                textAlign: 'center',
                border: '2px dashed #e5e7eb',
                borderRadius: 12,
                color: '#9ca3af',
              }}>
                <Eye size={40} style={{ margin: '0 auto 12px' }} />
                <p style={{ fontSize: 14 }}>Klik &quot;Preview Email&quot; untuk melihat hasil email</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

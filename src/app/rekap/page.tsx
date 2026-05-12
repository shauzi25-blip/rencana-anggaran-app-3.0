'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import ItemHistoryModal from '@/components/ItemHistoryModal';
import { useSelectedPIStore } from '@/store/useSelectedPI';
import { formatRupiah, formatNumber } from '@/lib/format';
import type { InvoiceFile } from '@/types/finance';
import {
  ArrowLeft,
  ArrowRight,
  FileSearch,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Download,
  Bot,
  FileText,
  Info,
  Shield,
  Clock,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';

export default function RekapPage() {
  const { selectedIds, getSelectedRows, invoiceData, setInvoiceData, setRekapData } = useSelectedPIStore();
  const selectedRows = getSelectedRows();

  const [companyGroups, setCompanyGroups] = useState<any[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceSearched, setInvoiceSearched] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [aiAllLoading, setAiAllLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [bankAccountDrafts, setBankAccountDrafts] = useState<Record<string, string>>({});
  const [savingBankAccount, setSavingBankAccount] = useState<Record<string, boolean>>({});
  const tableRef = useRef<HTMLDivElement>(null);

  // Modal state for Item History
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedItemName, setSelectedItemName] = useState('');
  const [selectedItemPrice, setSelectedItemPrice] = useState<number | undefined>(undefined);

  // Modal state for AI Discrepancy Note
  const [showDiscrepancyModal, setShowDiscrepancyModal] = useState<string | null>(null);

  // Track if initial rekap has been loaded
  const initialLoadDone = useRef(false);

  // Group selected rows by perusahaan for the rekap — only on initial load
  useEffect(() => {
    if (selectedRows.length === 0) return;
    if (initialLoadDone.current) return; // Don't re-fetch on invoiceData changes

    const generateRekap = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/rekap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedRows,
            invoiceData: {}, // Don't pass invoiceData on initial load
          }),
        });
        const json = await res.json();
        if (json.success) {
          setCompanyGroups(json.data.companyGroups);
          setGrandTotal(json.data.grandTotal);
          initialLoadDone.current = true;
        }
      } catch (err) {
        console.error('Error generating rekap:', err);
      } finally {
        setLoading(false);
      }
    };

    generateRekap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRows.length]);

  // When invoiceData changes (after search), merge links into existing companyGroups client-side
  useEffect(() => {
    if (!invoiceData || Object.keys(invoiceData).length === 0) return;
    if (companyGroups.length === 0) return;

    setCompanyGroups(groups => groups.map((cg: any) => ({
      ...cg,
      vendorGroups: cg.vendorGroups.map((vg: any) => ({
        ...vg,
        rows: vg.rows.map((row: any) => {
          // Try multiple key formats for matching
          const links = invoiceData[row.nomorInvoice] 
            || invoiceData[row.nomorInvoice?.trim()] 
            || [];
          return {
            ...row,
            invoiceLinks: links.length > 0 ? links : row.invoiceLinks,
          };
        }),
      })),
    })));
    setInvoiceSearched(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceData]);

  // Sync companyGroups to store so Email page can access AI-enriched data
  useEffect(() => {
    if (companyGroups.length > 0) {
      setRekapData(companyGroups, grandTotal);
    }
  }, [companyGroups, grandTotal, setRekapData]);

  // Search invoices in Google Drive
  const searchInvoices = useCallback(async () => {
    if (selectedRows.length === 0) return;

    setInvoiceLoading(true);
    try {
      const piList = selectedRows.map(r => r.noPi);
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piList }),
      });
      const json = await res.json();
      if (json.success) {
        setInvoiceData(json.data);
        // invoiceSearched will be set via the useEffect above
      }
    } catch (err) {
      console.error('Error searching invoices:', err);
    } finally {
      setInvoiceLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRows.length]);

  // AI Validate ALL items at once
  const validateAllAI = async () => {
    setAiAllLoading(true);
    setAiProgress('Mengumpulkan data item...');
    try {
      // Collect all item IDs from all company groups
      const allItems: { itemId: string; piNumber: string; driveFileId?: string }[] = [];
      companyGroups.forEach((cg: any) => {
        cg.vendorGroups.forEach((vg: any) => {
          vg.rows.forEach((row: any) => {
            const driveFileId = row.invoiceLinks?.[0]?.id;
            row.items.forEach((item: any) => {
              allItems.push({ itemId: item.id, piNumber: row.nomorInvoice, driveFileId });
            });
          });
        });
      });

      let completed = 0;
      const totalItems = allItems.length;

      for (const itemData of allItems) {
        setAiProgress(`Memvalidasi item ${completed + 1} dari ${totalItems} (Jangan tutup halaman ini)...`);
        
        try {
          const res = await fetch('/api/ai/validate-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Send exactly 1 item per request to completely avoid 504 Vercel Edge timeout
            body: JSON.stringify({ items: [itemData] }),
          });
          const data = await res.json();
          
          if (data.success && data.results) {
            // Update local state incrementally so user sees progress
            setCompanyGroups(groups => groups.map((c: any) => ({
              ...c,
              vendorGroups: c.vendorGroups.map((v: any) => ({
                ...v,
                rows: v.rows.map((row: any) => ({
                  ...row,
                  items: row.items.map((item: any) => {
                    const result = data.results[item.id];
                    if (result) {
                      return { 
                        ...item, 
                        statusOcr: result.status, 
                        ocrReason: result.ocrReason || '',
                        rekomendasi: result.recommendation, 
                        referensi: result.referensi,
                        priorityScore: result.priorityScore || 0,
                        marketPrice: result.marketPrice || null,
                      };
                    }
                    return item;
                  })
                }))
              }))
            })));
          }
        } catch (err) {
          console.error('Error on item', itemData.itemId, err);
        }
        completed++;
      }
      
      setAiProgress('');
    } catch (err) {
      console.error(err);
      alert('Gagal menjalankan validasi AI untuk semua item');
    } finally {
      setAiAllLoading(false);
      setAiProgress('');
    }
  };

  // Download PDF
  const downloadPDF = useCallback(async () => {
    if (!tableRef.current) return;
    setPdfLoading(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const today = new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
      const pdfHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="font-size: 18px; margin: 0; color: #1e3a5f;">Rekap Rencana Anggaran - Central Kitchen</h1>
            <p style="font-size: 12px; color: #6b7280; margin: 4px 0 0;">Tanggal: ${today} • Total: ${formatRupiah(grandTotal)}</p>
          </div>
          ${tableRef.current.innerHTML}
        </div>
      `;
      const container = document.createElement('div');
      container.innerHTML = pdfHtml;
      document.body.appendChild(container);
      const opt = {
        margin: [8, 8, 8, 8],
        filename: `Rekap_Anggaran_CK_${new Date().toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' as const },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      };
      await html2pdf().set(opt).from(container).save();
      document.body.removeChild(container);
    } catch (err) {
      console.error('Error generating PDF:', err);
    } finally {
      setPdfLoading(false);
    }
  }, [companyGroups, grandTotal, selectedRows.length]);

  function countTotalItemRows(group: any): number {
    return group.rows.reduce((sum: number, row: any) => sum + Math.max(row.items.length, 1), 0);
  }

  // Open Item History Modal
  const openHistoryModal = (namaBarang: string, hargaPI?: number) => {
    setSelectedItemName(namaBarang);
    setSelectedItemPrice(hargaPI);
    setShowHistoryModal(true);
  };

  const getBankAccountDraft = (row: any) => {
    const key = row.vendorId || row.nomorInvoice;
    if (bankAccountDrafts[key] !== undefined) return bankAccountDrafts[key];
    return row.nomorRekening && row.nomorRekening !== '-' ? row.nomorRekening : '';
  };

  const updateBankAccountDraft = (row: any, value: string) => {
    const key = row.vendorId || row.nomorInvoice;
    setBankAccountDrafts((drafts) => ({ ...drafts, [key]: value }));
  };

  const saveBankAccount = async (row: any) => {
    if (!row.vendorId) {
      alert('Vendor tidak ditemukan untuk baris ini.');
      return;
    }

    const bankAccount = getBankAccountDraft(row).trim();
    setSavingBankAccount((state) => ({ ...state, [row.vendorId]: true }));

    try {
      const res = await fetch('/api/vendors/bank-account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: row.vendorId,
          bankAccount,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || 'Gagal update nomor rekening');
      }

      const savedBankAccount = json.data?.bankAccount || '';
      setCompanyGroups((groups) =>
        groups.map((cg: any) => ({
          ...cg,
          vendorGroups: cg.vendorGroups.map((vg: any) => ({
            ...vg,
            rows: vg.rows.map((rekapRow: any) =>
              rekapRow.vendorId === row.vendorId
                ? { ...rekapRow, nomorRekening: savedBankAccount || '-' }
                : rekapRow
            ),
          })),
        }))
      );
      setBankAccountDrafts((drafts) => ({ ...drafts, [row.vendorId]: savedBankAccount }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal update nomor rekening');
    } finally {
      setSavingBankAccount((state) => ({ ...state, [row.vendorId]: false }));
    }
  };

  // Priority badge renderer
  const renderPriorityBadge = (score: number) => {
    if (score >= 80) {
      return (
        <span className="badge" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <Shield size={10} /> Urgent
        </span>
      );
    } else if (score >= 50) {
      return (
        <span className="badge" style={{ background: '#fefce8', color: '#d97706', border: '1px solid #fde68a', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <Clock size={10} /> High
        </span>
      );
    }
    return (
      <span className="badge" style={{ background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <CheckCircle2 size={10} /> Normal
      </span>
    );
  };

  if (selectedIds.size === 0) {
    return (
      <div>
        <Sidebar />
        <main className="main-content">
          <div className="page-header">
            <h2>Rekap Anggaran</h2>
            <p>Rekap pembayaran berdasarkan PI yang dipilih</p>
          </div>
          <div style={{ padding: '0 32px' }}>
            <div className="glass-card" style={{ padding: 60, textAlign: 'center' }}>
              <AlertTriangle size={48} color="#d97706" style={{ margin: '0 auto 16px' }} />
              <h3 style={{ color: '#374151', marginBottom: 8 }}>Belum ada PI yang dipilih</h3>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
                Silakan kembali ke Modal Anggaran untuk memilih PI yang akan dibayar.
              </p>
              <Link href="/" className="btn btn-primary">
                <ArrowLeft size={16} />
                Kembali ke Modal Anggaran
              </Link>
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
            <h2>Rekap Anggaran</h2>
            <p>{selectedRows.length} PI dipilih • Total: {formatRupiah(grandTotal)}</p>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/" className="btn btn-secondary">
              <ArrowLeft size={16} />
              Modal Anggaran
            </Link>
            <button className="btn btn-primary" onClick={searchInvoices} disabled={invoiceLoading}>
              {invoiceLoading ? <Loader2 size={16} className="pulse" /> : <FileSearch size={16} />}
              {invoiceLoading ? 'Mencari...' : 'Cari Invoice di Drive'}
            </button>
            <button
              className="btn"
              style={{ background: 'rgba(240, 253, 250, 0.7)', color: '#0f766e', border: '1px solid rgba(153, 246, 228, 0.5)', backdropFilter: 'blur(8px)' }}
              onClick={validateAllAI}
              disabled={aiAllLoading || companyGroups.length === 0}
            >
              {aiAllLoading ? <Loader2 size={16} className="pulse" /> : <Bot size={16} />}
              {aiAllLoading ? (aiProgress || 'AI Sedang Bekerja...') : '🤖 Jalankan AI Check Semua'}
            </button>
            <button className="btn btn-secondary" onClick={downloadPDF} disabled={pdfLoading || companyGroups.length === 0}>
              {pdfLoading ? <Loader2 size={16} className="pulse" /> : <Download size={16} />}
              {pdfLoading ? 'Generating...' : 'Download PDF'}
            </button>
            {invoiceSearched && (
              <Link href="/email" className="btn btn-success" id="next-email-btn">
                Buat Email
                <ArrowRight size={16} />
              </Link>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '0 32px 32px' }}>
          {loading ? (
             <div className="glass-card" style={{ padding: 60, textAlign: 'center' }}>
               <div className="spinner" style={{ margin: '0 auto 16px' }} />
               <p style={{ color: '#6b7280', fontSize: 14 }}>Generating rekap...</p>
             </div>
          ) : (
            <div ref={tableRef}>
              {companyGroups.map((compGroup, compIndex) => (
                <div key={compIndex} style={{ marginBottom: 40, background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(16px)', borderRadius: 20, boxShadow: '0 8px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.35)', overflow: 'hidden' }}>
                  {/* Company Header */}
                  <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg, #0f766e, #0d9488)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '20px 20px 0 0' }}>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>🏛️ {compGroup.companyName}</h3>
                    <div style={{ fontWeight: 600 }}>Total PT: {formatRupiah(compGroup.subtotalCompany)}</div>
                  </div>
                  
                  <div className="table-wrapper" style={{ padding: 0, overflowX: 'auto' }}>
                    <table className="data-table" style={{ fontSize: 11, border: 'none', minWidth: 1800 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 30, textAlign: 'center' }}>No</th>
                          <th style={{ minWidth: 220 }}>Nama Vendor</th>
                          <th style={{ minWidth: 100 }}>Nomor Invoice</th>
                          <th style={{ minWidth: 80 }}>Tgl. Faktur</th>
                          <th style={{ minWidth: 100 }}>Nama Rekening</th>
                          <th style={{ minWidth: 100 }}>Nomor Rekening</th>
                          <th style={{ minWidth: 100, textAlign: 'right' }}>Total Rencana Bayar</th>
                          <th style={{ minWidth: 90, textAlign: 'right' }}>Hutang</th>
                          <th style={{ minWidth: 160 }}>Nama Barang</th>
                          <th style={{ minWidth: 200 }}>Keterangan</th>
                          <th style={{ minWidth: 50, textAlign: 'right' }}>Qty PI</th>
                          <th style={{ minWidth: 50, textAlign: 'right' }}>Qty PS</th>
                          <th style={{ minWidth: 80, textAlign: 'right' }}>Harga PI</th>
                          <th style={{ minWidth: 80, textAlign: 'right' }}>Harga PS</th>
                          <th style={{ minWidth: 80, textAlign: 'right' }}>Total</th>
                          <th style={{ minWidth: 80 }}>Lampiran</th>
                          <th style={{ minWidth: 180 }}>Status Dok.</th>
                          <th style={{ minWidth: 70 }}>Prioritas</th>
                          <th style={{ minWidth: 280 }}>Rekomendasi</th>
                          <th style={{ minWidth: 120 }}>Referensi Harga</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compGroup.vendorGroups.map((group: any, gIndex: number) => {
                          const totalVendorItemRows = countTotalItemRows(group);
                          let isFirstVendorRow = true;

                          return group.rows.map((row: any, rIndex: number) => {
                            const itemCount = Math.max(row.items.length, 1);

                            return row.items.map((item: any, iIndex: number) => {
                              const isFirstItemOfInvoice = iIndex === 0;
                              const isFirstOfVendor = isFirstVendorRow && isFirstItemOfInvoice;
                              if (isFirstOfVendor) isFirstVendorRow = false;

                              const statusArr = (item.statusOcr || 'pending').split(', ').map((s: string) => s.trim());
                              const isDiscrepancy = statusArr.includes('discrepancy') || statusArr.includes('Selisih') || statusArr.includes('Tidak Valid') || statusArr.includes('Rekening Tidak Valid');

                              return (
                                <tr
                                  key={`${compIndex}-${gIndex}-${rIndex}-${iIndex}`}
                                  style={{
                                    borderBottom: iIndex === itemCount - 1 ? '1px solid #d1d5db' : '1px solid #f3f4f6',
                                    background: isDiscrepancy ? '#fef2f2' : undefined,
                                  }}
                                >
                                  {/* Vendor columns */}
                                  {isFirstOfVendor && (
                                    <>
                                      <td rowSpan={totalVendorItemRows} style={{ fontWeight: 700, textAlign: 'center', verticalAlign: 'top', background: '#f8fafc', borderRight: '1px solid #e5e7eb' }}>
                                        {gIndex + 1}
                                      </td>
                                      <td rowSpan={totalVendorItemRows} style={{ fontWeight: 600, verticalAlign: 'top', background: '#f8fafc', borderRight: '1px solid #e5e7eb', fontSize: 12 }}>
                                        {group.vendorName}
                                      </td>
                                    </>
                                  )}

                                  {/* Invoice columns */}
                                  {isFirstItemOfInvoice && (
                                    <>
                                      <td rowSpan={itemCount} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#0f766e', fontWeight: 600, verticalAlign: 'top' }}>
                                        {row.nomorInvoice}
                                      </td>
                                      <td rowSpan={itemCount} style={{ verticalAlign: 'top', fontSize: 11 }}>
                                        {row.tglFaktur}
                                      </td>
                                      <td rowSpan={itemCount} style={{ verticalAlign: 'top', fontSize: 11 }}>
                                        {row.namaRekening || '-'}
                                      </td>
                                      <td rowSpan={itemCount} style={{ verticalAlign: 'top', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 150 }}>
                                          <input
                                            type="text"
                                            value={getBankAccountDraft(row)}
                                            onChange={(event) => updateBankAccountDraft(row, event.target.value)}
                                            onKeyDown={(event) => {
                                              if (event.key === 'Enter') {
                                                event.preventDefault();
                                                saveBankAccount(row);
                                              }
                                            }}
                                            placeholder="Isi no. rekening"
                                            style={{
                                              width: 110,
                                              border: '1px solid #cbd5e1',
                                              borderRadius: 6,
                                              padding: '5px 7px',
                                              fontSize: 11,
                                              fontFamily: 'var(--font-mono)',
                                              color: '#0f172a',
                                              background: 'white',
                                              outline: 'none',
                                            }}
                                          />
                                          <button
                                            type="button"
                                            data-html2canvas-ignore="true"
                                            onClick={() => saveBankAccount(row)}
                                            disabled={savingBankAccount[row.vendorId]}
                                            style={{
                                              border: '1px solid #99f6e4',
                                              borderRadius: 6,
                                              background: savingBankAccount[row.vendorId] ? '#f1f5f9' : '#f0fdfa',
                                              color: '#0f766e',
                                              padding: '5px 8px',
                                              fontSize: 10,
                                              fontWeight: 700,
                                              cursor: savingBankAccount[row.vendorId] ? 'not-allowed' : 'pointer',
                                              whiteSpace: 'nowrap',
                                            }}
                                          >
                                            {savingBankAccount[row.vendorId] ? '...' : 'Simpan'}
                                          </button>
                                        </div>
                                      </td>
                                      <td rowSpan={itemCount} style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, verticalAlign: 'top', fontSize: 11 }}>
                                        {formatRupiah(row.totalRencanaBayar)}
                                      </td>
                                      <td rowSpan={itemCount} style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, verticalAlign: 'top', fontSize: 11, color: '#dc2626' }}>
                                        {formatRupiah(row.hutang || 0)}
                                      </td>
                                    </>
                                  )}

                                  {/* Item columns */}
                                  <td style={{ fontSize: 11, fontWeight: isDiscrepancy ? 700 : 400, color: isDiscrepancy ? '#dc2626' : undefined }}>
                                    {item.namaBarang}
                                  </td>
                                  <td style={{ fontSize: 11, color: '#6b7280' }}>
                                    {item.keterangan || '-'}
                                  </td>
                                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                                    {item.qtyPI > 0 ? formatNumber(item.qtyPI) : '-'}
                                  </td>
                                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                                    {item.qtyPS > 0 ? formatNumber(item.qtyPS) : '-'}
                                  </td>
                                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: isDiscrepancy ? 700 : 400, color: isDiscrepancy ? '#dc2626' : undefined }}>
                                    {item.hargaPI > 0 ? formatRupiah(item.hargaPI) : '-'}
                                  </td>
                                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                                    {item.hargaPS > 0 ? formatRupiah(item.hargaPS) : '-'}
                                  </td>
                                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
                                    {formatRupiah((item.qtyPI || 0) * (item.hargaPI || 0))}
                                  </td>

                                  {/* Lampiran - link to Google Drive */}
                                  {isFirstItemOfInvoice && (
                                    <td rowSpan={itemCount} style={{ verticalAlign: 'top', textAlign: 'center' }}>
                                      {row.invoiceLinks && row.invoiceLinks.length > 0 ? (
                                        row.invoiceLinks.map((file: InvoiceFile, fIdx: number) => (
                                          <a
                                            key={fIdx}
                                            href={file.webViewLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#0f766e', fontSize: 10, textDecoration: 'underline', marginBottom: 2 }}
                                          >
                                            <FileText size={10} />
                                            {file.name.length > 15 ? file.name.slice(0, 15) + '...' : file.name}
                                          </a>
                                        ))
                                      ) : invoiceSearched ? (
                                        <span style={{ color: '#d97706', fontSize: 10 }}>
                                          <AlertTriangle size={10} /> Tidak ada
                                        </span>
                                      ) : (
                                        <span style={{ color: '#9ca3af', fontSize: 10 }}>-</span>
                                      )}
                                    </td>
                                  )}

                                  {/* Status Dok */}
                                  <td style={{ textAlign: 'center', fontSize: 11 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
                                        {statusArr.map((st: string, sIdx: number) => {
                                          if (st === 'Valid' || st === 'match') {
                                            return <span key={sIdx} className="badge on-time"><CheckCircle2 size={12}/> Valid</span>;
                                          } else if (st === 'Rekening Tidak Valid') {
                                            return (
                                              <span key={sIdx} className="badge" style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', cursor: 'pointer' }} onClick={() => setShowDiscrepancyModal(item.ocrReason || 'Nomor rekening berbeda atau tidak tersedia.')}>
                                                <AlertCircle size={12}/> Rek. Tidak Valid <Info size={10} style={{ opacity: 0.8 }} />
                                              </span>
                                            );
                                          } else if (st === 'Selisih' || st === 'Tidak Valid' || st === 'discrepancy') {
                                            return (
                                              <span key={sIdx} className="badge late" style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setShowDiscrepancyModal(item.ocrReason || 'Ketidaksesuaian terdeteksi.')}>
                                                <AlertTriangle size={12}/> {st === 'discrepancy' ? 'Selisih' : st} <Info size={10} style={{ opacity: 0.8 }} />
                                              </span>
                                            );
                                          } else {
                                            return <span key={sIdx} className="badge" style={{ color: '#6b7280', background: '#f3f4f6' }}>Pending</span>;
                                          }
                                        })}
                                      </div>
                                      
                                      {/* Tampilkan reason 1x di bawah gabungan badge */}
                                      {isDiscrepancy && item.ocrReason && (
                                        <div style={{ fontSize: 9, color: '#dc2626', marginTop: 2, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.ocrReason}>
                                          {item.ocrReason.substring(0, 40)}
                                        </div>
                                      )}
                                    </div>
                                  </td>

                                  {/* Prioritas */}
                                  <td style={{ textAlign: 'center', fontSize: 10 }}>
                                    {renderPriorityBadge(item.priorityScore || 0)}
                                  </td>

                                  {/* Rekomendasi */}
                                  <td style={{ textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                                      {item.rekomendasi && item.rekomendasi !== '' && (
                                        <div style={{ fontSize: 9, color: '#6b7280', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.rekomendasi}>
                                          {item.rekomendasi.split('|')[0]?.trim()?.substring(0, 40)}
                                        </div>
                                      )}
                                      {item.marketPrice > 0 && (
                                        <div style={{ fontSize: 9, color: '#059669', fontWeight: 600 }}>
                                          Pasar: {formatRupiah(item.marketPrice)}
                                        </div>
                                      )}
                                      {item.namaBarang && item.namaBarang !== '-' ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openHistoryModal(item.namaBarang, item.hargaPI);
                                          }}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            padding: '3px 8px',
                                            borderRadius: 6,
                                            border: '1px solid #99f6e4',
                                            background: '#f0fdfa',
                                            color: '#0f766e',
                                            fontSize: 10,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 150ms ease',
                                          }}
                                          onMouseEnter={(e) => {
                                            (e.target as HTMLElement).style.background = '#ccfbf1';
                                            (e.target as HTMLElement).style.boxShadow = '0 2px 6px rgba(15,118,110,0.2)';
                                          }}
                                          onMouseLeave={(e) => {
                                            (e.target as HTMLElement).style.background = '#f0fdfa';
                                            (e.target as HTMLElement).style.boxShadow = 'none';
                                          }}
                                        >
                                          <Info size={10} />
                                          Detail
                                        </button>
                                      ) : (
                                        <span style={{ color: '#9ca3af', fontSize: 10 }}>-</span>
                                      )}
                                    </div>
                                  </td>

                                  {/* Referensi Harga (Static search links) */}
                                  <td style={{ fontSize: 10, verticalAlign: 'middle' }}>
                                    {item.namaBarang && item.namaBarang !== '-' ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <a
                                          href={`https://www.tokopedia.com/search?q=${encodeURIComponent(item.namaBarang)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          style={{ color: '#059669', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
                                        >
                                          <ExternalLink size={10} /> Tokopedia
                                        </a>
                                        <a
                                          href={`https://shopee.co.id/search?keyword=${encodeURIComponent(item.namaBarang)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          style={{ color: '#ea580c', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
                                        >
                                          <ExternalLink size={10} /> Shopee
                                        </a>
                                      </div>
                                    ) : (
                                      <span style={{ color: '#9ca3af' }}>-</span>
                                    )}
                                  </td>

                                </tr>
                              );
                            });
                          });
                        })}
                        
                        <tr style={{ background: 'rgba(240, 253, 250, 0.6)', fontWeight: 600 }}>
                           <td colSpan={20} style={{ textAlign: 'right', padding: '12px 20px', fontSize: 13, color: '#0f766e' }}>
                             Subtotal {compGroup.companyName}: {formatRupiah(compGroup.subtotalCompany)}
                           </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Item History Modal */}
      {showHistoryModal && (
        <ItemHistoryModal
          namaBarang={selectedItemName}
          currentPrice={selectedItemPrice}
          onClose={() => setShowHistoryModal(false)}
        />
      )}

      {/* Discrepancy Note Modal */}
      {showDiscrepancyModal && (
        <div className="modal-overlay" onClick={() => setShowDiscrepancyModal(null)}>
          <div className="modal-content" style={{ maxWidth: 450, padding: '24px 28px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <AlertTriangle size={24} color="#dc2626" />
              <h3 style={{ margin: 0, color: '#111827', fontSize: 18, fontWeight: 700 }}>Detail Selisih Dokumen</h3>
            </div>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '16px', borderRadius: '8px', marginBottom: 24 }}>
              <p style={{ color: '#b91c1c', fontSize: 14, lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
                {showDiscrepancyModal}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <button className="btn btn-secondary" onClick={() => setShowDiscrepancyModal(null)}>
                Tutup Catatan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

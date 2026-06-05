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
  Pencil,
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
  const [bankInfoModalRow, setBankInfoModalRow] = useState<any | null>(null);
  const [bankInfoDraft, setBankInfoDraft] = useState({ accountName: '', bankAccount: '' });
  const [savingBankInfo, setSavingBankInfo] = useState(false);
  const [manualCheckItem, setManualCheckItem] = useState<any | null>(null);
  const [manualDraft, setManualDraft] = useState({
    isValid: false,
    selectedStatuses: [] as string[],
    manualReason: '',
  });
  const [savingManualCheck, setSavingManualCheck] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  // Modal state for Item History
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedItemName, setSelectedItemName] = useState('');
  const [selectedItemPrice, setSelectedItemPrice] = useState<number | undefined>(undefined);

  // Modal state for AI Discrepancy Note
  const [showDiscrepancyModal, setShowDiscrepancyModal] = useState<string | null>(null);

  // Track if initial rekap has been loaded
  const initialLoadDone = useRef(false);

  const manualProblemStatuses = ['Rekening Tidak Valid', 'Selisih', 'Tidak Valid'];

  const splitStatus = (status?: string | null) =>
    (status || 'pending').split(', ').map((s: string) => s.trim()).filter(Boolean);

  const hasProblemStatus = (status?: string | null) => {
    const statuses = splitStatus(status);
    return statuses.some((st) => ['discrepancy', 'Selisih', 'Tidak Valid', 'Rekening Tidak Valid'].includes(st));
  };

  const getManualDetailText = (item: any) => {
    const aiReason = item.ocrReason || 'Tidak ada catatan AI.';
    const manualReason = item.manualReason || 'Tidak ada catatan manual.';
    return `Catatan AI:\n${aiReason}\n\nCatatan revisi manual:\n${manualReason}`;
  };

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
      const allItems: { itemId: string; piNumber: string; driveFileId?: string; driveFileName?: string }[] = [];
      companyGroups.forEach((cg: any) => {
        cg.vendorGroups.forEach((vg: any) => {
          vg.rows.forEach((row: any) => {
            const driveFile = row.invoiceLinks?.[0];
            const driveFileId = driveFile?.id;
            const driveFileName = driveFile?.name;
            row.items.forEach((item: any) => {
              allItems.push({ itemId: item.id, piNumber: row.nomorInvoice, driveFileId, driveFileName });
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
                        manualStatusOcr: null,
                        manualReason: '',
                        manualCheckedAt: null,
                        finalStatusOcr: result.status,
                        finalReason: result.ocrReason || '',
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

  const openBankInfoModal = (row: any) => {
    setBankInfoModalRow(row);
    setBankInfoDraft({
      accountName: row.namaRekening && row.namaRekening !== '-' ? row.namaRekening : '',
      bankAccount: row.nomorRekening && row.nomorRekening !== '-' ? row.nomorRekening : '',
    });
  };

  const saveBankInfo = async () => {
    if (!bankInfoModalRow?.invoiceId) {
      alert('Invoice tidak ditemukan untuk baris ini.');
      return;
    }

    const accountName = bankInfoDraft.accountName.trim();
    const bankAccount = bankInfoDraft.bankAccount.trim();
    setSavingBankInfo(true);

    try {
      const res = await fetch('/api/invoice/bank-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: bankInfoModalRow.invoiceId,
          accountName,
          bankAccount,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || 'Gagal update data rekening');
      }

      const savedAccountName = json.data?.namaRekening || '';
      const savedBankAccount = json.data?.nomorRekening || '';
      setCompanyGroups((groups) =>
        groups.map((cg: any) => ({
          ...cg,
          vendorGroups: cg.vendorGroups.map((vg: any) => ({
            ...vg,
            rows: vg.rows.map((rekapRow: any) =>
              rekapRow.invoiceId === bankInfoModalRow.invoiceId
                ? {
                    ...rekapRow,
                    namaRekening: savedAccountName || '-',
                    nomorRekening: savedBankAccount || '-',
                  }
                : rekapRow
            ),
          })),
        }))
      );
      setBankInfoModalRow(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal update data rekening');
    } finally {
      setSavingBankInfo(false);
    }
  };

  const openManualCheckModal = (item: any) => {
    const manualStatuses = splitStatus(item.manualStatusOcr);
    setManualCheckItem(item);
    setManualDraft({
      isValid: true,
      selectedStatuses: manualStatuses.filter((status) => manualProblemStatuses.includes(status)),
      manualReason: item.manualReason || '',
    });
  };

  const updateItemManualCheck = (itemId: string, data: any) => {
    setCompanyGroups((groups) =>
      groups.map((cg: any) => ({
        ...cg,
        vendorGroups: cg.vendorGroups.map((vg: any) => ({
          ...vg,
          rows: vg.rows.map((row: any) => ({
            ...row,
            items: row.items.map((item: any) =>
              item.id === itemId
                ? {
                    ...item,
                    manualStatusOcr: data.manualStatusOcr || null,
                    manualReason: data.manualReason || '',
                    manualCheckedAt: data.manualCheckedAt || null,
                    finalStatusOcr: data.manualStatusOcr || data.manualCheckedAt ? 'Valid' : (data.finalStatusOcr || data.statusOcr || item.statusOcr),
                    finalReason: data.finalReason || data.ocrReason || item.ocrReason || '',
                  }
                : item
            ),
          })),
        })),
      }))
    );
  };

  const toggleManualStatus = (status: string) => {
    setManualDraft((draft) => {
      const exists = draft.selectedStatuses.includes(status);
      return {
        ...draft,
        isValid: true,
        selectedStatuses: exists
          ? draft.selectedStatuses.filter((value) => value !== status)
          : [...draft.selectedStatuses, status],
      };
    });
  };

  const markManualValid = () => {
    setManualDraft((draft) => ({ ...draft, isValid: true, selectedStatuses: [] }));
  };

  const saveManualCheck = async () => {
    if (!manualCheckItem?.id) return;

    setSavingManualCheck(true);
    try {
      const res = await fetch('/api/invoice-item/manual-check', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: manualCheckItem.id,
          manualStatusOcr: 'Valid',
          resolvedStatuses: manualDraft.selectedStatuses,
          manualReason: manualDraft.manualReason,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || 'Gagal menyimpan checking manual');
      }

      updateItemManualCheck(manualCheckItem.id, json.data);
      setManualCheckItem(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal menyimpan checking manual');
    } finally {
      setSavingManualCheck(false);
    }
  };

  const resetManualCheck = async () => {
    if (!manualCheckItem?.id) return;

    setSavingManualCheck(true);
    try {
      const res = await fetch('/api/invoice-item/manual-check', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: manualCheckItem.id, reset: true }),
      });
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || 'Gagal reset checking manual');
      }

      updateItemManualCheck(manualCheckItem.id, json.data);
      setManualCheckItem(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal reset checking manual');
    } finally {
      setSavingManualCheck(false);
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
                    <table className="data-table" style={{ fontSize: 11, border: 'none', minWidth: 1940 }}>
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
                          <th style={{ minWidth: 130 }}>Checking Manual</th>
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

                              const hasManualCheck = Boolean(item.manualStatusOcr || item.manualCheckedAt);
                              const finalStatus = hasManualCheck ? 'Valid' : (item.finalStatusOcr || item.statusOcr);
                              const finalReason = item.finalReason || item.manualReason || item.ocrReason || '';
                              const statusArr = splitStatus(finalStatus);
                              const manualStatusArr = hasManualCheck ? ['Valid'] : splitStatus(item.manualStatusOcr);
                              const isDiscrepancy = hasProblemStatus(finalStatus);

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
                                          <span>{row.nomorRekening || '-'}</span>
                                          <button
                                            type="button"
                                            data-html2canvas-ignore="true"
                                            onClick={() => openBankInfoModal(row)}
                                            style={{
                                              border: '1px solid #99f6e4',
                                              borderRadius: 6,
                                              background: '#f0fdfa',
                                              color: '#0f766e',
                                              padding: 5,
                                              fontSize: 10,
                                              fontWeight: 700,
                                              cursor: 'pointer',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                            }}
                                            title="Edit nama dan nomor rekening"
                                          >
                                            <Pencil size={12} />
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
                                            return (
                                              <button
                                                key={sIdx}
                                                type="button"
                                                className="badge on-time"
                                                onClick={() => hasManualCheck && setShowDiscrepancyModal(getManualDetailText(item))}
                                                style={{
                                                  display: 'inline-flex',
                                                  alignItems: 'center',
                                                  gap: 4,
                                                  border: 'none',
                                                  cursor: hasManualCheck ? 'pointer' : 'default',
                                                }}
                                              >
                                                <CheckCircle2 size={12}/> Valid
                                                {hasManualCheck && <Info size={10} style={{ opacity: 0.8 }} />}
                                              </button>
                                            );
                                          } else if (st === 'Rekening Tidak Valid') {
                                            return (
                                              <span key={sIdx} className="badge" style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', cursor: 'pointer' }} onClick={() => setShowDiscrepancyModal(finalReason || 'Nomor rekening berbeda atau tidak tersedia.')}>
                                                <AlertCircle size={12}/> Rek. Tidak Valid <Info size={10} style={{ opacity: 0.8 }} />
                                              </span>
                                            );
                                          } else if (st === 'Selisih' || st === 'Tidak Valid' || st === 'discrepancy') {
                                            return (
                                              <span key={sIdx} className="badge late" style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setShowDiscrepancyModal(finalReason || 'Ketidaksesuaian terdeteksi.')}>
                                                <AlertTriangle size={12}/> {st === 'discrepancy' ? 'Selisih' : st} <Info size={10} style={{ opacity: 0.8 }} />
                                              </span>
                                            );
                                          } else {
                                            return (
                                              <button
                                                key={sIdx}
                                                type="button"
                                                className="badge"
                                                onClick={() => finalReason && setShowDiscrepancyModal(finalReason)}
                                                style={{
                                                  color: '#475569',
                                                  background: '#f8fafc',
                                                  border: '1px solid #e2e8f0',
                                                  display: 'inline-flex',
                                                  alignItems: 'center',
                                                  gap: 4,
                                                  cursor: finalReason ? 'pointer' : 'default',
                                                }}
                                              >
                                                <Clock size={12} /> Pending
                                                {finalReason && <Info size={10} style={{ opacity: 0.8 }} />}
                                              </button>
                                            );
                                          }
                                        })}
                                      </div>

                                      {hasManualCheck && (
                                        <span style={{ fontSize: 9, color: '#1d4ed8', fontWeight: 800 }}>
                                          Manual
                                        </span>
                                      )}
                                      
                                      {/* Tampilkan reason 1x di bawah gabungan badge */}
                                      {isDiscrepancy && finalReason && (
                                        <div style={{ fontSize: 9, color: '#dc2626', marginTop: 2, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={finalReason}>
                                          {finalReason.substring(0, 40)}
                                        </div>
                                      )}
                                    </div>
                                  </td>

                                  {/* Checking Manual */}
                                  <td style={{ textAlign: 'center', fontSize: 11 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                                      {hasManualCheck ? (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
                                          {manualStatusArr.map((st: string, sIdx: number) => (
                                            <button
                                              key={sIdx}
                                              type="button"
                                              className={st === 'Valid' ? 'badge on-time' : 'badge'}
                                              onClick={() => hasManualCheck && setShowDiscrepancyModal(getManualDetailText(item))}
                                              style={st === 'Valid'
                                                ? { fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', cursor: 'pointer' }
                                                : { fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}
                                            >
                                              {st === 'Valid' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                                              {st === 'Rekening Tidak Valid' ? 'Rek. Tidak Valid' : st}
                                              {st === 'Valid' && <Info size={10} style={{ opacity: 0.8 }} />}
                                            </button>
                                          ))}
                                        </div>
                                      ) : (
                                        <span style={{ color: '#9ca3af', fontSize: 10 }}>Belum dicek</span>
                                      )}

                                      {item.manualReason && (
                                        <div style={{ fontSize: 9, color: '#2563eb', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.manualReason}>
                                          {item.manualReason.substring(0, 36)}
                                        </div>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => openManualCheckModal(item)}
                                        title="Edit checking manual"
                                        style={{
                                          width: 28,
                                          height: 28,
                                          borderRadius: 8,
                                          border: '1px solid #bfdbfe',
                                          background: hasManualCheck ? '#eff6ff' : '#ffffff',
                                          color: '#1d4ed8',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        <Pencil size={13} />
                                      </button>
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
                           <td colSpan={21} style={{ textAlign: 'right', padding: '12px 20px', fontSize: 13, color: '#0f766e' }}>
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

      {/* Bank Info Edit Modal */}
      {bankInfoModalRow && (
        <div className="modal-overlay" onClick={() => !savingBankInfo && setBankInfoModalRow(null)}>
          <div className="modal-content" style={{ maxWidth: 460, padding: '24px 28px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <Pencil size={22} color="#0f766e" />
              <div>
                <h3 style={{ margin: 0, color: '#111827', fontSize: 18, fontWeight: 700 }}>Edit Rekening Invoice</h3>
                <p style={{ margin: '3px 0 0', color: '#64748b', fontSize: 12 }}>{bankInfoModalRow.nomorInvoice}</p>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Nama Rekening
                <input
                  type="text"
                  value={bankInfoDraft.accountName}
                  onChange={(event) => setBankInfoDraft((draft) => ({ ...draft, accountName: event.target.value }))}
                  placeholder="Contoh: BCA PT Sukanda Djaya"
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 13,
                    color: '#0f172a',
                    outline: 'none',
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Nomor Rekening
                <input
                  type="text"
                  value={bankInfoDraft.bankAccount}
                  onChange={(event) => setBankInfoDraft((draft) => ({ ...draft, bankAccount: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveBankInfo();
                    }
                  }}
                  placeholder="Isi nomor rekening"
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 13,
                    fontFamily: 'var(--font-mono)',
                    color: '#0f172a',
                    outline: 'none',
                  }}
                />
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button className="btn btn-secondary" onClick={() => setBankInfoModalRow(null)} disabled={savingBankInfo}>
                Batal
              </button>
              <button className="btn btn-primary" onClick={saveBankInfo} disabled={savingBankInfo}>
                {savingBankInfo ? <Loader2 size={16} className="pulse" /> : <CheckCircle2 size={16} />}
                {savingBankInfo ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Checking Modal */}
      {manualCheckItem && (
        <div className="modal-overlay" onClick={() => !savingManualCheck && setManualCheckItem(null)}>
          <div className="modal-content" style={{ maxWidth: 560, padding: '24px 28px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <Pencil size={22} color="#1d4ed8" />
              <div>
                <h3 style={{ margin: 0, color: '#111827', fontSize: 18, fontWeight: 700 }}>Checking Manual</h3>
                <p style={{ margin: '3px 0 0', color: '#64748b', fontSize: 12 }}>{manualCheckItem.namaBarang}</p>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#991b1b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
                  Catatan AI
                </div>
                <p style={{ margin: 0, color: '#7f1d1d', fontSize: 13, lineHeight: 1.55 }}>
                  {manualCheckItem.ocrReason || 'AI belum memberikan catatan masalah untuk item ini.'}
                </p>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#334155' }}>Status Manual</div>
                <button
                  type="button"
                  onClick={markManualValid}
                  style={{
                    border: manualDraft.isValid ? '1px solid #86efac' : '1px solid #cbd5e1',
                    background: manualDraft.isValid ? '#f0fdf4' : '#ffffff',
                    color: manualDraft.isValid ? '#166534' : '#334155',
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: 'pointer',
                  }}
                >
                  <CheckCircle2 size={16} />
                  Tandai Valid
                </button>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                  {manualProblemStatuses.map((status) => {
                    const checked = manualDraft.selectedStatuses.includes(status);
                    return (
                      <label
                        key={status}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          border: checked ? '1px solid #93c5fd' : '1px solid #cbd5e1',
                          background: checked ? '#eff6ff' : '#ffffff',
                          color: checked ? '#1d4ed8' : '#334155',
                          borderRadius: 10,
                          padding: '10px 12px',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleManualStatus(status)}
                        />
                        {status}
                      </label>
                    );
                  })}
                </div>
              </div>

              <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 800, color: '#334155' }}>
                Catatan Revisi Manual
                <textarea
                  value={manualDraft.manualReason}
                  onChange={(event) => setManualDraft((draft) => ({ ...draft, manualReason: event.target.value }))}
                  placeholder="Contoh: Rekening sudah dikonfirmasi ke vendor, nominal sesuai revisi manual."
                  rows={4}
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 13,
                    color: '#0f172a',
                    resize: 'vertical',
                    outline: 'none',
                  }}
                />
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={resetManualCheck} disabled={savingManualCheck || !manualCheckItem.manualStatusOcr}>
                Reset Manual
              </button>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => setManualCheckItem(null)} disabled={savingManualCheck}>
                  Batal
                </button>
                <button className="btn btn-primary" onClick={saveManualCheck} disabled={savingManualCheck}>
                  {savingManualCheck ? <Loader2 size={16} className="pulse" /> : <CheckCircle2 size={16} />}
                  {savingManualCheck ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Discrepancy Note Modal */}
      {showDiscrepancyModal && (
        <div className="modal-overlay" onClick={() => setShowDiscrepancyModal(null)}>
          <div className="modal-content" style={{ maxWidth: 450, padding: '24px 28px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <AlertTriangle size={24} color="#dc2626" />
              <h3 style={{ margin: 0, color: '#111827', fontSize: 18, fontWeight: 700 }}>Detail Status Dokumen</h3>
            </div>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '16px', borderRadius: '8px', marginBottom: 24 }}>
              <p style={{ color: '#b91c1c', fontSize: 14, lineHeight: 1.6, margin: 0, fontWeight: 500, whiteSpace: 'pre-line' }}>
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

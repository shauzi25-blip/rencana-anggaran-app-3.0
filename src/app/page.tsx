'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import PITable from '@/components/PITable';
import DashboardSummary from '@/components/DashboardSummary';
import BulkUploadModal from '@/components/BulkUploadModal';
import { useSelectedPIStore } from '@/store/useSelectedPI';
import { calculateSummary } from '@/lib/transform';
import type { RencanaAnggaranRow } from '@/types/finance';
import { RefreshCw, ArrowRight, AlertCircle, Upload } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const [data, setData] = useState<RencanaAnggaranRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const { selectedIds, setAllRows } = useSelectedPIStore();

  const fetchData = useCallback(async (options?: { sync?: boolean }) => {
    setLoading(true);
    setError(null);
    setSyncing(Boolean(options?.sync));
    try {
      const res = await fetch(options?.sync ? '/api/dashboard?sync=true' : '/api/dashboard');
      const contentType = res.headers.get('content-type') || '';
      const json = contentType.includes('application/json') ? await res.json() : null;

      if (!json) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Server mengembalikan response tidak valid (${res.status})`);
      }

      if (!json.success) {
        throw new Error(json.error || 'Failed to fetch data');
      }

      setData(json.data);
      setAllRows(json.data);

      if (json.meta?.syncStarted) {
        setSyncNotice('Sync spreadsheet sedang berjalan di background. Data akan dimuat ulang otomatis.');
        [15000, 45000, 90000].forEach((delay) => {
          window.setTimeout(() => fetchData(), delay);
        });
      } else if (!options?.sync) {
        setSyncNotice(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [setAllRows]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const summary = calculateSummary(data, selectedIds);

  return (
    <div>
      <Sidebar />
      <main className="main-content">
        {/* Page Header */}
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Modal Anggaran</h2>
            <p>Pilih PI yang akan dibayar untuk membentuk Rekap Anggaran</p>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => fetchData({ sync: true })}
              disabled={loading}
              id="refresh-data-btn"
            >
              <RefreshCw size={16} className={loading ? 'pulse' : ''} />
              {syncing ? 'Sync Spreadsheet...' : 'Refresh'}
            </button>
            <button
              className="btn btn-secondary"
              style={{ color: '#0f766e', borderColor: '#99f6e4', background: '#f0fdfa' }}
              onClick={() => setShowBulkUpload(true)}
              disabled={loading}
            >
              <Upload size={16} />
              Upload Bulk PI
            </button>
            {selectedIds.size > 0 && (
              <Link href="/rekap" className="btn btn-primary" id="next-rekap-btn">
                Lanjut ke Rekap
                <ArrowRight size={16} />
              </Link>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '0 32px 32px' }}>
          {/* Summary Cards */}
          <DashboardSummary {...summary} />

          {/* Error State */}
          {error && (
            <div style={{
              padding: '16px 20px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 12,
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <AlertCircle size={20} color="#dc2626" />
              <div>
                <div style={{ fontWeight: 600, color: '#991b1b' }}>Error</div>
                <div style={{ fontSize: 13, color: '#dc2626' }}>{error}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => fetchData()} style={{ marginLeft: 'auto' }}>
                Coba Lagi
              </button>
            </div>
          )}

          {syncNotice && !error && (
            <div style={{
              padding: '14px 18px',
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 12,
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              color: '#1d4ed8',
              fontSize: 13,
              fontWeight: 600,
            }}>
              <RefreshCw size={18} className="pulse" />
              {syncNotice}
            </div>
          )}

          {/* Loading State */}
          {loading ? (
            <div className="glass-card" style={{ padding: 60, textAlign: 'center' }}>
              <div className="spinner" style={{ margin: '0 auto 16px' }} />
              <p style={{ color: '#6b7280', fontSize: 14 }}>
                {syncing ? 'Sync Google Spreadsheet ke Supabase...' : 'Memuat data dari database...'}
              </p>
            </div>
          ) : (
            /* Data Table */
            <div className="glass-card" style={{ padding: 24, overflow: 'hidden' }}>
              <PITable data={data} />
            </div>
          )}
        </div>
      </main>

      {showBulkUpload && (
        <BulkUploadModal onClose={() => setShowBulkUpload(false)} />
      )}
    </div>
  );
}

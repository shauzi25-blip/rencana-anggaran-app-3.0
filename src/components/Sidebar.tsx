'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BarChart3,
  FileSpreadsheet,
  Mail,
  History,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Package,
  Archive,
} from 'lucide-react';

const navItems = [
  { href: '/', label: 'Modal Anggaran', icon: LayoutDashboard, description: 'Pilih Rekap Invoices' },
  { href: '/dashboard', label: 'Dashboard', icon: BarChart3, description: 'Hutang & harga bahan' },
  { href: '/input', label: 'Input Manual PI', icon: FileSpreadsheet, description: 'Tambah Data Manual' },
  { href: '/rekap', label: 'Rekap Anggaran', icon: FileSpreadsheet, description: 'Lihat rekap pembayaran' },
  { href: '/stock', label: 'Data Stock', icon: Package, description: 'Kelola stok barang' },
  { href: '/email', label: 'Email Approval', icon: Mail, description: 'Generate & kirim email' },
  { href: '/arsip', label: 'Arsip Anggaran', icon: Archive, description: 'PI yang sudah dianggarkan' },
  { href: '/log', label: 'Audit Log', icon: History, description: 'Riwayat proses' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile menu button */}
      <button
        className="btn btn-secondary"
        onClick={() => setMobileOpen(!mobileOpen)}
        style={{
          position: 'fixed',
          top: 16,
          left: 16,
          zIndex: 60,
          display: 'none',
          padding: '8px',
        }}
        id="mobile-menu-btn"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <aside
        className={`sidebar ${mobileOpen ? 'open' : ''}`}
        style={{ width: collapsed ? 72 : 260, transition: 'width 250ms ease' }}
      >
        {/* Brand */}
        <div className="sidebar-brand" style={{ padding: collapsed ? '24px 12px' : undefined }}>
          {!collapsed && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #0f766e, #14b8a6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                }}>
                  📋
                </div>
                <div>
                  <h1 style={{ fontSize: 15 }}>Rencana Anggaran</h1>
                  <p>Central Kitchen</p>
                </div>
              </div>
            </>
          )}
          {collapsed && (
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #0f766e, #14b8a6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              margin: '0 auto',
            }}>
              📋
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '12px 0' }}>
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${isActive ? 'active' : ''}`}
                style={{
                  justifyContent: collapsed ? 'center' : undefined,
                  padding: collapsed ? '14px 0' : undefined,
                }}
                title={collapsed ? item.label : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={20} />
                {!collapsed && (
                  <div>
                    <div>{item.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 1 }}>
                      {item.description}
                    </div>
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Collapse Toggle */}
        <div style={{
          padding: '12px',
          borderTop: '1px solid rgba(229, 231, 235, 0.4)',
        }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="nav-item"
            style={{
              width: '100%',
              border: 'none',
              background: 'none',
              justifyContent: collapsed ? 'center' : undefined,
              padding: collapsed ? '10px 0' : '10px 20px',
            }}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!collapsed && <span style={{ fontSize: 13 }}>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 40,
          }}
        />
      )}
    </>
  );
}

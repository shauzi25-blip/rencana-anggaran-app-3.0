// ============================================================
// Constants & Configuration
// ============================================================

/** Sheet names in Google Spreadsheet */
export const SHEET_NAMES = {
  RAW_PI: 'RAW - PI',
  RAW_PS: 'RAW - PS',
  RAW_PAYABLE: 'RAW - Payable',
  LAPORAN_FAKTUR: 'Laporan Faktur Pembelian',
  LAPORAN_PEMBELIAN: 'Laporan Pembelian Barang',
  STAGING: 'Staging',
  RENCANA_ANGGARAN: 'Rencana Anggaran',
  REKAP_ANGGARAN: 'Rekap Anggaran',
  MASTER_REKENING: 'Master Rekening',
  TRACKING: 'Tracking',
  LOG: 'LOG',
} as const;

/** Column index mappings for RAW - Payable */
export const PAYABLE_COLUMNS = {
  CURRENCY: 0,
  VENDOR_CODE: 1,
  VENDOR_NAME: 2,
  COMPANY: 3,
  WAREHOUSE_CODE: 4,
  WAREHOUSE_NAME: 5,
  PURCHASE_INVOICE_CODE: 6,
  TRANSACTION_AT: 7,
  DUE_AT: 8,
  DUE_IN: 9,
  PAYMENT_STATE: 10,
  PAYMENT_DUE_STATE: 11,
  PAYABLE_AMOUNT: 12,
  PAYMENT_AMOUNT: 13,
  REFUND_AMOUNT: 14,
  WRITEOFF_AMOUNT: 15,
  PAYABLE_DUE: 16,
} as const;

/** Column index mappings for Laporan Faktur Pembelian */
export const FAKTUR_COLUMNS = {
  VENDOR_NAME: 0,
  PURCHASE_INVOICE_CODE: 1,
  TGL_FAKTUR: 2,
  PAYMENT_TERM_NAME: 3,
  DESCRIPTION: 4,
  SUM_ITEM_GRAND_AMOUNT: 5,
  REFERENCE: 6,
  TGL_PEMBELIAN: 7,
  TERHUTANG: 8,
  UMUR_HUTANG: 9,
  ALAMAT_BARIS_1: 10,
} as const;

/** Column index mappings for Master Rekening */
export const REKENING_COLUMNS = {
  NAMA_VENDOR: 0,
  NO_REKENING: 1,
  NAMA_PENERIMA: 2,
  NAMA_BANK: 3,
} as const;

/** Column index mappings for RAW - PI (Purchase Invoice items) */
export const PI_COLUMNS = {
  PURCHASE_INVOICE_CODE: 0,
  SOURCE_DOCUMENT_CODE: 1,
  STATE: 2,
  VENDOR_NAME: 3,
  ITEM_NAME: 4,
  QUANTITY: 5,
  ITEM_PRICE: 6,
  ITEM_GRAND_AMOUNT: 7,
  UNIT_NAME: 8,
  TRANSACTION_AT: 9,
  PURCHASE_AT: 10,
  REFERENCE: 11,
  DESCRIPTION: 12,
  PAYMENT_TERM_NAME: 13,
  SHIP_FROM_NAME: 14,
  SHIP_FROM_PHONE: 15,
  // 16 is empty
  TGL_FAKTUR: 17,
  TGL_PEMBELIAN: 18,
  HELP_NO_PI: 19,
  TGL_RENCANA_BAYAR: 20,
  TOTAL_RENCANA_BAYAR: 21,
  HUTANG: 22,
  UMUR_HUTANG: 23,
  BULAN: 24,
  QTY_PS: 25,
  HARGA_PS: 26,
  NOMOR_REKENING: 27,
  NAMA_REKENING: 28,
} as const;

/** Column index mappings for RAW - PS (Purchase Shipment items) */
export const PS_COLUMNS = {
  CODE: 0,
  SOURCE_DOCUMENT_CODE: 1,
  STATE: 2,
  VENDOR_NAME: 3,
  ITEM_NAME: 4,
  ITEM_QUANTITY: 5,
  ITEM_GRAND_AMOUNT: 6,
  TRANSACTION_AT: 7,
  DELIVERY_AT: 8,
  CREATED_AT: 9,
  UPDATED_AT: 10,
  // 11 is empty
  NO_PI: 12,
  TGL_RENCANA_BAYAR: 13,
  TOTAL_RENCANA_BAYAR: 14,
  NO_REKENING: 15,
  HARGA_SATUAN: 16,
  HUTANG: 17,
  BULAN: 18,
  KETERANGAN: 19,
  HARGA: 20,
} as const;

/** Default settings */
export const DEFAULTS = {
  TO_EMAIL: process.env.DEFAULT_TO_EMAIL || 'shauzi25@gmail.com',
  CC_EMAIL: process.env.DEFAULT_CC_EMAIL || '',
  DIRECTOR_NAME: process.env.DIRECTOR_NAME || 'Pak Hendra',
  APP_NAME: 'Rencana Anggaran - Central Kitchen',
  CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
} as const;

/** Email subject template */
export function getEmailSubject(date: string): string {
  return `[Approval Required] A/P Tracking BCA Pembelian Central Kitchen - ${date}`;
}

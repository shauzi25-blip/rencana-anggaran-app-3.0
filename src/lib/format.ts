// ============================================================
// Format utilities for Rupiah & Indonesian dates
// ============================================================

/**
 * Format number to Indonesian Rupiah
 */
export function toFiniteNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(trimmed.replace(/\s+/g, ''))) {
      const parsed = Number(trimmed.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const normalized = value.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const maybeDecimal = value as { toNumber?: () => number; toString?: () => string };
  if (typeof maybeDecimal.toNumber === 'function') {
    const parsed = maybeDecimal.toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(maybeDecimal.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatRupiah(amount: unknown): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(toFiniteNumber(amount));
}

/**
 * Format number with thousand separators
 */
export function formatNumber(num: unknown): string {
  return new Intl.NumberFormat('id-ID').format(toFiniteNumber(num));
}

/**
 * Parse Indonesian/various date formats to Date object
 */
export function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Handle "2026-03-13 20:02:00 +0700" format
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(dateStr);
  }

  // Handle "MM/DD/YYYY" format
  const mdyMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, month, day, year] = mdyMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  // Handle "DD/MM/YYYY" format
  const dmyMatch = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  return new Date(dateStr);
}

/**
 * Format date to Indonesian format (DD MMM YYYY)
 */
export function formatDateIndonesia(dateStr: string): string {
  const date = parseDate(dateStr);
  if (!date || isNaN(date.getTime())) return dateStr || '-';

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des',
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  return `${day} ${month} ${year}`;
}

/**
 * Format date to full Indonesian format
 */
export function formatDateFull(dateStr: string): string {
  const date = parseDate(dateStr);
  if (!date || isNaN(date.getTime())) return dateStr || '-';

  return date.toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Get today's date in Indonesian format
 */
export function getTodayIndonesia(): string {
  return new Date().toLocaleDateString('id-ID', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Parse potentially scientific-notation number from spreadsheet
 */
export function parseSpreadsheetNumber(value: string | number): number {
  if (typeof value === 'number') return value;
  if (!value || value === '') return 0;

  // Remove thousand separators (comma or dot based on locale)
  const cleaned = String(value).replace(/,/g, '').trim();

  // Handle scientific notation like "1.78E+07"
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Extract date portion from datetime string
 */
export function extractDate(dateStr: string): string {
  if (!dateStr) return '-';
  // From "2026-03-13 20:02:00 +0700" => "2026-03-13"
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  return dateStr;
}

import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import prismaPkg from '@prisma/client';

const { Prisma, PrismaClient } = prismaPkg;

const DEFAULT_PUBLISHED_ID =
  '2PACX-1vR9ZdYYIQlbkfUgupyqL8FEh0mVUrMiC2AwN46YhyeNfle0ECXykzCsiMhYIUqFnuXvwdW-5Q3FfWZp';

const SHEETS = {
  rawPi: { name: 'RAW - PI', gid: '1621768409' },
  rawPs: { name: 'RAW - PS', gid: '1981131514' },
  rawPayable: { name: 'RAW - Payable', gid: '249437847' },
  masterRekening: { name: 'Master Rekening', gid: '1330775361' },
};

const PAYABLE = {
  VENDOR_CODE: 1,
  VENDOR_NAME: 2,
  COMPANY: 3,
  PURCHASE_INVOICE_CODE: 6,
  TRANSACTION_AT: 7,
  DUE_AT: 8,
  DUE_IN: 9,
  PAYMENT_STATE: 10,
  PAYABLE_AMOUNT: 12,
  PAYABLE_DUE: 16,
};

const PI = {
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
  DESCRIPTION: 12,
  TGL_FAKTUR: 17,
  TGL_PEMBELIAN: 18,
  TOTAL_RENCANA_BAYAR: 21,
  HUTANG: 22,
  QTY_PS: 25,
  HARGA_PS: 26,
  NOMOR_REKENING: 27,
  NAMA_REKENING: 28,
};

const PS = {
  SOURCE_DOCUMENT_CODE: 1,
  ITEM_NAME: 4,
  ITEM_QUANTITY: 5,
  ITEM_GRAND_AMOUNT: 6,
  HARGA_SATUAN: 16,
};

const REKENING = {
  NAMA_VENDOR: 0,
  NO_REKENING: 1,
  NAMA_PENERIMA: 2,
  NAMA_BANK: 3,
};

let prismaSingleton = null;

function getPrismaClient() {
  if (!prismaSingleton) prismaSingleton = new PrismaClient();
  return prismaSingleton;
}

export async function disconnectSyncPrisma() {
  if (prismaSingleton) {
    await prismaSingleton.$disconnect();
    prismaSingleton = null;
  }
}

const toText = (value) => String(value ?? '').trim();

const normalizeHeader = (value) =>
  toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizeName = (value) =>
  toText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const hashText = (value, length = 40) =>
  createHash('sha1').update(String(value)).digest('hex').slice(0, length);

const rowHash = (row) => hashText(JSON.stringify(row));

function buildHeaderMap(headers) {
  const map = new Map();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized && !map.has(normalized)) map.set(normalized, index);
  });
  return map;
}

function getCell(row, headerMap, candidates, fallbackIndex) {
  for (const candidate of candidates) {
    const index = headerMap.get(normalizeHeader(candidate));
    if (index !== undefined) return row[index];
  }
  return row[fallbackIndex];
}

function normalizeDecimalString(value) {
  if (typeof value === 'number') return String(value);

  const stringValue =
    value && typeof value === 'object' && typeof value.toString === 'function'
      ? value.toString()
      : value;
  const raw = toText(stringValue).replace(/[^\d,.-]/g, '');
  if (!raw) return '0';

  const isNegative = raw.startsWith('-');
  const unsigned = raw.replace(/-/g, '');
  const lastComma = unsigned.lastIndexOf(',');
  const lastDot = unsigned.lastIndexOf('.');

  const normalizeSingleSeparator = (input, separator) => {
    const parts = input.split(separator);
    if (parts.length > 2) return parts.join('');

    const [whole, fraction = ''] = parts;
    if (!fraction) return whole;
    if (fraction.length === 3 && whole.length <= 3) return `${whole}${fraction}`;
    if (fraction.length <= 4) return `${whole}.${fraction}`;
    return `${whole}${fraction}`;
  };

  let normalized = unsigned;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = unsigned
      .replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '')
      .replace(decimalSeparator, '.');
  } else if (lastComma >= 0) {
    normalized = normalizeSingleSeparator(unsigned, ',');
  } else if (lastDot >= 0) {
    normalized = normalizeSingleSeparator(unsigned, '.');
  }

  return `${isNegative ? '-' : ''}${normalized}`;
}

const toNumber = (value, fallback = 0) => {
  const parsed = Number(normalizeDecimalString(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toDecimal = (value) => {
  try {
    return new Prisma.Decimal(normalizeDecimalString(value));
  } catch {
    return new Prisma.Decimal(0);
  }
};

function parseSheetDate(value) {
  const raw = toText(value);
  if (!raw) return null;

  const monthNames = {
    jan: 0,
    januari: 0,
    feb: 1,
    februari: 1,
    mar: 2,
    maret: 2,
    apr: 3,
    april: 3,
    mei: 4,
    may: 4,
    jun: 5,
    juni: 5,
    jul: 6,
    juli: 6,
    agu: 7,
    agt: 7,
    aug: 7,
    agustus: 7,
    sep: 8,
    september: 8,
    okt: 9,
    oct: 9,
    oktober: 9,
    nov: 10,
    november: 10,
    des: 11,
    dec: 11,
    desember: 11,
  };

  const ymdMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymdMatch) {
    const [, year, month, day] = ymdMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slashMatch) {
    const [, first, second, yearRaw] = slashMatch;
    const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw);
    const a = Number(first);
    const b = Number(second);
    const dayFirst = a > 12;
    const day = dayFirst ? a : b;
    const month = dayFirst ? b : a;
    return new Date(year, month - 1, day);
  }

  const namedMatch = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (namedMatch) {
    const [, day, monthRaw, year] = namedMatch;
    const month = monthNames[monthRaw.toLowerCase()];
    if (month !== undefined) return new Date(Number(year), month, Number(day));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(start, end) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / (24 * 60 * 60 * 1000));
}

function deriveTempoHari(transactionAt, dueAt, dueIn) {
  if (transactionAt && dueAt) {
    const term = daysBetween(transactionAt, dueAt);
    if (Number.isFinite(term) && term >= 0) return term;
  }

  const parsedDueIn = Number.parseInt(toText(dueIn), 10);
  return Number.isFinite(parsedDueIn) && parsedDueIn > 0 ? parsedDueIn : 0;
}

function buildVendorCode(vendorName, vendorCode) {
  const cleanCode = toText(vendorCode);
  if (cleanCode) return cleanCode;

  const prefix = vendorName.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'VND';
  return `${prefix}-${hashText(vendorName, 6).toUpperCase()}`;
}

function sourceKey(prefix, value) {
  const cleanValue = toText(value).replace(/\s+/g, ' ');
  return `${prefix}:${cleanValue}`;
}

async function fetchPublishedCsv(sheet) {
  const publishedId = process.env.GOOGLE_SHEET_PUBLISHED_ID || DEFAULT_PUBLISHED_ID;
  const url = `https://docs.google.com/spreadsheets/d/e/${publishedId}/pub?gid=${sheet.gid}&single=true&output=csv`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Gagal mengambil ${sheet.name}: HTTP ${response.status}`);
  }

  return response.text();
}

function parseCsv(text) {
  const parsed = Papa.parse(text, {
    skipEmptyLines: 'greedy',
  });

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(`CSV parse error: ${firstError.message}`);
  }

  return parsed.data.map((row) => row.map((cell) => toText(cell)));
}

async function fetchAllSheetRows() {
  const [payableText, piText, psText, rekeningText] = await Promise.all([
    fetchPublishedCsv(SHEETS.rawPayable),
    fetchPublishedCsv(SHEETS.rawPi),
    fetchPublishedCsv(SHEETS.rawPs),
    fetchPublishedCsv(SHEETS.masterRekening),
  ]);

  return {
    payables: parseCsv(payableText),
    piItems: parseCsv(piText),
    psItems: parseCsv(psText),
    bankRows: parseCsv(rekeningText),
  };
}

function parsePayables(rows) {
  if (rows.length <= 1) return [];
  const headerMap = buildHeaderMap(rows[0]);

  return rows.slice(1).map((row, index) => {
    const noPi = toText(getCell(row, headerMap, ['Purchase Invoice Code'], PAYABLE.PURCHASE_INVOICE_CODE));
    const vendorName = toText(getCell(row, headerMap, ['Vendor Name'], PAYABLE.VENDOR_NAME));
    const vendorCode = toText(getCell(row, headerMap, ['Vendor Code'], PAYABLE.VENDOR_CODE));
    const companyCode = toText(getCell(row, headerMap, ['Company'], PAYABLE.COMPANY));
    const transactionAt = parseSheetDate(getCell(row, headerMap, ['Transaction At'], PAYABLE.TRANSACTION_AT));
    const dueAt = parseSheetDate(getCell(row, headerMap, ['Due At'], PAYABLE.DUE_AT));

    return {
      rowNumber: index + 2,
      noPi,
      vendorName,
      vendorCode: buildVendorCode(vendorName || 'Unknown Vendor', vendorCode),
      companyCode: companyCode || 'UNKNOWN',
      companyName: companyCode || 'UNKNOWN',
      tglBeli: transactionAt,
      dueAt,
      tempoHari: deriveTempoHari(transactionAt, dueAt, getCell(row, headerMap, ['Due In'], PAYABLE.DUE_IN)),
      paymentState: toText(getCell(row, headerMap, ['Payment state', 'Payment State'], PAYABLE.PAYMENT_STATE)).toLowerCase() || 'unpaid',
      totalRencanaBayar: toDecimal(getCell(row, headerMap, ['Payable Amount'], PAYABLE.PAYABLE_AMOUNT)),
      hutang: toDecimal(getCell(row, headerMap, ['Payable due', 'Payable Due'], PAYABLE.PAYABLE_DUE)),
      sourceRowHash: rowHash(row),
    };
  }).filter((row) => row.noPi);
}

function parsePiItems(rows) {
  if (rows.length <= 1) return [];
  const headerMap = buildHeaderMap(rows[0]);

  return rows.slice(1).map((row, index) => {
    const noPi = toText(getCell(row, headerMap, ['Purchase Invoice Code'], PI.PURCHASE_INVOICE_CODE));
    const qtyPI = toNumber(getCell(row, headerMap, ['Quantity'], PI.QUANTITY));
    const hargaPI = toDecimal(getCell(row, headerMap, ['Item Price'], PI.ITEM_PRICE));

    return {
      rowNumber: index + 2,
      noPi,
      sourceDocumentCode: toText(getCell(row, headerMap, ['Source Document Code'], PI.SOURCE_DOCUMENT_CODE)),
      state: toText(getCell(row, headerMap, ['State'], PI.STATE)),
      vendorName: toText(getCell(row, headerMap, ['Vendor Name'], PI.VENDOR_NAME)),
      namaBarang: toText(getCell(row, headerMap, ['Item Name'], PI.ITEM_NAME)) || 'Tanpa Nama Barang',
      keterangan: toText(getCell(row, headerMap, ['Description'], PI.DESCRIPTION)),
      qtyPI,
      hargaPI,
      totalHarga: toDecimal(getCell(row, headerMap, ['Item Grand Amount'], PI.ITEM_GRAND_AMOUNT)),
      tglBeli:
        parseSheetDate(getCell(row, headerMap, ['Tgl Pembelian', 'Purchase At'], PI.TGL_PEMBELIAN)) ||
        parseSheetDate(getCell(row, headerMap, ['Purchase At'], PI.PURCHASE_AT)) ||
        parseSheetDate(getCell(row, headerMap, ['Transaction At'], PI.TRANSACTION_AT)),
      tglFaktur: parseSheetDate(getCell(row, headerMap, ['Tgl Faktur'], PI.TGL_FAKTUR)),
      totalRencanaBayar: toDecimal(getCell(row, headerMap, ['Total Rencana Bayar'], PI.TOTAL_RENCANA_BAYAR)),
      hutang: toDecimal(getCell(row, headerMap, ['Hutang'], PI.HUTANG)),
      qtyPS: toNumber(getCell(row, headerMap, ['Qty PS'], PI.QTY_PS)),
      hargaPS: toDecimal(getCell(row, headerMap, ['Harga PS'], PI.HARGA_PS)),
      nomorRekening: toText(getCell(row, headerMap, ['Nomor Rekening'], PI.NOMOR_REKENING)),
      namaRekening: toText(getCell(row, headerMap, ['Nama Rekening'], PI.NAMA_REKENING)),
      sourceRowHash: rowHash(row),
    };
  }).filter((row) => row.noPi);
}

function parsePsItems(rows) {
  if (rows.length <= 1) return new Map();
  const headerMap = buildHeaderMap(rows[0]);
  const result = new Map();

  rows.slice(1).forEach((row) => {
    const sourceDocumentCode = toText(getCell(row, headerMap, ['Source Document Code'], PS.SOURCE_DOCUMENT_CODE));
    const itemName = toText(getCell(row, headerMap, ['Item Name'], PS.ITEM_NAME));
    const key = `${sourceDocumentCode}::${normalizeName(itemName)}`;

    if (!result.has(key)) {
      const qtyPS = toNumber(getCell(row, headerMap, ['Item Quantity'], PS.ITEM_QUANTITY));
      const grandAmount = toDecimal(getCell(row, headerMap, ['Item Grand Amount'], PS.ITEM_GRAND_AMOUNT));
      const explicitUnitPrice = toDecimal(getCell(row, headerMap, ['Harga Satuan'], PS.HARGA_SATUAN));
      const hargaPS = explicitUnitPrice.gt(0)
        ? explicitUnitPrice
        : qtyPS > 0
          ? grandAmount.div(qtyPS)
          : new Prisma.Decimal(0);

      result.set(key, { qtyPS, hargaPS });
    }
  });

  return result;
}

function parseBankRows(rows) {
  if (rows.length <= 1) return [];
  const headerMap = buildHeaderMap(rows[0]);

  return rows.slice(1).map((row) => ({
    vendorName: toText(getCell(row, headerMap, ['Nama Vendor', 'Vendor Name'], REKENING.NAMA_VENDOR)),
    accountName: toText(getCell(row, headerMap, ['Nama Penerima', 'Nama Rekening', 'Account Name', 'Atas Nama'], REKENING.NAMA_PENERIMA)),
    bankAccount: toText(getCell(row, headerMap, ['Nomor Rekening', 'No Rekening', 'Bank Account', 'Account Number'], REKENING.NO_REKENING)),
    bankName: toText(getCell(row, headerMap, ['Nama Bank', 'Bank Name'], REKENING.NAMA_BANK)),
  })).filter((row) => row.vendorName);
}

function buildSyncPlan(sheetRows) {
  const payables = parsePayables(sheetRows.payables);
  const piItems = parsePiItems(sheetRows.piItems);
  const psItemsBySourceAndItem = parsePsItems(sheetRows.psItems);
  const bankRows = parseBankRows(sheetRows.bankRows);
  const piItemsByInvoice = new Map();

  for (const item of piItems) {
    const items = piItemsByInvoice.get(item.noPi) ?? [];
    items.push(item);
    piItemsByInvoice.set(item.noPi, items);
  }

  const invoiceMap = new Map();

  for (const payable of payables) {
    invoiceMap.set(payable.noPi, {
      noPi: payable.noPi,
      companyCode: payable.companyCode,
      companyName: payable.companyName,
      vendorCode: payable.vendorCode,
      vendorName: payable.vendorName || 'Unknown Vendor',
      tglBeli: payable.tglBeli,
      tglFaktur: null,
      tempoHari: payable.tempoHari,
      paymentState: payable.paymentState,
      totalRencanaBayar: payable.totalRencanaBayar,
      hutang: payable.hutang,
      sourceKey: sourceKey('RAW_PAYABLE', payable.noPi),
      sourceSheet: SHEETS.rawPayable.name,
      sourceRowHash: payable.sourceRowHash,
      items: [],
    });
  }

  for (const [noPi, items] of piItemsByInvoice.entries()) {
    const existing = invoiceMap.get(noPi);
    const firstItem = items[0];
    const totalFromItems = items.reduce((sum, item) => sum.plus(item.totalHarga), new Prisma.Decimal(0));
    const fallbackTotal = firstItem.totalRencanaBayar.gt(0) ? firstItem.totalRencanaBayar : totalFromItems;

    const invoice = existing ?? {
      noPi,
      companyCode: 'RAW-PI',
      companyName: 'RAW - PI',
      vendorCode: buildVendorCode(firstItem.vendorName || 'Unknown Vendor'),
      vendorName: firstItem.vendorName || 'Unknown Vendor',
      tglBeli: firstItem.tglBeli,
      tglFaktur: firstItem.tglFaktur,
      tempoHari: 0,
      paymentState: 'paid',
      totalRencanaBayar: fallbackTotal,
      hutang: firstItem.hutang.gt(0) ? firstItem.hutang : new Prisma.Decimal(0),
      sourceKey: sourceKey('RAW_PI_INVOICE', noPi),
      sourceSheet: SHEETS.rawPi.name,
      sourceRowHash: firstItem.sourceRowHash,
      items: [],
    };

    if (!invoice.tglBeli && firstItem.tglBeli) invoice.tglBeli = firstItem.tglBeli;
    if (!invoice.tglFaktur && firstItem.tglFaktur) invoice.tglFaktur = firstItem.tglFaktur;
    if (invoice.totalRencanaBayar.equals(0) && fallbackTotal.gt(0)) invoice.totalRencanaBayar = fallbackTotal;

    invoice.items = items.map((item, itemIndex) => {
      const ps = psItemsBySourceAndItem.get(`${item.sourceDocumentCode}::${normalizeName(item.namaBarang)}`);
      const qtyPS = item.qtyPS || ps?.qtyPS || 0;
      const hargaPS = item.hargaPS.gt(0) ? item.hargaPS : ps?.hargaPS ?? new Prisma.Decimal(0);

      return {
        sourceKey: sourceKey('RAW_PI_ITEM', `${noPi}:${itemIndex + 1}`),
        sourceSheet: SHEETS.rawPi.name,
        sourceRowHash: item.sourceRowHash,
        namaBarang: item.namaBarang,
        keterangan: item.keterangan || null,
        qtyPI: item.qtyPI,
        qtyPS,
        hargaPI: item.hargaPI,
        hargaPS,
        totalHarga: item.totalHarga,
      };
    });

    invoiceMap.set(noPi, invoice);
  }

  const companyInputs = new Map();
  const vendorInputs = new Map();

  for (const invoice of invoiceMap.values()) {
    companyInputs.set(invoice.companyCode, {
      code: invoice.companyCode,
      name: invoice.companyName || invoice.companyCode,
    });
    vendorInputs.set(invoice.vendorCode, {
      code: invoice.vendorCode,
      name: invoice.vendorName,
    });
  }

  return {
    companies: Array.from(companyInputs.values()),
    vendors: Array.from(vendorInputs.values()),
    invoices: Array.from(invoiceMap.values()),
    bankRows,
    counts: {
      companiesSeen: companyInputs.size,
      vendorsSeen: vendorInputs.size,
      invoicesSeen: invoiceMap.size,
      invoiceItemsSeen: piItems.length,
      bankRowsSeen: bankRows.length,
      rawPayableRows: payables.length,
      rawPiRows: piItems.length,
    },
  };
}

function createEmptyMutationCounts() {
  return {
    companiesUpserted: 0,
    vendorsUpserted: 0,
    invoicesUpserted: 0,
    itemsUpserted: 0,
    bankRowsApplied: 0,
  };
}

function toSyncRunSeenData(counts) {
  return {
    companiesSeen: counts.companiesSeen,
    vendorsSeen: counts.vendorsSeen,
    invoicesSeen: counts.invoicesSeen,
    invoiceItemsSeen: counts.invoiceItemsSeen,
    bankRowsSeen: counts.bankRowsSeen,
  };
}

function toInvoiceItemData(invoiceId, item, now) {
  return {
    invoiceId,
    namaBarang: item.namaBarang,
    keterangan: item.keterangan,
    qtyPI: item.qtyPI,
    qtyPS: item.qtyPS,
    hargaPI: item.hargaPI,
    hargaPS: item.hargaPS,
    totalHarga: item.totalHarga,
    sourceKey: item.sourceKey,
    sourceSheet: item.sourceSheet,
    sourceRowHash: item.sourceRowHash,
    sourceActive: true,
    lastSyncedAt: now,
  };
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function filterChangedInvoices(prisma, plan) {
  const existingInvoicesByNoPi = new Map();
  const existingItemsBySourceKey = new Map();
  const invoiceNumbers = plan.invoices.map((invoice) => invoice.noPi);
  const itemSourceKeys = plan.invoices.flatMap((invoice) => invoice.items.map((item) => item.sourceKey));

  for (const chunk of chunkArray(invoiceNumbers, 2000)) {
    const existingInvoices = await prisma.purchaseInvoice.findMany({
      where: { noPi: { in: chunk } },
      select: {
        noPi: true,
        sourceRowHash: true,
        sourceActive: true,
      },
    });

    for (const invoice of existingInvoices) {
      existingInvoicesByNoPi.set(invoice.noPi, invoice);
    }
  }

  for (const chunk of chunkArray(itemSourceKeys, 2000)) {
    const existingItems = await prisma.invoiceItem.findMany({
      where: { sourceKey: { in: chunk } },
      select: {
        sourceKey: true,
        sourceRowHash: true,
        sourceActive: true,
      },
    });

    for (const item of existingItems) {
      existingItemsBySourceKey.set(item.sourceKey, item);
    }
  }

  const changedInvoices = plan.invoices.filter((invoice) => {
    const existingInvoice = existingInvoicesByNoPi.get(invoice.noPi);

    if (!existingInvoice) return true;
    if (!existingInvoice.sourceActive) return true;
    if (existingInvoice.sourceRowHash !== invoice.sourceRowHash) return true;

    return invoice.items.some((item) => {
      const existingItem = existingItemsBySourceKey.get(item.sourceKey);
      return !existingItem || !existingItem.sourceActive || existingItem.sourceRowHash !== item.sourceRowHash;
    });
  });

  return {
    ...plan,
    invoices: changedInvoices,
    counts: {
      ...plan.counts,
      invoicesChanged: changedInvoices.length,
      invoicesSkipped: plan.invoices.length - changedInvoices.length,
    },
  };
}

async function filterNewInvoices(prisma, plan) {
  const existingInvoicesByNoPi = new Map();
  const invoiceNumbers = plan.invoices.map((invoice) => invoice.noPi);

  for (const chunk of chunkArray(invoiceNumbers, 2000)) {
    const existingInvoices = await prisma.purchaseInvoice.findMany({
      where: { noPi: { in: chunk } },
      select: {
        noPi: true,
        items: {
          where: { sourceActive: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    for (const invoice of existingInvoices) {
      existingInvoicesByNoPi.set(invoice.noPi, invoice);
    }
  }

  const newInvoices = plan.invoices.filter((invoice) => {
    const existingInvoice = existingInvoicesByNoPi.get(invoice.noPi);
    if (!existingInvoice) return true;

    return invoice.items.length > 0 && existingInvoice.items.length === 0;
  });

  return {
    ...plan,
    invoices: newInvoices,
    counts: {
      ...plan.counts,
      invoicesChanged: newInvoices.length,
      invoicesSkipped: plan.invoices.length - newInvoices.length,
    },
  };
}

async function upsertInvoiceItemsBatch(tx, invoiceItemsByInvoiceId, now) {
  const sourceItems = [];
  const activeKeysByInvoiceId = new Map();

  for (const [invoiceId, items] of invoiceItemsByInvoiceId.entries()) {
    const activeKeys = items.map((item) => item.sourceKey);
    activeKeysByInvoiceId.set(invoiceId, activeKeys);

    for (const item of items) {
      sourceItems.push(toInvoiceItemData(invoiceId, item, now));
    }
  }

  if (sourceItems.length === 0) return 0;

  const sourceKeys = sourceItems.map((item) => item.sourceKey);
  const existingItems = await tx.invoiceItem.findMany({
    where: {
      sourceKey: { in: sourceKeys },
    },
    select: {
      id: true,
      sourceKey: true,
      sourceRowHash: true,
      sourceActive: true,
    },
  });
  const existingBySourceKey = new Map(existingItems.map((item) => [item.sourceKey, item]));
  const itemsToCreate = [];
  const itemsToUpdate = [];

  for (const item of sourceItems) {
    const existing = existingBySourceKey.get(item.sourceKey);
    if (!existing) {
      itemsToCreate.push(item);
      continue;
    }

    if (existing.sourceRowHash !== item.sourceRowHash || !existing.sourceActive) {
      itemsToUpdate.push({ id: existing.id, data: item });
    }
  }

  for (const createChunk of chunkArray(itemsToCreate, 1000)) {
    await tx.invoiceItem.createMany({
      data: createChunk,
      skipDuplicates: true,
    });
  }

  for (const item of itemsToUpdate) {
    await tx.invoiceItem.update({
      where: { id: item.id },
      data: item.data,
    });
  }

  for (const [invoiceId, activeSourceKeys] of activeKeysByInvoiceId.entries()) {
    if (activeSourceKeys.length === 0) continue;

    await tx.invoiceItem.updateMany({
      where: {
        invoiceId,
        sourceKey: { not: null },
        NOT: {
          sourceKey: { in: activeSourceKeys },
        },
      },
      data: {
        sourceActive: false,
        lastSyncedAt: now,
      },
    });
  }

  return sourceItems.length;
}

async function applySyncPlan(prisma, plan, now, logger = console) {
  const mutations = createEmptyMutationCounts();
  const companyIdByCode = new Map();
  const vendorIdByCode = new Map();

  await prisma.$transaction(async (tx) => {
    for (const company of plan.companies) {
      const saved = await tx.company.upsert({
        where: { code: company.code },
        update: { name: company.name },
        create: company,
      });
      companyIdByCode.set(saved.code, saved.id);
      mutations.companiesUpserted += 1;
    }

    for (const vendor of plan.vendors) {
      const saved = await tx.vendor.upsert({
        where: { code: vendor.code },
        update: { name: vendor.name },
        create: vendor,
      });
      vendorIdByCode.set(saved.code, saved.id);
      mutations.vendorsUpserted += 1;
    }

    for (const bankRow of plan.bankRows) {
      if (!bankRow.bankAccount && !bankRow.bankName && !bankRow.accountName) continue;

      const result = await tx.vendor.updateMany({
        where: {
          name: { equals: bankRow.vendorName, mode: 'insensitive' },
          bankAccountEditedAt: null,
        },
        data: {
          bankAccount: bankRow.bankAccount || null,
          bankName: bankRow.bankName || null,
          accountName: bankRow.accountName || null,
          bankAccountSource: 'sheet',
        },
      });

      mutations.bankRowsApplied += result.count;
    }
  }, { timeout: 120000 });

  const batchSize = 25;
  for (let start = 0; start < plan.invoices.length; start += batchSize) {
    const batch = plan.invoices.slice(start, start + batchSize);

    await prisma.$transaction(async (tx) => {
      const sourceItemsByInvoiceId = new Map();

      for (const invoice of batch) {
        const companyId = companyIdByCode.get(invoice.companyCode);
        const vendorId = vendorIdByCode.get(invoice.vendorCode);

        if (!companyId || !vendorId) {
          throw new Error(`Company/vendor tidak ditemukan untuk PI ${invoice.noPi}`);
        }

        const savedInvoice = await tx.purchaseInvoice.upsert({
          where: { noPi: invoice.noPi },
          update: {
            tglBeli: invoice.tglBeli ?? new Date(),
            tglFaktur: invoice.tglFaktur,
            tempoHari: invoice.tempoHari,
            paymentState: invoice.paymentState,
            totalRencanaBayar: invoice.totalRencanaBayar,
            hutang: invoice.hutang,
            companyId,
            vendorId,
            sourceKey: invoice.sourceKey,
            sourceSheet: invoice.sourceSheet,
            sourceRowHash: invoice.sourceRowHash,
            sourceActive: true,
            lastSyncedAt: now,
          },
          create: {
            noPi: invoice.noPi,
            tglBeli: invoice.tglBeli ?? new Date(),
            tglFaktur: invoice.tglFaktur,
            tempoHari: invoice.tempoHari,
            paymentState: invoice.paymentState,
            totalRencanaBayar: invoice.totalRencanaBayar,
            hutang: invoice.hutang,
            companyId,
            vendorId,
            sourceKey: invoice.sourceKey,
            sourceSheet: invoice.sourceSheet,
            sourceRowHash: invoice.sourceRowHash,
            sourceActive: true,
            lastSyncedAt: now,
          },
          select: { id: true },
        });

        mutations.invoicesUpserted += 1;
        sourceItemsByInvoiceId.set(savedInvoice.id, invoice.items);
      }

      mutations.itemsUpserted += await upsertInvoiceItemsBatch(tx, sourceItemsByInvoiceId, now);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 120000,
    });

    logger.log?.(`Synced invoice batch ${Math.min(start + batch.length, plan.invoices.length)}/${plan.invoices.length}`);
  }

  return mutations;
}

export async function syncGoogleSheetsToSupabase(options = {}) {
  const startedAt = new Date();
  const dryRun = Boolean(options.dryRun);
  const incremental = Boolean(options.incremental);
  const newOnly = Boolean(options.newOnly);
  const logger = options.logger ?? console;
  const prisma = options.prisma ?? (dryRun ? null : getPrismaClient());

  const sheetRows = await fetchAllSheetRows();
  const fullPlan = buildSyncPlan(sheetRows);
  const plan = newOnly && prisma
    ? await filterNewInvoices(prisma, fullPlan)
    : incremental && prisma
      ? await filterChangedInvoices(prisma, fullPlan)
      : fullPlan;
  const mutations = createEmptyMutationCounts();

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      incremental,
      newOnly,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      counts: {
        ...plan.counts,
        ...mutations,
      },
      sample: {
        invoices: plan.invoices.slice(0, 5).map((invoice) => ({
          noPi: invoice.noPi,
          vendorName: invoice.vendorName,
          companyCode: invoice.companyCode,
          itemCount: invoice.items.length,
          paymentState: invoice.paymentState,
        })),
      },
    };
  }

  let syncRun = null;
  try {
    await markStaleSyncRuns({ prisma });

    syncRun = await prisma.syncRun.create({
      data: {
        status: 'running',
        startedAt,
        dryRun: false,
        message: newOnly ? 'New-only sync dari dashboard refresh' : incremental ? 'Incremental sync dari dashboard refresh' : null,
        ...toSyncRunSeenData(plan.counts),
      },
    });

    const applied = await applySyncPlan(prisma, plan, startedAt, logger);
    const finishedAt = new Date();

    const result = {
      success: true,
      dryRun: false,
      incremental,
      newOnly,
      syncRunId: syncRun.id,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      counts: {
        ...plan.counts,
        ...applied,
      },
    };

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'success',
        finishedAt,
        durationMs: result.durationMs,
        ...applied,
        message: newOnly
          ? `New-only sync berhasil: ${applied.invoicesUpserted} PI baru diproses, ${plan.counts.invoicesSkipped || 0} PI lama dilewati.`
          : incremental
            ? `Incremental sync berhasil: ${applied.invoicesUpserted} PI diproses, ${plan.counts.invoicesSkipped || 0} PI dilewati.`
          : `Sync berhasil: ${applied.invoicesUpserted} PI dan ${applied.itemsUpserted} item.`,
      },
    });

    return result;
  } catch (error) {
    const finishedAt = new Date();

    if (syncRun) {
      await prisma.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: 'failed',
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          error: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => undefined);
    }

    throw error;
  }
}

export async function markStaleSyncRuns(options = {}) {
  const prisma = options.prisma ?? getPrismaClient();
  const staleAfterMs = Number(options.staleAfterMs ?? 30 * 60 * 1000);
  const staleBefore = new Date(Date.now() - staleAfterMs);

  return prisma.syncRun.updateMany({
    where: {
      status: 'running',
      startedAt: { lt: staleBefore },
    },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      error: `Sync tidak selesai dalam ${Math.round(staleAfterMs / 60000)} menit dan ditandai stale otomatis.`,
      message: 'Stale sync run dibersihkan otomatis.',
    },
  });
}

export async function getLatestSyncRun(options = {}) {
  const prisma = options.prisma ?? getPrismaClient();
  await markStaleSyncRuns({ prisma });

  return prisma.syncRun.findFirst({
    orderBy: { startedAt: 'desc' },
  });
}

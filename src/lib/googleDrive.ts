// ============================================================
// Google Drive API Client - Invoice lookup & Download
// ============================================================

import { google, drive_v3 } from 'googleapis';
import type { InvoiceFile } from '@/types/finance';

let driveClient: drive_v3.Drive | null = null;
const invoiceCache = new Map<string, { files: InvoiceFile[]; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizePiToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^P[1IL]/, 'PI');
}

function getPiDigits(value: string): string {
  return normalizePiToken(value).replace(/^PI/, '').replace(/\D/g, '');
}

function extractNormalizedPiTokens(value: string): string[] {
  const normalized = value.toUpperCase();
  const tokens = normalized.match(/P[1IL]?\s*[-_ ]*\d{6,}/g) || [];

  return tokens.map(normalizePiToken);
}

function fileNameMatchesPi(fileName: string, piNumber: string): boolean {
  const expectedToken = normalizePiToken(piNumber);
  const expectedDigits = getPiDigits(piNumber);
  const fileTokens = extractNormalizedPiTokens(fileName);

  if (fileTokens.includes(expectedToken)) return true;

  const compactFileName = fileName.replace(/\D/g, '');
  return Boolean(expectedDigits) && compactFileName.includes(expectedDigits);
}

/**
 * Initialize Google Drive API client
 */
export function getClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

/**
 * Search invoice files by PI number in Google Drive
 */
export async function searchInvoiceFiles(piNumber: string): Promise<InvoiceFile[]> {
  const cached = invoiceCache.get(piNumber);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.files;
  }

  try {
    const client = getClient();
    
    // Menghilangkan awalan "PI" misal "PI12345" menjadi "12345"
    const cleanPiNumber = piNumber.replace(/^PI[-_ ]*/i, '');
    const query = `(name contains '${escapeDriveQueryValue(piNumber)}' or name contains '${escapeDriveQueryValue(cleanPiNumber)}') and trashed = false`;

    const response = await client.files.list({
      q: query,
      fields: 'files(id, name, webViewLink, mimeType)',
      pageSize: 20,
      orderBy: 'modifiedTime desc',
    });

    const files: InvoiceFile[] = (response.data.files || [])
      .filter(file => fileNameMatchesPi(file.name || '', piNumber))
      .map(file => ({
        id: file.id || '',
        name: file.name || '',
        webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
        mimeType: file.mimeType || '',
      }));

    invoiceCache.set(piNumber, { files, timestamp: Date.now() });
    return files;
  } catch (error) {
    console.error(`Error searching invoice for ${piNumber}:`, error);
    if (cached) return cached.files;
    return [];
  }
}

/**
 * Search invoice files for multiple PIs
 */
export async function searchMultiplePI(piList: string[]): Promise<Map<string, InvoiceFile[]>> {
  const results = new Map<string, InvoiceFile[]>();
  const batchSize = 5;
  for (let i = 0; i < piList.length; i += batchSize) {
    const batch = piList.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(pi => searchInvoiceFiles(pi)));

    batchResults.forEach((result, index) => {
      const piNumber = batch[index];
      if (result.status === 'fulfilled') {
        results.set(piNumber, result.value);
      } else {
        console.error(`Failed to search invoice for ${piNumber}:`, result.reason);
        results.set(piNumber, []);
      }
    });

    if (i + batchSize < piList.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  return results;
}

/**
 * Download a file from Google Drive and return as base64 string for Gemini API
 */
export async function downloadInvoiceFileToBase64(fileId: string): Promise<{ mimeType: string, base64: string } | null> {
  try {
    const client = getClient();
    
    // First get metadata to know mimeType
    const meta = await client.files.get({ fileId, fields: 'mimeType' });
    const mimeType = meta.data.mimeType || 'application/pdf';

    // Then download payload
    const response = await client.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' } // Get raw buffer
    );

    const buffer = Buffer.from(response.data as ArrayBuffer);
    const base64 = buffer.toString('base64');

    return { mimeType, base64 };
  } catch (error) {
    console.error(`Error downloading file ${fileId} from Drive:`, error);
    return null;
  }
}

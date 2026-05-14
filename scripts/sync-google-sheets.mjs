#!/usr/bin/env node

import {
  disconnectSyncPrisma,
  syncGoogleSheetsToSupabase,
} from '../src/lib/sync/googleSheetsSync.mjs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const json = args.has('--json');

function printHelp() {
  console.log(`
Google Sheets to Supabase sync

Usage:
  node scripts/sync-google-sheets.mjs --dry-run
  node scripts/sync-google-sheets.mjs

Options:
  --dry-run   Fetch and parse the published spreadsheet without writing to DB
  --json      Print machine-readable JSON
  --help      Show this help text
`);
}

if (args.has('--help') || args.has('-h')) {
  printHelp();
  process.exit(0);
}

try {
  const result = await syncGoogleSheetsToSupabase({
    dryRun,
    logger: json ? { log() {}, warn() {}, error() {} } : console,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('');
    console.log(dryRun ? 'Dry-run selesai.' : 'Sync selesai.');
    console.table(result.counts);

    if (result.sample?.invoices?.length) {
      console.log('Sample invoice:');
      console.table(result.sample.invoices);
    }
  }
} catch (error) {
  console.error('Sync gagal:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await disconnectSyncPrisma();
}

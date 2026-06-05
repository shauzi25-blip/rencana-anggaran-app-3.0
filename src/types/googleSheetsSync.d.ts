declare module '@/lib/sync/googleSheetsSync.mjs' {
  import type { PrismaClient, SyncRun } from '@prisma/client';

  export interface GoogleSheetsSyncOptions {
    dryRun?: boolean;
    incremental?: boolean;
    prisma?: PrismaClient;
    logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  }

  export interface GoogleSheetsSyncResult {
    success: boolean;
    dryRun: boolean;
    incremental?: boolean;
    syncRunId?: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    counts: Record<string, number>;
    sample?: {
      invoices: Array<{
        noPi: string;
        vendorName: string;
        companyCode: string;
        itemCount: number;
        paymentState: string;
      }>;
    };
  }

  export function syncGoogleSheetsToSupabase(
    options?: GoogleSheetsSyncOptions
  ): Promise<GoogleSheetsSyncResult>;

  export function getLatestSyncRun(options?: { prisma?: PrismaClient }): Promise<SyncRun | null>;

  export function disconnectSyncPrisma(): Promise<void>;
}

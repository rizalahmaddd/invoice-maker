import { db, getSettings, updateSettings } from '../db';
import type { Client, Invoice, Product, Recurrence, Settings, TemplateConfig } from '../types';
import { todayISO } from './id';

interface BackupFile {
  app: 'invoice-maker';
  version: number;
  exportedAt: string;
  settings: Settings;
  clients: Client[];
  invoices: Invoice[];
  templates: TemplateConfig[];
  products?: Product[];
  recurrences?: Recurrence[];
}

export async function exportBackup(): Promise<File> {
  const data: BackupFile = {
    app: 'invoice-maker',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: await getSettings(),
    clients: await db.clients.toArray(),
    invoices: await db.invoices.toArray(),
    templates: await db.templates.toArray(),
    products: await db.products.toArray(),
    recurrences: await db.recurrences.toArray(),
  };
  return new File([JSON.stringify(data)], `backup-invoice-${todayISO()}.json`, { type: 'application/json' });
}

export async function markBackedUp() {
  await updateSettings({ lastBackupAt: Date.now() });
}

export async function readBackup(file: File): Promise<BackupFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('File ini bukan JSON yang valid.');
  }
  const b = parsed as Partial<BackupFile>;
  if (b?.app !== 'invoice-maker' || !Array.isArray(b.invoices) || !b.settings) {
    throw new Error('File ini bukan backup dari Invoice Maker.');
  }
  return b as BackupFile;
}

export type ImportMode = 'merge' | 'replace';

// Merge keeps whichever copy of a record was edited last, so restoring an older backup never overwrites newer work.
export async function importBackup(b: BackupFile, mode: ImportMode) {
  await db.transaction('rw', [db.invoices, db.clients, db.templates, db.settings, db.products, db.recurrences], async () => {
    if (mode === 'replace') {
      await Promise.all([db.invoices.clear(), db.clients.clear(), db.templates.clear(), db.products.clear(), db.recurrences.clear()]);
      await db.settings.put({ ...b.settings, id: 'app' });
      await db.invoices.bulkPut(b.invoices);
      await db.clients.bulkPut(b.clients ?? []);
      await db.templates.bulkPut(b.templates ?? []);
      await db.products.bulkPut(b.products ?? []);
      await db.recurrences.bulkPut(b.recurrences ?? []);
      return;
    }
    for (const [table, rows] of [
      [db.invoices, b.invoices],
      [db.clients, b.clients ?? []],
      [db.templates, b.templates ?? []],
      [db.products, b.products ?? []],
      [db.recurrences, b.recurrences ?? []],
    ] as const) {
      for (const row of rows as { id: string; updatedAt?: number }[]) {
        const existing = (await (table as typeof db.clients).get(row.id)) as { updatedAt?: number } | undefined;
        if (!existing || (row.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
          await (table as unknown as typeof db.clients).put(row as unknown as Client);
        }
      }
    }
    // A device that was never set up takes the whole profile from the backup, otherwise moving to a new phone loses it.
    const local = await getSettings();
    const current: Settings = local.business.name.trim()
      ? local
      : {
          ...local,
          ...b.settings,
          id: 'app',
          numbering: { ...local.numbering, ...b.settings.numbering, counters: local.numbering.counters },
          receiptNumbering: { ...local.receiptNumbering, ...b.settings.receiptNumbering, counters: local.receiptNumbering.counters },
          quoteNumbering: { ...local.quoteNumbering, ...b.settings.quoteNumbering, counters: local.quoteNumbering.counters },
        };
    const counters = { ...current.numbering.counters };
    for (const [k, v] of Object.entries(b.settings.numbering?.counters ?? {})) {
      counters[k] = Math.max(counters[k] ?? 0, v);
    }
    const receiptCounters = { ...current.receiptNumbering.counters };
    for (const [k, v] of Object.entries(b.settings.receiptNumbering?.counters ?? {})) {
      receiptCounters[k] = Math.max(receiptCounters[k] ?? 0, v);
    }
    const quoteCounters = { ...current.quoteNumbering.counters };
    for (const [k, v] of Object.entries(b.settings.quoteNumbering?.counters ?? {})) {
      quoteCounters[k] = Math.max(quoteCounters[k] ?? 0, v);
    }
    await db.settings.put({
      ...current,
      numbering: { ...current.numbering, counters },
      receiptNumbering: { ...current.receiptNumbering, counters: receiptCounters },
      quoteNumbering: { ...current.quoteNumbering, counters: quoteCounters },
    });
  });
}

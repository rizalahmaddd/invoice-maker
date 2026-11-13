import Dexie, { type Table } from 'dexie';
import type { Client, Frequency, Invoice, NumberingRule, Product, Recurrence, Settings, Status, TemplateConfig } from './types';
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, normalizeTemplate } from './templates';
import { addDays, todayISO, uid } from './lib/id';
import { clientCode, formatNumberPattern, periodKey } from './lib/numbering';
import { computeTotals } from './lib/money';
import { advance } from './lib/recurrence';

class InvoiceDB extends Dexie {
  invoices!: Table<Invoice, string>;
  clients!: Table<Client, string>;
  templates!: Table<TemplateConfig, string>;
  settings!: Table<Settings, string>;
  products!: Table<Product, string>;
  recurrences!: Table<Recurrence, string>;

  constructor() {
    super('invoice-maker');
    this.version(1).stores({
      invoices: 'id, number, status, issueDate, dueDate, clientId, updatedAt',
      clients: 'id, name, updatedAt',
      templates: 'id, name, updatedAt',
      settings: 'id',
    });
    this.version(2).stores({
      invoices: 'id, number, status, issueDate, dueDate, clientId, templateId, updatedAt',
      products: 'id, name, updatedAt',
    });
    this.version(3).stores({
      invoices: 'id, number, status, issueDate, dueDate, clientId, templateId, updatedAt',
      clients: 'id, name, updatedAt',
      templates: 'id, name, updatedAt',
      settings: 'id',
      products: 'id, name, updatedAt',
      recurrences: 'id, nextRun, active, updatedAt',
    });
  }
}

export const db = new InvoiceDB();

export function defaultSettings(): Settings {
  return {
    id: 'app',
    business: { name: '', address: '', phone: '', email: '', website: '', taxId: '' },
    signature: { name: '', title: '' },
    bankAccounts: [],
    defaults: {
      currency: 'IDR',
      lang: 'id',
      dueDays: 14,
      templateId: DEFAULT_TEMPLATE_ID,
      taxEnabled: false,
      taxLabel: 'PPN',
      taxRate: 11,
      taxInclusive: false,
      pphEnabled: false,
      pphLabel: 'PPh 23',
      pphRate: 2,
      notes: '',
      terms: '',
      showQris: true,
    },
    numbering: { format: 'INV/{YYYY}/{MM}/{SEQ:3}', reset: 'yearly', counters: {} },
    receiptNumbering: { format: 'KW/{YYYY}/{SEQ:3}', reset: 'yearly', counters: {} },
    quoteNumbering: { format: 'QUO/{YYYY}/{MM}/{SEQ:3}', reset: 'yearly', counters: {} },
    shareMessage:
      'Halo {klien}, berikut invoice {nomor} sebesar {total}, jatuh tempo {jatuh_tempo}. Terima kasih.',
    reminderMessage:
      'Halo {klien}, mengingatkan invoice {nomor} sebesar {total} sudah jatuh tempo pada {jatuh_tempo}. Mohon dibantu pembayarannya. Terima kasih.',
    theme: 'system',
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await db.settings.get('app');
  const base = defaultSettings();
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    business: { ...base.business, ...stored.business },
    signature: { ...base.signature, ...stored.signature },
    defaults: { ...base.defaults, ...stored.defaults },
    numbering: { ...base.numbering, ...stored.numbering },
    receiptNumbering: { ...base.receiptNumbering, ...stored.receiptNumbering },
    quoteNumbering: { ...base.quoteNumbering, ...stored.quoteNumbering },
  };
}

export async function updateSettings(patch: Partial<Settings> | ((s: Settings) => Settings)) {
  return db.transaction('rw', db.settings, async () => {
    const current = await getSettings();
    const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    await db.settings.put(next);
    return next;
  });
}

export async function allTemplates(): Promise<TemplateConfig[]> {
  const custom = await db.templates.orderBy('updatedAt').reverse().toArray();
  return [...custom.map(normalizeTemplate), ...BUILTIN_TEMPLATES];
}

export async function getTemplate(id: string | undefined): Promise<TemplateConfig> {
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (builtin) return builtin;
  if (id) {
    const custom = await db.templates.get(id);
    if (custom) return normalizeTemplate(custom);
  }
  return BUILTIN_TEMPLATES[0];
}

function reserveNumber(rule: NumberingRule, dateISO: string, code = '') {
  const key = periodKey(rule, dateISO);
  const seq = (rule.counters[key] ?? 0) + 1;
  rule.counters = { ...rule.counters, [key]: seq };
  return { key, seq, number: formatNumberPattern(rule.format, dateISO, seq, code) };
}

export async function createInvoice(overrides: Partial<Invoice> = {}): Promise<Invoice> {
  return db.transaction('rw', db.settings, db.invoices, async () => {
    const s = await getSettings();
    const issueDate = overrides.issueDate ?? todayISO();
    const isQuote = overrides.kind === 'quote';
    const numbering = { ...(isQuote ? s.quoteNumbering : s.numbering) };
    const code = overrides.client?.name ? clientCode(overrides.client.name) : '';
    const reserved = reserveNumber(numbering, issueDate, code);
    const now = Date.now();
    const inv: Invoice = {
      id: uid(),
      number: reserved.number,
      numberKey: reserved.key,
      numberSeq: reserved.seq,
      numberAuto: true,
      title: '',
      reference: '',
      status: 'draft',
      issueDate,
      dueDate: addDays(issueDate, s.defaults.dueDays),
      client: { name: '', contactPerson: '', email: '', phone: '', address: '', taxId: '' },
      items: [],
      discount: { type: 'percent', value: 0 },
      tax: {
        enabled: s.defaults.taxEnabled,
        label: s.defaults.taxLabel,
        rate: s.defaults.taxRate,
        inclusive: s.defaults.taxInclusive,
      },
      pph: { enabled: s.defaults.pphEnabled, label: s.defaults.pphLabel, rate: s.defaults.pphRate },
      adjustments: [],
      currency: s.defaults.currency,
      lang: s.defaults.lang,
      templateId: s.defaults.templateId,
      notes: s.defaults.notes,
      terms: s.defaults.terms,
      bankAccountIds: s.bankAccounts.map((b) => b.id),
      showQris: s.defaults.showQris && !!s.qris,
      payments: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    await db.settings.put(isQuote ? { ...s, quoteNumbering: numbering } : { ...s, numbering });
    await db.invoices.put(inv);
    return inv;
  });
}

// Payments, status and follow-up history change from other screens, so the editor's copy of them may be stale and must not win.
export async function saveEditedInvoice(inv: Invoice): Promise<boolean> {
  return db.transaction('rw', db.invoices, async () => {
    const cur = await db.invoices.get(inv.id);
    if (!cur) return false;
    await db.invoices.put({
      ...inv,
      payments: cur.payments,
      status: cur.status,
      sentAt: cur.sentAt,
      supersededBy: cur.supersededBy,
      quoteState: cur.quoteState,
      quoteDecidedAt: cur.quoteDecidedAt,
      convertedTo: cur.convertedTo,
      lastRemindedAt: cur.lastRemindedAt,
      remindCount: cur.remindCount,
      snoozeUntil: cur.snoozeUntil,
    });
    return true;
  });
}

// Moving the issue date into another period takes a number from that period and returns the old one if it was the last.
export async function renumberForDate(inv: Invoice): Promise<Partial<Invoice> | null> {
  if (!inv.numberAuto || !inv.numberSeq || !inv.numberKey) return null;
  return db.transaction('rw', db.settings, async () => {
    const s = await getSettings();
    const isQuote = inv.kind === 'quote';
    const rule = { ...(isQuote ? s.quoteNumbering : s.numbering) };
    const code = inv.client.name ? clientCode(inv.client.name) : '';
    if (periodKey(rule, inv.issueDate) === inv.numberKey) {
      const number = formatNumberPattern(rule.format, inv.issueDate, inv.numberSeq!, code);
      return number === inv.number ? null : { number };
    }
    if (rule.counters[inv.numberKey!] === inv.numberSeq) {
      rule.counters = { ...rule.counters, [inv.numberKey!]: inv.numberSeq! - 1 };
    }
    const r = reserveNumber(rule, inv.issueDate, code);
    await db.settings.put(isQuote ? { ...s, quoteNumbering: rule } : { ...s, numbering: rule });
    return { number: r.number, numberKey: r.key, numberSeq: r.seq };
  });
}

// Deleting the most recent invoice gives its sequence back, so abandoned drafts don't leave gaps.
export async function deleteInvoice(id: string) {
  await db.transaction('rw', db.settings, db.invoices, async () => {
    const inv = await db.invoices.get(id);
    if (!inv) return;
    await db.invoices.delete(id);
    if (inv.revisionOf) {
      await db.invoices.update(inv.revisionOf, { supersededBy: undefined, status: 'sent' });
    }
    if (inv.numberKey && inv.numberSeq) {
      const s = await getSettings();
      const isQuote = inv.kind === 'quote';
      const rule = isQuote ? s.quoteNumbering : s.numbering;
      if (rule.counters[inv.numberKey] === inv.numberSeq) {
        const counters = { ...rule.counters, [inv.numberKey]: inv.numberSeq - 1 };
        await db.settings.put(isQuote ? { ...s, quoteNumbering: { ...rule, counters } } : { ...s, numbering: { ...rule, counters } });
      }
    }
  });
}

export function invoiceTemplateFields(src: Invoice): Partial<Invoice> {
  return {
    kind: src.kind,
    title: src.title,
    clientId: src.clientId,
    client: { ...src.client },
    items: src.items.map((i) => ({ ...i, id: uid() })),
    discount: { ...src.discount },
    tax: { ...src.tax },
    pph: { ...src.pph },
    adjustments: src.adjustments.map((a) => ({ ...a, id: uid() })),
    currency: src.currency,
    lang: src.lang,
    templateId: src.templateId,
    notes: src.notes,
    terms: src.terms,
    bankAccountIds: [...src.bankAccountIds],
    showQris: src.showQris,
  };
}

export async function duplicateInvoice(src: Invoice) {
  return createInvoice(invoiceTemplateFields(src));
}

export async function createRevision(src: Invoice) {
  const base = src.number.replace(/-R\d+$/, '');
  const siblings = await db.invoices.filter((i) => i.number.startsWith(base + '-R')).count();
  const now = Date.now();
  const rev: Invoice = {
    ...src,
    ...invoiceTemplateFields(src),
    id: uid(),
    number: `${base}-R${siblings + 1}`,
    numberKey: undefined,
    numberSeq: undefined,
    numberAuto: false,
    reference: src.reference,
    issueDate: src.issueDate,
    dueDate: src.dueDate,
    status: 'draft',
    payments: src.payments.map((p) => ({ ...p })),
    revisionOf: src.id,
    supersededBy: undefined,
    sentAt: undefined,
    quoteState: undefined,
    quoteDecidedAt: undefined,
    convertedTo: undefined,
    lastRemindedAt: undefined,
    remindCount: undefined,
    snoozeUntil: undefined,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', db.invoices, async () => {
    await db.invoices.put(rev);
    await db.invoices.update(src.id, { status: 'void', supersededBy: rev.id, updatedAt: now });
  });
  return rev;
}

export async function createSettlement(src: Invoice, label: string) {
  const t = computeTotals(src);
  const credited = t.paid > 0 ? t.paid : t.grandTotal;
  return createInvoice({
    ...invoiceTemplateFields(src),
    kind: 'invoice',
    items: [],
    adjustments: [{ id: uid(), label, kind: 'less', amount: credited }],
    reference: src.number,
  });
}

export async function decideQuote(id: string, state: 'accepted' | 'rejected') {
  await db.invoices.update(id, { quoteState: state, quoteDecidedAt: Date.now(), updatedAt: Date.now() });
}

export async function convertQuoteToInvoice(quote: Invoice): Promise<Invoice> {
  if (quote.convertedTo) throw new Error('Penawaran ini sudah dikonversi menjadi invoice.');
  const inv = await createInvoice({
    ...invoiceTemplateFields(quote),
    kind: 'invoice',
    issueDate: todayISO(),
    reference: quote.number,
  });
  await db.invoices.update(quote.id, {
    quoteState: 'accepted',
    quoteDecidedAt: Date.now(),
    convertedTo: inv.id,
    updatedAt: Date.now(),
  });
  return inv;
}

export async function reserveReceiptNumber(dateISO: string): Promise<string> {
  return db.transaction('rw', db.settings, async () => {
    const s = await getSettings();
    const rule = { ...s.receiptNumbering };
    const { number } = reserveNumber(rule, dateISO);
    await db.settings.put({ ...s, receiptNumbering: rule });
    return number;
  });
}

export function deriveStatus(inv: Invoice, today = todayISO()): Status {
  if (inv.status === 'void') return 'void';
  if (inv.kind === 'quote') {
    if (inv.quoteState === 'accepted') return 'accepted';
    if (inv.quoteState === 'rejected') return 'rejected';
    if (inv.status === 'draft') return 'draft';
    if (inv.dueDate && inv.dueDate < today) return 'expired';
    return 'sent';
  }
  const t = computeTotals(inv);
  if (t.paid > 0 && t.balance <= 0) return 'paid';
  if (inv.status === 'draft') return 'draft';
  if (inv.dueDate && inv.dueDate < today && t.balance > 0) return 'overdue';
  if (t.paid > 0) return 'partial';
  return 'sent';
}

export async function markReminded(id: string) {
  await db.transaction('rw', db.invoices, async () => {
    const inv = await db.invoices.get(id);
    if (!inv) return;
    const now = Date.now();
    await db.invoices.update(id, { lastRemindedAt: now, remindCount: (inv.remindCount ?? 0) + 1, updatedAt: now });
  });
}

export async function snoozeInvoice(id: string, days: number) {
  await db.invoices.update(id, { snoozeUntil: addDays(todayISO(), days), updatedAt: Date.now() });
}

export async function unsnoozeInvoice(id: string) {
  await db.invoices.update(id, { snoozeUntil: undefined, updatedAt: Date.now() });
}

export interface RecurrenceOptions {
  name: string;
  frequency: Frequency;
  interval: number;
  startDate: string;
  endDate?: string;
  dueDays: number;
}

export async function createRecurrence(inv: Invoice, opts: RecurrenceOptions): Promise<Recurrence> {
  const now = Date.now();
  const rec: Recurrence = {
    id: uid(),
    name: opts.name.trim() || inv.client.name || inv.number,
    active: true,
    frequency: opts.frequency,
    interval: Math.max(1, opts.interval),
    startDate: opts.startDate,
    endDate: opts.endDate || undefined,
    nextRun: opts.startDate,
    dueDays: Math.max(0, opts.dueDays),
    runCount: 0,
    template: {
      kind: inv.kind,
      title: inv.title,
      clientId: inv.clientId,
      client: { ...inv.client },
      items: inv.items.map((i) => ({ ...i, id: uid() })),
      discount: { ...inv.discount },
      tax: { ...inv.tax },
      pph: { ...inv.pph },
      adjustments: inv.adjustments.map((a) => ({ ...a, id: uid() })),
      currency: inv.currency,
      lang: inv.lang,
      templateId: inv.templateId,
      notes: inv.notes,
      terms: inv.terms,
      bankAccountIds: [...inv.bankAccountIds],
      showQris: inv.showQris,
    },
    createdAt: now,
    updatedAt: now,
  };
  await db.recurrences.put(rec);
  return rec;
}

let runningRecurrences: Promise<number> | null = null;

// Runs only while the app is open (a PWA has no background scheduler) and creates drafts, never sent invoices.
export function runDueRecurrences(): Promise<number> {
  if (runningRecurrences) return runningRecurrences;
  runningRecurrences = (async () => {
    const today = todayISO();
    const due = (await db.recurrences.where('nextRun').belowOrEqual(today).toArray()).filter((r) => r.active).slice(0, 24);
    let created = 0;

    for (const rec of due) {
      let guard = 0;
      while (guard < 12) {
        // Claim the occurrence first, so a second tab cannot create the same period twice.
        const claimed = await db.transaction('rw', db.recurrences, async () => {
          const cur = await db.recurrences.get(rec.id);
          if (!cur || !cur.active || cur.nextRun > today) return null;
          if (cur.endDate && cur.nextRun > cur.endDate) {
            await db.recurrences.update(cur.id, { active: false, updatedAt: Date.now() });
            return null;
          }
          const issueDate = cur.nextRun;
          const nextRun = advance(issueDate, cur.frequency, cur.interval, cur.startDate);
          await db.recurrences.update(cur.id, {
            nextRun,
            active: cur.endDate ? nextRun <= cur.endDate : true,
            lastRun: today,
            runCount: cur.runCount + 1,
            updatedAt: Date.now(),
          });
          return { template: cur.template, dueDays: cur.dueDays, issueDate };
        });
        if (!claimed) break;

        try {
          await createInvoice({
            ...claimed.template,
            issueDate: claimed.issueDate,
            dueDate: addDays(claimed.issueDate, claimed.dueDays),
          });
          created += 1;
        } catch {
          break;
        }
        guard += 1;
      }
    }

    return created;
  })().finally(() => {
    runningRecurrences = null;
  });
  return runningRecurrences;
}

export async function runRecurrenceNow(rec: Recurrence): Promise<Invoice> {
  const today = todayISO();
  const inv = await createInvoice({
    ...rec.template,
    issueDate: today,
    dueDate: addDays(today, rec.dueDays),
  });
  await db.recurrences.update(rec.id, { lastRun: today, runCount: rec.runCount + 1, updatedAt: Date.now() });
  return inv;
}

export async function skipNextRecurrence(rec: Recurrence) {
  const nextRun = advance(rec.nextRun, rec.frequency, rec.interval, rec.startDate);
  const active = rec.endDate ? nextRun <= rec.endDate : true;
  await db.recurrences.update(rec.id, { nextRun, active, updatedAt: Date.now() });
}

export async function toggleRecurrence(id: string, active: boolean) {
  await db.recurrences.update(id, { active, updatedAt: Date.now() });
}

export async function deleteRecurrence(id: string) {
  await db.recurrences.delete(id);
}

export async function requestPersistentStorage(): Promise<boolean | undefined> {
  if (!navigator.storage?.persist) return undefined;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

import Dexie, { type Table } from 'dexie';
import type { Client, Invoice, NumberingRule, Product, Settings, Status, TemplateConfig } from './types';
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, normalizeTemplate } from './templates';
import { addDays, todayISO, uid } from './lib/id';
import { clientCode, formatNumberPattern, periodKey } from './lib/numbering';
import { computeTotals } from './lib/money';

class InvoiceDB extends Dexie {
  invoices!: Table<Invoice, string>;
  clients!: Table<Client, string>;
  templates!: Table<TemplateConfig, string>;
  settings!: Table<Settings, string>;
  products!: Table<Product, string>;

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
    const numbering = { ...s.numbering };
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
    await db.settings.put({ ...s, numbering });
    await db.invoices.put(inv);
    return inv;
  });
}

// Payments and status are changed from the invoice screen, so the editor's copy of them may be stale and must not win.
export async function saveEditedInvoice(inv: Invoice): Promise<boolean> {
  return db.transaction('rw', db.invoices, async () => {
    const cur = await db.invoices.get(inv.id);
    if (!cur) return false;
    await db.invoices.put({ ...inv, payments: cur.payments, status: cur.status, sentAt: cur.sentAt, supersededBy: cur.supersededBy });
    return true;
  });
}

// Moving the issue date into another period takes a number from that period and returns the old one if it was the last.
export async function renumberForDate(inv: Invoice): Promise<Partial<Invoice> | null> {
  if (!inv.numberAuto || !inv.numberSeq || !inv.numberKey) return null;
  return db.transaction('rw', db.settings, async () => {
    const s = await getSettings();
    const rule = { ...s.numbering };
    const code = inv.client.name ? clientCode(inv.client.name) : '';
    if (periodKey(rule, inv.issueDate) === inv.numberKey) {
      const number = formatNumberPattern(rule.format, inv.issueDate, inv.numberSeq!, code);
      return number === inv.number ? null : { number };
    }
    if (rule.counters[inv.numberKey!] === inv.numberSeq) {
      rule.counters = { ...rule.counters, [inv.numberKey!]: inv.numberSeq! - 1 };
    }
    const r = reserveNumber(rule, inv.issueDate, code);
    await db.settings.put({ ...s, numbering: rule });
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
      if (s.numbering.counters[inv.numberKey] === inv.numberSeq) {
        const counters = { ...s.numbering.counters, [inv.numberKey]: inv.numberSeq - 1 };
        await db.settings.put({ ...s, numbering: { ...s.numbering, counters } });
      }
    }
  });
}

function copyFields(src: Invoice): Partial<Invoice> {
  return {
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
  return createInvoice(copyFields(src));
}

export async function createRevision(src: Invoice) {
  const base = src.number.replace(/-R\d+$/, '');
  const siblings = await db.invoices.filter((i) => i.number.startsWith(base + '-R')).count();
  const now = Date.now();
  const rev: Invoice = {
    ...src,
    ...copyFields(src),
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
    ...copyFields(src),
    items: [],
    adjustments: [{ id: uid(), label, kind: 'less', amount: credited }],
    reference: src.number,
  });
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
  const t = computeTotals(inv);
  if (t.paid > 0 && t.balance <= 0) return 'paid';
  if (inv.status === 'draft') return 'draft';
  if (inv.dueDate && inv.dueDate < today && t.balance > 0) return 'overdue';
  if (t.paid > 0) return 'partial';
  return 'sent';
}

// A draft nobody has filled in yet: no client and no item with a description or price.
export function isBlank(inv: Pick<Invoice, 'client' | 'items'>): boolean {
  return !inv.client.name.trim() && inv.items.every((i) => !i.description.trim() && !i.price);
}

// Where a click on an invoice in the list should land. Only a blank draft goes straight to the editor;
// anything with content opens the view, and the editor stays one click away from there.
export function invoiceHref(inv: Pick<Invoice, 'id' | 'status' | 'client' | 'items'>): string {
  return inv.status === 'draft' && isBlank(inv) ? `/invoice/${inv.id}/edit` : `/invoice/${inv.id}`;
}

export async function requestPersistentStorage(): Promise<boolean | undefined> {
  if (!navigator.storage?.persist) return undefined;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

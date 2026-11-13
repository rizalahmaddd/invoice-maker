import type { Invoice, Status } from '../types';
import { deriveStatus } from '../db';
import { computeTotals } from './money';
import { daysBetween } from './id';

export interface MonthPoint {
  month: number;
  billed: number;
  received: number;
  count: number;
}

export interface AgingBucket {
  label: string;
  value: number;
  count: number;
}

export interface ClientTotal {
  name: string;
  clientId?: string;
  value: number;
  count: number;
}

export interface StatusSlice {
  status: Status;
  count: number;
  value: number;
}

export interface TaxMonth {
  month: number;
  dpp: number;
  vat: number;
  pph: number;
  count: number;
}

export interface CollectionStats {
  billed: number;
  received: number;
  outstanding: number;
  rate: number;
  dso: number | null;
}

function isMoneyInvoice(inv: Invoice, currency: string) {
  return inv.kind !== 'quote' && inv.status !== 'void' && inv.currency === currency;
}

export function monthlySeries(invoices: Invoice[], year: string, currency: string): MonthPoint[] {
  const months = Array.from({ length: 12 }, (_, month) => ({ month, billed: 0, received: 0, count: 0 }));
  for (const inv of invoices) {
    if (!isMoneyInvoice(inv, currency)) continue;
    if (inv.status !== 'draft' && inv.issueDate.startsWith(year)) {
      const m = months[Number(inv.issueDate.slice(5, 7)) - 1];
      m.billed += computeTotals(inv).grandTotal;
      m.count += 1;
    }
    for (const p of inv.payments) {
      if (p.date.startsWith(year)) months[Number(p.date.slice(5, 7)) - 1].received += p.amount;
    }
  }
  return months;
}

const AGING_BUCKETS = [
  { label: 'Belum jatuh tempo / 0–30', min: 0, max: 30 },
  { label: '31–60 hari', min: 31, max: 60 },
  { label: '61–90 hari', min: 61, max: 90 },
  { label: 'Lebih dari 90 hari', min: 91, max: Number.POSITIVE_INFINITY },
];

// Receivable age is counted from the due date, so anything not yet due sits in the first bucket.
export function agingBuckets(invoices: Invoice[], today: string, currency: string): AgingBucket[] {
  const buckets = AGING_BUCKETS.map((b) => ({ label: b.label, min: b.min, max: b.max, value: 0, count: 0 }));
  for (const inv of invoices) {
    if (!isMoneyInvoice(inv, currency)) continue;
    const status = deriveStatus(inv, today);
    if (!['sent', 'partial', 'overdue'].includes(status)) continue;
    const balance = computeTotals(inv).balance;
    if (balance <= 0) continue;
    const days = inv.dueDate ? Math.max(0, daysBetween(inv.dueDate, today)) : 0;
    const bucket = buckets.find((b) => days >= b.min && days <= b.max) ?? buckets[0];
    bucket.value += balance;
    bucket.count += 1;
  }
  return buckets.map(({ label, value, count }) => ({ label, value, count }));
}

export function topClients(invoices: Invoice[], year: string, currency: string, limit = 5): ClientTotal[] {
  const map = new Map<string, ClientTotal>();
  for (const inv of invoices) {
    if (!isMoneyInvoice(inv, currency)) continue;
    if (inv.status === 'draft' || !inv.issueDate.startsWith(year)) continue;
    const key = inv.clientId ?? inv.client.name.trim().toLowerCase();
    const row = map.get(key) ?? { name: inv.client.name || 'Tanpa nama', clientId: inv.clientId, value: 0, count: 0 };
    row.value += computeTotals(inv).grandTotal;
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

const STATUS_ORDER: Status[] = ['draft', 'sent', 'partial', 'overdue', 'paid', 'void'];

export function statusBreakdown(invoices: Invoice[], today: string): StatusSlice[] {
  const map = new Map<Status, StatusSlice>();
  for (const inv of invoices) {
    if (inv.kind === 'quote') continue;
    const status = deriveStatus(inv, today);
    const row = map.get(status) ?? { status, count: 0, value: 0 };
    row.count += 1;
    row.value += computeTotals(inv).grandTotal;
    map.set(status, row);
  }
  return STATUS_ORDER.filter((status) => map.has(status)).map((status) => map.get(status)!);
}

export function taxSummary(invoices: Invoice[], year: string, currency: string) {
  const months: TaxMonth[] = Array.from({ length: 12 }, (_, month) => ({ month, dpp: 0, vat: 0, pph: 0, count: 0 }));
  for (const inv of invoices) {
    if (!isMoneyInvoice(inv, currency)) continue;
    if (inv.status === 'draft' || !inv.issueDate.startsWith(year)) continue;
    const t = computeTotals(inv);
    if (t.tax <= 0 && t.pph <= 0) continue;
    const m = months[Number(inv.issueDate.slice(5, 7)) - 1];
    m.dpp += t.taxBase;
    m.vat += t.tax;
    m.pph += t.pph;
    m.count += 1;
  }
  const total = months.reduce(
    (a, m) => ({ dpp: a.dpp + m.dpp, vat: a.vat + m.vat, pph: a.pph + m.pph, count: a.count + m.count }),
    { dpp: 0, vat: 0, pph: 0, count: 0 },
  );
  return { months, total };
}

export function collectionStats(invoices: Invoice[], year: string, currency: string, today: string): CollectionStats {
  let billed = 0;
  let received = 0;
  let outstanding = 0;
  let weightedDays = 0;
  let weight = 0;

  for (const inv of invoices) {
    if (!isMoneyInvoice(inv, currency)) continue;
    const t = computeTotals(inv);
    if (inv.status !== 'draft' && inv.issueDate.startsWith(year)) billed += t.grandTotal;
    for (const p of inv.payments) {
      if (!p.date.startsWith(year)) continue;
      received += p.amount;
      weightedDays += Math.max(0, daysBetween(inv.issueDate, p.date)) * p.amount;
      weight += p.amount;
    }
    const status = deriveStatus(inv, today);
    if (['sent', 'partial', 'overdue'].includes(status)) outstanding += t.balance;
  }

  return {
    billed,
    received,
    outstanding,
    rate: billed > 0 ? (received / billed) * 100 : 0,
    dso: weight > 0 ? weightedDays / weight : null,
  };
}

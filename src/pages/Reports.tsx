import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deriveStatus } from '../db';
import { useSettings } from '../hooks';
import { computeTotals, formatMoney } from '../lib/money';
import { todayISO } from '../lib/id';
import { downloadFile } from '../lib/files';
import { agingBuckets, collectionStats, monthlySeries, statusBreakdown, taxSummary, topClients } from '../lib/analytics';
import type { Status } from '../types';
import { STATUS_META, PageHeader } from '../components/layout';
import { BarPairChart, BucketBars, Donut, HBarList } from '../components/charts';
import { Button, Card, EmptyState, Field, Loading, Select } from '../components/ui';
import { IconDownload } from '../components/icons';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const STATUS_TONES: Record<Status, string> = {
  draft: 'var(--muted)',
  sent: 'var(--clay)',
  partial: 'var(--warn)',
  paid: 'var(--ok)',
  overdue: 'var(--danger)',
  void: 'var(--line)',
  accepted: 'var(--ok)',
  rejected: 'var(--danger)',
  expired: 'var(--warn)',
};

function csvCell(v: string | number) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function Reports() {
  const settings = useSettings();
  const invoices = useLiveQuery(() => db.invoices.toArray(), []);
  const today = todayISO();
  const [year, setYear] = useState(today.slice(0, 4));
  const [picked, setPicked] = useState<string>();
  const currency = picked ?? settings?.defaults.currency ?? 'IDR';

  const years = useMemo(() => {
    const set = new Set([today.slice(0, 4)]);
    for (const inv of invoices ?? []) {
      set.add(inv.issueDate.slice(0, 4));
      for (const p of inv.payments) set.add(p.date.slice(0, 4));
    }
    return [...set].sort().reverse();
  }, [invoices, today]);

  const currencies = useMemo(() => {
    const set = new Set([settings?.defaults.currency ?? 'IDR']);
    for (const inv of invoices ?? []) set.add(inv.currency);
    return [...set];
  }, [invoices, settings?.defaults.currency]);

  const report = useMemo(() => {
    const months = monthlySeries(invoices ?? [], year, currency);
    const debtors = new Map<string, { name: string; clientId?: string; balance: number; overdue: number; count: number }>();
    for (const inv of invoices ?? []) {
      if (inv.kind === 'quote' || inv.currency !== currency || inv.status === 'void') continue;
      const status = deriveStatus(inv, today);
      if (status === 'sent' || status === 'partial' || status === 'overdue') {
        const t = computeTotals(inv);
        const key = inv.clientId ?? inv.client.name.trim().toLowerCase();
        const d = debtors.get(key) ?? { name: inv.client.name || 'Tanpa nama', clientId: inv.clientId, balance: 0, overdue: 0, count: 0 };
        d.balance += t.balance;
        if (status === 'overdue') d.overdue += t.balance;
        d.count += 1;
        debtors.set(key, d);
      }
    }
    const total = months.reduce(
      (a, m) => ({ billed: a.billed + m.billed, received: a.received + m.received, count: a.count + m.count }),
      { billed: 0, received: 0, count: 0 },
    );
    return { months, total, debtors: [...debtors.values()].filter((d) => d.balance > 0).sort((a, b) => b.balance - a.balance) };
  }, [invoices, currency, year, today]);

  const stats = useMemo(() => collectionStats(invoices ?? [], year, currency, today), [invoices, year, currency, today]);
  const aging = useMemo(() => agingBuckets(invoices ?? [], today, currency), [invoices, today, currency]);
  const clients = useMemo(() => topClients(invoices ?? [], year, currency, 5), [invoices, year, currency]);
  const statuses = useMemo(() => statusBreakdown(invoices ?? [], today), [invoices, today]);
  const tax = useMemo(() => taxSummary(invoices ?? [], year, currency), [invoices, year, currency]);
  const invoiceCount = statuses.reduce((a, s) => a + s.count, 0);

  const quoteStats = useMemo(() => {
    let waiting = 0;
    let accepted = 0;
    let rejected = 0;
    let draft = 0;
    let value = 0;
    for (const inv of invoices ?? []) {
      if (inv.kind !== 'quote' || inv.currency !== currency) continue;
      const status = deriveStatus(inv, today);
      if (status === 'sent' || status === 'expired') waiting += 1;
      else if (status === 'accepted') accepted += 1;
      else if (status === 'rejected') rejected += 1;
      else if (status === 'draft') draft += 1;
      if (status !== 'draft' && status !== 'void') value += computeTotals(inv).grandTotal;
    }
    const decided = accepted + rejected;
    return { waiting, accepted, rejected, draft, value, rate: decided > 0 ? Math.round((accepted / decided) * 100) : 0 };
  }, [invoices, currency, today]);

  const exportCsv = () => {
    const head = ['Nomor', 'Tanggal', 'Jatuh tempo', 'Klien', 'NPWP klien', 'Referensi', 'Status', 'Mata uang', 'Subtotal', 'Diskon', 'DPP', 'PPN', 'PPh', 'Penyesuaian', 'Total', 'Dibayar', 'Sisa'];
    const rows = (invoices ?? [])
      .filter((inv) => inv.kind !== 'quote' && inv.issueDate.startsWith(year))
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number))
      .map((inv) => {
        const t = computeTotals(inv);
        return [inv.number, inv.issueDate, inv.dueDate, inv.client.name, inv.client.taxId, inv.reference, STATUS_META[deriveStatus(inv, today)].label, inv.currency, t.subtotal, t.discount, t.taxBase, t.tax, t.pph, t.adjustments, t.grandTotal, t.paid, t.balance];
      });
    const csv = [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    // The BOM makes Excel open the file as UTF-8 instead of mangling client names.
    downloadFile(new File(['﻿' + csv], `invoice-${year}.csv`, { type: 'text/csv' }));
  };

  const exportTaxCsv = () => {
    const head = ['Nomor', 'Tanggal', 'Klien', 'NPWP', 'Mata uang', 'DPP', 'PPN', 'PPh', 'Total'];
    const rows = (invoices ?? [])
      .filter((inv) => inv.kind !== 'quote' && inv.currency === currency && inv.issueDate.startsWith(year) && inv.status !== 'draft' && inv.status !== 'void')
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number))
      .map((inv) => ({ inv, t: computeTotals(inv) }))
      .filter(({ t }) => t.tax > 0 || t.pph > 0)
      .map(({ inv, t }) => [inv.number, inv.issueDate, inv.client.name, inv.client.taxId, inv.currency, t.taxBase, t.tax, t.pph, t.grandTotal]);
    const csv = [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    downloadFile(new File(['﻿' + csv], `pajak-${year}.csv`, { type: 'text/csv' }));
  };

  if (!invoices || !settings) return <Loading />;

  const money = (v: number) => formatMoney(v, currency);

  return (
    <>
      <PageHeader
        title="Laporan"
        sub="Arus kas, piutang, dan rekap pajak"
        actions={
          <Button onClick={exportCsv} disabled={invoices.length === 0}>
            <IconDownload size={18} /> Ekspor CSV {year}
          </Button>
        }
      />

      {invoices.length === 0 ? (
        <EmptyState title="Belum ada data" body="Laporan muncul setelah ada invoice yang dibuat." />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Field label="Tahun" htmlFor="r-year">
              <Select id="r-year" value={year} onChange={(e) => setYear(e.target.value)}>
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </Select>
            </Field>
            <Field label="Mata uang" htmlFor="r-cur">
              <Select id="r-cur" value={currency} onChange={(e) => setPicked(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>

          <section aria-label="Ringkasan laporan" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={`Ditagih ${year}`} value={money(stats.billed)} hint={`${report.total.count} invoice`} />
            <Stat label="Diterima" value={money(stats.received)} hint={`${Math.round(stats.rate)}% dari nilai ditagih`} tone="text-ok" />
            <Stat label="Piutang berjalan" value={money(stats.outstanding)} hint="Semua invoice yang belum lunas" />
            <Stat label="Rata-rata hari bayar" value={stats.dso === null ? '—' : `${Math.round(stats.dso)} hari`} hint="Dari tanggal invoice ke pembayaran" />
          </section>

          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-bold">Arus kas {year}</h2>
              <p className="text-xs text-muted">Ditagih dari tanggal invoice terkirim, diterima dari tanggal pembayaran.</p>
            </div>
            <div className="mt-4">
              <BarPairChart
                data={report.months.map((m) => ({ label: MONTHS[m.month], a: m.billed, b: m.received }))}
                aLabel="Ditagih"
                bLabel="Diterima"
                format={money}
              />
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 text-[15px] font-bold">Komposisi status</h2>
              <Donut
                segments={statuses.map((s) => ({ label: STATUS_META[s.status].label, value: s.count, tone: STATUS_TONES[s.status] }))}
                centerLabel="Invoice"
                centerValue={String(invoiceCount)}
              />
            </Card>

            <Card>
              <h2 className="mb-1 text-[15px] font-bold">Umur piutang</h2>
              <p className="mb-3 text-xs text-muted">Dihitung dari tanggal jatuh tempo, dalam {currency}.</p>
              <BucketBars buckets={aging} format={money} />
            </Card>
          </div>

          <Card>
            <h2 className="mb-1 text-[15px] font-bold">Klien teratas {year}</h2>
            <p className="mb-3 text-xs text-muted">Berdasarkan total nilai invoice, dalam {currency}.</p>
            <HBarList
              rows={clients.map((c) => ({
                label: c.name,
                value: c.value,
                href: c.clientId ? `/?klien=${c.clientId}` : undefined,
                sub: `${c.count} invoice`,
              }))}
              format={money}
            />
          </Card>

          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-bold">Penawaran</h2>
              <p className="text-xs text-muted">Tingkat konversi {quoteStats.rate}%</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Menunggu" value={quoteStats.waiting} />
              <MiniStat label="Diterima" value={quoteStats.accepted} tone="text-ok" />
              <MiniStat label="Ditolak" value={quoteStats.rejected} tone="text-danger" />
              <MiniStat label="Draft" value={quoteStats.draft} />
            </div>
            <p className="mt-3 text-xs text-muted">
              Nilai penawaran terkirim {money(quoteStats.value)}, dalam {currency}. Penawaran tidak dihitung sebagai pendapatan
              sampai menjadi invoice.
            </p>
            <Link to="/?jenis=penawaran" className="mt-2 inline-block text-sm font-semibold text-clay hover:underline">
              Buka daftar penawaran →
            </Link>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-bold">Rekap pajak {year}</h2>
                <p className="text-xs text-muted">PPN keluaran dan PPh yang dipotong, untuk pembukuan atau SPT.</p>
              </div>
              <Button size="sm" onClick={exportTaxCsv} disabled={tax.total.count === 0}>
                <IconDownload size={16} /> Ekspor CSV pajak
              </Button>
            </div>
            <div className="custom-scrollbar mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-y border-line bg-sunken/60 text-left text-xs font-bold tracking-wider text-muted uppercase">
                    <th className="px-4 py-2.5">Bulan</th>
                    <th className="px-4 py-2.5 text-right">Invoice</th>
                    <th className="px-4 py-2.5 text-right">DPP</th>
                    <th className="px-4 py-2.5 text-right">PPN</th>
                    <th className="px-4 py-2.5 text-right">PPh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {tax.months.map((m, i) => (
                    <tr key={i} className={m.count ? '' : 'text-muted'}>
                      <td className="px-4 py-2.5">{MONTHS[i]}</td>
                      <td className="num px-4 py-2.5 text-right">{m.count || '-'}</td>
                      <td className="num px-4 py-2.5 text-right">{m.dpp ? money(m.dpp) : '-'}</td>
                      <td className="num px-4 py-2.5 text-right">{m.vat ? money(m.vat) : '-'}</td>
                      <td className="num px-4 py-2.5 text-right">{m.pph ? money(m.pph) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line font-bold">
                    <td className="px-4 py-3">Total</td>
                    <td className="num px-4 py-3 text-right">{tax.total.count}</td>
                    <td className="num px-4 py-3 text-right">{money(tax.total.dpp)}</td>
                    <td className="num px-4 py-3 text-right">{money(tax.total.vat)}</td>
                    <td className="num px-4 py-3 text-right">{money(tax.total.pph)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Rekap untuk pembukuan/SPT, bukan file e-Faktur resmi.</p>
          </Card>

          <Card className="p-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
              <h2 className="text-[15px] font-bold">Per bulan, {year}</h2>
              <p className="text-xs text-muted">Ditagih dihitung dari tanggal invoice terkirim, diterima dari tanggal pembayaran.</p>
            </div>
            <div className="custom-scrollbar mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="border-y border-line bg-sunken/60 text-left text-xs font-bold tracking-wider text-muted uppercase">
                    <th className="px-4 py-2.5">Bulan</th>
                    <th className="px-4 py-2.5 text-right">Invoice</th>
                    <th className="px-4 py-2.5 text-right">Ditagih</th>
                    <th className="px-4 py-2.5 text-right">Diterima</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {report.months.map((m, i) => (
                    <tr key={i} className={m.count || m.received ? '' : 'text-muted'}>
                      <td className="px-4 py-2.5">{MONTHS[i]}</td>
                      <td className="num px-4 py-2.5 text-right">{m.count || '-'}</td>
                      <td className="num px-4 py-2.5 text-right">{m.billed ? money(m.billed) : '-'}</td>
                      <td className="num px-4 py-2.5 text-right">{m.received ? money(m.received) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line font-bold">
                    <td className="px-4 py-3">Total</td>
                    <td className="num px-4 py-3 text-right">{report.total.count}</td>
                    <td className="num px-4 py-3 text-right">{money(report.total.billed)}</td>
                    <td className="num px-4 py-3 text-right text-ok">{money(report.total.received)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 text-[15px] font-bold">Piutang per klien</h2>
            <p className="mb-3 text-xs text-muted">Semua invoice yang belum lunas sampai hari ini, dalam {currency}.</p>
            {report.debtors.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">Tidak ada piutang. Semua sudah lunas.</p>
            ) : (
              <ul className="divide-y divide-line">
                {report.debtors.map((d) => (
                  <li key={d.clientId ?? d.name} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      {d.clientId ? (
                        <Link to={`/?klien=${d.clientId}`} className="block truncate font-semibold hover:text-clay hover:underline">
                          {d.name}
                        </Link>
                      ) : (
                        <p className="truncate font-semibold">{d.name}</p>
                      )}
                      <p className="text-xs text-muted">{d.count} invoice</p>
                    </div>
                    <div className="num shrink-0 text-right">
                      <p className="font-bold">{money(d.balance)}</p>
                      {d.overdue > 0 && <p className="text-xs font-semibold text-danger">{money(d.overdue)} lewat tempo</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, hint, tone = 'text-text' }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`num mt-1 text-xl font-extrabold tracking-tight ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function MiniStat({ label, value, tone = 'text-text' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl bg-sunken px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={`num text-lg font-extrabold ${tone}`}>{value}</p>
    </div>
  );
}

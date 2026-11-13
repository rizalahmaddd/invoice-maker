import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { createInvoice, db, deriveStatus, invoiceHref } from '../db';
import { useSettings, useStoredState, useWide } from '../hooks';
import { computeTotals, formatMoney } from '../lib/money';
import { formatDate } from '../lib/labels';
import { daysBetween, todayISO } from '../lib/id';
import type { Invoice, Status } from '../types';
import { PageHeader, StatusStamp } from '../components/layout';
import { Button, EmptyState, Loading, TextInput, useUI } from '../components/ui';
import { IconChevronDown, IconDownload, IconEdit, IconGrid, IconPlus, IconSearch, IconTable } from '../components/icons';

type Filter = 'all' | 'unpaid' | Status;
type SortBy = 'updated' | 'date_desc' | 'amount_desc' | 'due_asc' | 'client_asc';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'unpaid', label: 'Belum lunas' },
  { value: 'overdue', label: 'Lewat tempo' },
  { value: 'draft', label: 'Draft' },
  { value: 'paid', label: 'Lunas' },
  { value: 'void', label: 'Batal' },
];

type Sums = Map<string, number>;

function addTo(m: Sums, currency: string, v: number) {
  m.set(currency, (m.get(currency) ?? 0) + v);
}

// Invoices in different currencies can't be added up, so each currency gets its own figure, default currency first.
function MoneySums({ sums, primary, className = '' }: { sums: Sums; primary: string; className?: string }) {
  const entries = [...sums.entries()].filter(([c, v]) => v !== 0 || c === primary);
  if (!entries.length) entries.push([primary, 0]);
  entries.sort(([a], [b]) => (a === primary ? -1 : b === primary ? 1 : a.localeCompare(b)));
  const [[c0, v0], ...rest] = entries;
  return (
    <>
      <span className={`num mt-2 block text-xl font-extrabold tracking-tight lg:text-2xl ${className}`}>{formatMoney(v0, c0)}</span>
      {rest.length > 0 && <span className={`num mt-0.5 block truncate text-xs font-semibold ${className}`}>+ {rest.map(([c, v]) => formatMoney(v, c)).join(' + ')}</span>}
    </>
  );
}

const BACKUP_REMIND_DAYS = 14;

export function InvoiceList() {
  const navigate = useNavigate();
  const { toast } = useUI();
  const settings = useSettings();
  const invoices = useLiveQuery(() => db.invoices.orderBy('updatedAt').reverse().toArray(), []);
  const [filter, setFilter] = useStoredState<Filter>('list_filter', 'all', 'session');
  const [sortBy, setSortBy] = useStoredState<SortBy>('list_sort', 'updated', 'session');
  const [q, setQ] = useStoredState('list_q', '', 'session');
  const [savedView, setViewMode] = useStoredState<'table' | 'cards'>('list_view', 'table');
  const viewMode = useWide('(min-width: 768px)') ? savedView : 'cards';
  const [params, setParams] = useSearchParams();
  const clientFilter = params.get('klien');
  const clientName = useLiveQuery(async () => (clientFilter ? (await db.clients.get(clientFilter))?.name ?? 'klien terhapus' : ''), [clientFilter]);
  const [creating, setCreating] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const today = todayISO();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);


  const rows = useMemo(
    () =>
      (invoices ?? [])
        .filter((inv) => !clientFilter || inv.clientId === clientFilter)
        .map((inv) => ({ inv, status: deriveStatus(inv, today), totals: computeTotals(inv) })),
    [invoices, today, clientFilter],
  );

  const metrics = useMemo(() => {
    const unpaidTotal: Sums = new Map();
    let unpaidCount = 0;
    const overdueTotal: Sums = new Map();
    let overdueCount = 0;
    const paidTotal: Sums = new Map();
    let paidCount = 0;
    let draftCount = 0;
    const cur = settings?.defaults.currency || 'IDR';

    for (const r of rows) {
      const c = r.inv.currency;
      if (['sent', 'partial', 'overdue'].includes(r.status)) {
        addTo(unpaidTotal, c, r.totals.balance);
        unpaidCount += 1;
      }
      if (r.status === 'overdue') {
        addTo(overdueTotal, c, r.totals.balance);
        overdueCount += 1;
      }
      if (r.status === 'paid') {
        addTo(paidTotal, c, r.totals.grandTotal);
        paidCount += 1;
      }
      if (r.status === 'draft') {
        draftCount += 1;
      }
    }

    return {
      cur,
      unpaidTotal,
      unpaidCount,
      overdueTotal,
      overdueCount,
      paidTotal,
      paidCount,
      draftCount,
      totalCount: rows.length,
    };
  }, [rows, settings?.defaults.currency]);

  // Counts for filter pills
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, unpaid: 0, overdue: 0, draft: 0, paid: 0, sent: 0, partial: 0, void: 0 };
    for (const r of rows) {
      if (['sent', 'partial', 'overdue'].includes(r.status)) c.unpaid += 1;
      if (r.status in c) c[r.status] += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (filter === 'unpaid' && !['sent', 'partial', 'overdue'].includes(r.status)) return false;
      if (filter !== 'all' && filter !== 'unpaid' && r.status !== filter) return false;
      if (q.trim()) {
        const s = q.trim().toLowerCase();
        const digits = s.replace(/[.,\s]/g, '');
        return (
          r.inv.number.toLowerCase().includes(s) ||
          r.inv.client.name.toLowerCase().includes(s) ||
          r.inv.client.contactPerson.toLowerCase().includes(s) ||
          r.inv.reference.toLowerCase().includes(s) ||
          r.inv.items.some((i) => i.description.toLowerCase().includes(s)) ||
          (/^\d{3,}$/.test(digits) && String(Math.round(r.totals.grandTotal)).includes(digits))
        );
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortBy === 'date_desc') return b.inv.issueDate.localeCompare(a.inv.issueDate);
      if (sortBy === 'amount_desc') return b.totals.grandTotal - a.totals.grandTotal;
      if (sortBy === 'due_asc') return (a.inv.dueDate || '9999').localeCompare(b.inv.dueDate || '9999');
      if (sortBy === 'client_asc') return (a.inv.client.name || '').localeCompare(b.inv.client.name || '');
      return (b.inv.updatedAt || 0) - (a.inv.updatedAt || 0);
    });
  }, [rows, filter, q, sortBy]);

  const newInvoice = async () => {
    setCreating(true);
    try {
      const inv = await createInvoice();
      navigate(`/invoice/${inv.id}/edit`, { state: { fresh: true } });
    } catch (e) {
      toast(`Gagal membuat invoice: ${(e as Error).message}`, 'error');
      setCreating(false);
    }
  };

  const needsProfile = settings && !settings.business.name;
  const backupDue =
    settings &&
    (invoices?.length ?? 0) > 0 &&
    (!settings.lastBackupAt || Date.now() - settings.lastBackupAt > BACKUP_REMIND_DAYS * 86400000);

  return (
    <>
      <PageHeader
        title="Daftar Invoice"
        sub={`${rows.length} invoice tercatat di perangkat`}
      />


      {needsProfile && (
        <Link
          to="/pengaturan"
          className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-clay/30 bg-clay-soft/60 p-4 transition-all hover:border-clay hover:bg-clay-soft"
        >
          <div>
            <p className="text-sm font-bold text-text">Lengkapi profil usaha kamu</p>
            <p className="mt-0.5 text-xs text-muted sm:text-sm">
              Nama bisnis, logo, nomor rekening bank, dan tanda tangan akan otomatis tampil di setiap invoice dan PDF.
            </p>
          </div>
          <span className="shrink-0 rounded-xl bg-clay px-3 py-1.5 text-xs font-bold text-white shadow-xs">
            Isi Sekarang →
          </span>
        </Link>
      )}

      {clientFilter && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 text-sm">
          <span>
            Menampilkan invoice untuk <b>{clientName}</b>
          </span>
          <Button size="sm" onClick={() => setParams({})}>
            Semua klien
          </Button>
        </div>
      )}

      {rows.length > 0 && (
        <section aria-label="Ringkasan piutang & status" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard active={filter === 'unpaid'} onClick={() => setFilter('unpaid')} label="Belum Lunas" stamp="stamp-partial" count={metrics.unpaidCount} hint="Menunggu pembayaran klien">
            <MoneySums sums={metrics.unpaidTotal} primary={metrics.cur} />
          </KpiCard>
          <KpiCard active={filter === 'overdue'} onClick={() => setFilter('overdue')} label="Lewat Jatuh Tempo" tone="text-danger" stamp="stamp-overdue" count={metrics.overdueCount} hint="Perlu difollow-up segera">
            <MoneySums sums={metrics.overdueTotal} primary={metrics.cur} className="text-danger" />
          </KpiCard>
          <KpiCard active={filter === 'paid'} onClick={() => setFilter('paid')} label="Sudah Lunas" tone="text-ok" stamp="stamp-paid" count={metrics.paidCount} hint="Total penerimaan tercatat">
            <MoneySums sums={metrics.paidTotal} primary={metrics.cur} className="text-ok" />
          </KpiCard>
          <KpiCard active={filter === 'all'} onClick={() => setFilter('all')} label="Semua Invoice" stamp="stamp-draft" count={metrics.totalCount} hint={`${metrics.draftCount} status draft tersimpan`}>
            <span className="num mt-2 block text-xl font-extrabold tracking-tight lg:text-2xl">
              {metrics.totalCount} <span className="text-sm font-medium text-muted">dokumen</span>
            </span>
          </KpiCard>
        </section>
      )}

      {backupDue && (
        <Link
          to="/pengaturan#backup"
          className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 text-sm transition-colors hover:bg-sunken"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex size-2 rounded-full bg-warn" />
            <span>
              <span className="font-bold">Data tersimpan lokal di perangkat ini.</span>{' '}
              <span className="text-muted">
                {settings?.lastBackupAt ? 'Backup terakhir lebih dari 2 minggu lalu.' : 'Belum pernah backup.'}
              </span>
            </span>
          </div>
          <span className="shrink-0 font-semibold text-clay hover:underline">Cadangkan Data →</span>
        </Link>
      )}

      {invoices === undefined ? (
        <Loading />
      ) : invoices.length === 0 ? (
        <EmptyState
          title="Belum ada invoice yang dibuat"
          body="Buat invoice pertama kamu dalam hitungan menit. Data klien dan item pekerjaan akan otomatis tersimpan untuk mempercepat pembuatan invoice berikutnya."
          action={
            <Button variant="primary" size="lg" onClick={newInvoice} disabled={creating}>
              <IconPlus size={18} /> Buat Invoice Pertama
            </Button>
          }
        />
      ) : (
        <>
          {/* Filter & Search Toolbar */}
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-xs md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1 md:max-w-md">
              <IconSearch size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <TextInput
                ref={searchInputRef}
                type="search"
                placeholder="Cari nomor invoice, klien, atau item..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9.5 pr-14 text-sm"
                aria-label="Cari invoice"
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-muted">
                ⌘K
              </kbd>
            </div>


            <div className="flex flex-wrap items-center justify-between gap-2 md:justify-end">
              {/* Sort selector */}
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="font-medium">Urutkan:</span>
                <div className="relative inline-flex items-center">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                    className="appearance-none rounded-xl border border-line bg-sunken pl-3 pr-8 py-1.5 text-xs font-semibold text-text transition-colors hover:border-clay/50 focus:outline-none focus:border-clay cursor-pointer"
                    aria-label="Urutkan invoice"
                  >
                    <option value="updated">Terakhir Diperbarui</option>
                    <option value="date_desc">Tanggal Terbaru</option>
                    <option value="amount_desc">Nominal Tertinggi</option>
                    <option value="due_asc">Jatuh Tempo Terdekat</option>
                    <option value="client_asc">Nama Klien (A-Z)</option>
                  </select>
                  <IconChevronDown
                    size={14}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
                  />
                </div>
              </div>

              {/* View Switcher (Desktop only) */}
              <div className="hidden items-center rounded-xl border border-line bg-sunken p-0.5 md:flex">
                <button
                  type="button"
                  title="Tampilan Tabel"
                  aria-label="Tampilan tabel"
                  onClick={() => setViewMode('table')}
                  className={`rounded-lg p-1.5 transition-colors ${
                    viewMode === 'table' ? 'bg-surface text-text shadow-xs' : 'text-muted hover:text-text'
                  }`}
                >
                  <IconTable size={17} />
                </button>
                <button
                  type="button"
                  title="Tampilan Kartu"
                  aria-label="Tampilan kartu"
                  onClick={() => setViewMode('cards')}
                  className={`rounded-lg p-1.5 transition-colors ${
                    viewMode === 'cards' ? 'bg-surface text-text shadow-xs' : 'text-muted hover:text-text'
                  }`}
                >
                  <IconGrid size={17} />
                </button>
              </div>
            </div>
          </div>

          {/* Status Tabs with count badges */}
          <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0" role="tablist" aria-label="Filter status">
            {FILTERS.map((f) => {
              const active = filter === f.value;
              const count = counts[f.value] ?? 0;
              return (
                <button
                  key={f.value}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.value)}
                  className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-all ${
                    active
                      ? 'border-ink bg-ink text-bg shadow-xs'
                      : 'border-line bg-surface text-muted hover:border-muted/50 hover:text-text'
                  }`}
                >
                  <span>{f.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-mono leading-none ${
                      active ? 'bg-bg/20 text-bg' : 'bg-sunken text-muted'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title="Tidak ada invoice yang cocok"
              body={q ? `Tidak ada hasil pencarian yang cocok dengan kata kunci "${q}".` : 'Belum ada invoice di kategori filter ini.'}
              action={
                <Button
                  onClick={() => {
                    setQ('');
                    setFilter('all');
                    setParams({});
                  }}
                >
                  Tampilkan Semua Invoice
                </Button>
              }
            />
          ) : viewMode === 'table' ? (
            /* Desktop Table View */
            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
              <div className="custom-scrollbar overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line bg-sunken/60 text-xs font-bold tracking-wider text-muted uppercase">
                      <th className="px-5 py-3.5">Invoice</th>
                      <th className="px-5 py-3.5">Klien</th>
                      <th className="px-5 py-3.5">Tanggal</th>
                      <th className="px-5 py-3.5">Jatuh Tempo</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5 text-right">Total Tagihan</th>
                      <th className="px-5 py-3.5 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {visible.map(({ inv, status, totals }) => (
                      <InvoiceTableRow
                        key={inv.id}
                        inv={inv}
                        status={status}
                        totals={totals}
                        today={today}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Card Grid View */
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {visible.map(({ inv, status, totals }) => (
                <li key={inv.id}>
                  <InvoiceCardRow
                    inv={inv}
                    status={status}
                    amount={status === 'partial' || status === 'overdue' ? totals.balance : totals.grandTotal}
                    today={today}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Mobile Floating Action Button */}
      {(invoices?.length ?? 0) > 0 && (
        <button
          type="button"
          onClick={newInvoice}
          disabled={creating}
          className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 inline-flex min-h-13 items-center gap-2 rounded-full bg-ink px-5 font-bold text-bg shadow-lg transition-transform active:scale-95 md:hidden"
        >
          <IconPlus size={20} /> Invoice Baru
        </button>
      )}
    </>
  );
}

function KpiCard({
  label,
  tone = 'text-muted',
  stamp,
  count,
  hint,
  active,
  onClick,
  children,
}: {
  label: string;
  tone?: string;
  stamp: string;
  count: number;
  hint: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-w-0 rounded-2xl border bg-surface p-4.5 text-left shadow-xs transition-all hover:shadow-sm ${active ? 'border-ink' : 'border-line hover:border-muted/50'}`}
    >
      <span className={`flex items-center justify-between text-xs font-semibold ${tone}`}>
        <span>{label}</span>
        <span className={`stamp ${stamp} scale-90`}>{count}</span>
      </span>
      {children}
      <span className="mt-1 block text-xs text-muted">{hint}</span>
    </button>
  );
}

function InvoiceTableRow({
  inv,
  status,
  totals,
  today,
}: {
  inv: Invoice;
  status: Status;
  totals: ReturnType<typeof computeTotals>;
  today: string;
}) {
  const navigate = useNavigate();
  const targetUrl = invoiceHref(inv);

  let dueText = '-';
  let isOverdue = false;
  if (status === 'overdue') {
    dueText = `Lewat ${daysBetween(inv.dueDate, today)} hr`;
    isOverdue = true;
  } else if (['sent', 'partial'].includes(status) && inv.dueDate) {
    const d = daysBetween(today, inv.dueDate);
    dueText = d === 0 ? 'Hari ini' : `${d} hari lagi`;
  } else if (inv.dueDate) {
    dueText = formatDate(inv.dueDate, 'id', 'short');
  }

  const displayAmount = status === 'partial' || status === 'overdue' ? totals.balance : totals.grandTotal;

  return (
    <tr
      onClick={() => navigate(targetUrl)}
      className="group cursor-pointer transition-colors hover:bg-sunken/50"
    >
      <td className="px-5 py-4 font-mono text-[13px] font-bold text-clay">
        {inv.number}
      </td>

      <td className="px-5 py-4">
        <p className="max-w-[200px] truncate font-bold text-text group-hover:text-clay transition-colors">
          {inv.client.name || <span className="text-muted italic">Klien belum diisi</span>}
        </p>
        {inv.client.contactPerson && (
          <p className="max-w-[200px] truncate text-xs text-muted">Up. {inv.client.contactPerson}</p>
        )}
      </td>

      <td className="px-5 py-4 text-xs text-muted whitespace-nowrap">
        {formatDate(inv.issueDate, 'id', 'short')}
      </td>

      <td className="px-5 py-4 text-xs whitespace-nowrap">
        <span className={isOverdue ? 'font-bold text-danger' : 'text-muted'}>{dueText}</span>
      </td>

      <td className="px-5 py-4 whitespace-nowrap">
        <StatusStamp status={status} />
      </td>

      <td className="num px-5 py-4 text-right font-mono text-sm font-extrabold whitespace-nowrap text-text">
        {formatMoney(displayAmount, inv.currency)}
        {status === 'partial' && (
          <span className="block text-[11px] font-normal text-muted">
            dari {formatMoney(totals.grandTotal, inv.currency)}
          </span>
        )}
      </td>

      <td className="px-5 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          <Link
            to={`/invoice/${inv.id}/edit`}
            title="Edit invoice"
            className="inline-grid size-8 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:bg-sunken hover:text-text"
          >
            <IconEdit size={14} />
          </Link>
          <Link
            to={`/invoice/${inv.id}`}
            title="Lihat detail / PDF"
            className="inline-grid size-8 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:bg-sunken hover:text-text"
          >
            <IconDownload size={14} />
          </Link>
        </div>
      </td>
    </tr>
  );
}

function InvoiceCardRow({
  inv,
  status,
  amount,
  today,
}: {
  inv: Invoice;
  status: Status;
  amount: number;
  today: string;
}) {
  let due = '';
  if (status === 'overdue') due = `Lewat ${daysBetween(inv.dueDate, today)} hari`;
  else if (['sent', 'partial'].includes(status) && inv.dueDate) {
    const d = daysBetween(today, inv.dueDate);
    due = d === 0 ? 'Jatuh tempo hari ini' : `Jatuh tempo ${d} hari lagi`;
  } else due = formatDate(inv.issueDate, 'id', 'short');

  return (
    <Link
      to={invoiceHref(inv)}
      className="group block rounded-2xl border border-line bg-surface p-4.5 shadow-xs transition-all hover:border-clay/50 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-[13px] font-bold text-clay">{inv.number}</p>
          <p className="mt-1 truncate font-bold text-base text-text group-hover:text-clay transition-colors">
            {inv.client.name || <span className="text-muted italic">Klien belum diisi</span>}
          </p>
        </div>
        <StatusStamp status={status} />
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-t border-line/60 pt-3">
        <p className={`text-xs ${status === 'overdue' ? 'font-bold text-danger' : 'text-muted'}`}>{due}</p>
        <p className="num font-mono text-lg font-extrabold tracking-tight text-text">
          {formatMoney(amount, inv.currency)}
        </p>
      </div>
    </Link>
  );
}

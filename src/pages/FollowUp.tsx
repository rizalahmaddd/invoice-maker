import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deriveStatus, markReminded, snoozeInvoice } from '../db';
import { useSettings } from '../hooks';
import { buildFollowUps, TIER_META, type FollowUpItem, type FollowUpTier } from '../lib/followup';
import { formatMoney } from '../lib/money';
import { copyText } from '../lib/files';
import { buildMessage, waLink } from '../lib/share';
import { daysBetween, toISODate, todayISO } from '../lib/id';
import { PageHeader, StatusStamp } from '../components/layout';
import { Button, EmptyState, Loading, useUI } from '../components/ui';
import { IconCheck, IconCopy, IconShare } from '../components/icons';

type Filter = 'all' | FollowUpTier;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'overdue', label: 'Lewat tempo' },
  { value: 'due_soon', label: 'Jatuh tempo dekat' },
  { value: 'stale', label: 'Belum ditagih lama' },
  { value: 'draft', label: 'Draft' },
];

export function FollowUp() {
  const { toast, confirm } = useUI();
  const settings = useSettings();
  const invoices = useLiveQuery(() => db.invoices.orderBy('updatedAt').reverse().toArray(), []);
  const today = todayISO();
  const [filter, setFilter] = useState<Filter>('all');

  const items = useMemo(() => buildFollowUps(invoices ?? [], today), [invoices, today]);
  const visible = filter === 'all' ? items : items.filter((i) => i.tier === filter);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: items.length, overdue: 0, due_soon: 0, stale: 0, draft: 0 };
    for (const item of items) c[item.tier] += 1;
    return c;
  }, [items]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.inv.currency, (map.get(item.inv.currency) ?? 0) + item.balance);
    return [...map.entries()];
  }, [items]);

  const mark = async (item: FollowUpItem) => {
    const previous = { lastRemindedAt: item.inv.lastRemindedAt, remindCount: item.inv.remindCount };
    await markReminded(item.inv.id);
    toast('Ditandai sudah ditagih', 'ok', {
      label: 'Urungkan',
      onClick: () => {
        db.invoices.update(item.inv.id, { ...previous, updatedAt: Date.now() });
      },
    });
  };

  const snooze = async (item: FollowUpItem) => {
    const previous = item.inv.snoozeUntil;
    await snoozeInvoice(item.inv.id, 3);
    toast('Ditunda 3 hari', 'ok', {
      label: 'Urungkan',
      onClick: () => {
        db.invoices.update(item.inv.id, { snoozeUntil: previous, updatedAt: Date.now() });
      },
    });
  };

  const markAll = async () => {
    if (visible.length === 0) return;
    const ok = await confirm({
      title: 'Tandai semua sudah ditagih?',
      message: `${visible.length} invoice di tab ini akan ditandai sudah ditagih.`,
      confirmLabel: 'Tandai semua',
    });
    if (!ok) return;
    await Promise.all(visible.map((item) => markReminded(item.inv.id)));
    toast(`${visible.length} invoice ditandai sudah ditagih`);
  };

  if (!invoices || !settings) return <Loading />;

  return (
    <>
      <PageHeader title="Penagihan" sub="Invoice yang perlu difollow-up, diurutkan dari yang paling mendesak" />

      {items.length === 0 ? (
        <EmptyState
          title="Tidak ada yang perlu ditagih"
          body="Semua invoice sudah lunas, belum jatuh tempo, atau baru saja ditagih. Invoice lewat tempo akan muncul di sini."
          action={
            <Link to="/" className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-bg">
              Ke daftar invoice
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs font-semibold text-muted">Total yang perlu ditindak</p>
            <p className="num mt-1 text-2xl font-extrabold tracking-tight">
              {totals[0] ? formatMoney(totals[0][1], totals[0][0]) : '—'}
            </p>
            {totals.length > 1 && (
              <p className="num mt-0.5 text-sm text-muted">+ {totals.slice(1).map(([c, v]) => formatMoney(v, c)).join(' + ')}</p>
            )}
            <p className="mt-1 text-xs text-muted">{items.length} invoice menunggu tindakan</p>
          </div>

          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist" aria-label="Filter penagihan">
            {FILTERS.map((f) => {
              const active = filter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.value)}
                  className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-colors ${
                    active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-muted hover:border-muted/50 hover:text-text'
                  }`}
                >
                  {f.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-mono leading-none ${active ? 'bg-bg/20 text-bg' : 'bg-sunken text-muted'}`}>
                    {counts[f.value]}
                  </span>
                </button>
              );
            })}
          </div>

          {filter !== 'all' && visible.length > 1 && (
            <div>
              <Button size="sm" onClick={markAll}>
                <IconCheck size={16} /> Tandai semua di tab ini sudah ditagih
              </Button>
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {visible.map((item) => {
              const { inv, tier, days, balance } = item;
              const message = buildMessage(tier === 'draft' ? settings.shareMessage : settings.reminderMessage, inv, settings);
              const hint =
                tier === 'overdue'
                  ? `Telat ${days} hari`
                  : tier === 'due_soon'
                    ? days === 0
                      ? 'Jatuh tempo hari ini'
                      : `Jatuh tempo ${days} hari lagi`
                    : tier === 'draft'
                      ? 'Draft siap dikirim'
                      : 'Belum ditagih lebih dari sepekan';

              return (
                <li key={inv.id} className="rounded-2xl border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/invoice/${inv.id}`} className="font-mono text-[13px] font-bold text-clay hover:underline">
                        {inv.number}
                      </Link>
                      <p className="truncate text-base font-bold">{inv.client.name || 'Klien belum diisi'}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {hint}
                        {' · '}
                        {item.lastRemindedAt ? `terakhir ditagih ${relativeDays(item.lastRemindedAt, today)}` : 'belum pernah ditagih'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num font-mono text-lg font-extrabold tracking-tight">{formatMoney(balance, inv.currency)}</p>
                      <div className="mt-1 flex justify-end gap-1.5">
                        <span className={`stamp ${TIER_META[tier].cls}`}>{TIER_META[tier].label}</span>
                        {deriveStatus(inv, today) === 'partial' && <StatusStamp status="partial" />}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {inv.client.phone ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={async () => {
                          await markReminded(inv.id);
                          window.open(waLink(inv.client.phone, message), '_blank', 'noreferrer');
                        }}
                      >
                        <IconShare size={16} /> WhatsApp
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      onClick={async () => {
                        const ok = await copyText(message);
                        toast(ok ? 'Pesan disalin' : 'Gagal menyalin pesan', ok ? 'ok' : 'error');
                      }}
                    >
                      <IconCopy size={16} /> Salin pesan
                    </Button>
                    <Button size="sm" onClick={() => mark(item)}>
                      <IconCheck size={16} /> Tandai ditagih
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => snooze(item)}>
                      Tunda 3 hari
                    </Button>
                    <Link
                      to={inv.status === 'draft' ? `/invoice/${inv.id}/edit` : `/invoice/${inv.id}`}
                      className="inline-flex min-h-9 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:bg-sunken hover:text-text"
                    >
                      Buka
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

function relativeDays(timestamp: number, today: string) {
  const days = Math.max(0, daysBetween(toISODate(new Date(timestamp)), today));
  if (days === 0) return 'hari ini';
  if (days === 1) return 'kemarin';
  return `${days} hari lalu`;
}

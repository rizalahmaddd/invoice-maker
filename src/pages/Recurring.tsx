import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createRecurrence,
  db,
  deleteRecurrence,
  runRecurrenceNow,
  skipNextRecurrence,
  toggleRecurrence,
} from '../db';
import { useRecurrences } from '../hooks';
import { describeSchedule, previewDates } from '../lib/recurrence';
import { computeTotals, formatMoney } from '../lib/money';
import { formatDate } from '../lib/labels';
import { todayISO } from '../lib/id';
import type { Frequency, Invoice, Recurrence } from '../types';
import { PageHeader } from '../components/layout';
import { Button, Card, EmptyState, Field, Loading, NumberInput, Select, Sheet, TextInput, Toggle, useUI } from '../components/ui';
import { IconEdit, IconPlus, IconRepeat, IconTrash } from '../components/icons';

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Mingguan' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'quarterly', label: '3 bulan' },
  { value: 'yearly', label: 'Tahunan' },
];

export function Recurring() {
  const navigate = useNavigate();
  const { toast, confirm } = useUI();
  const recurrences = useRecurrences();
  const [editing, setEditing] = useState<Recurrence | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!recurrences) return <Loading />;

  return (
    <>
      <PageHeader
        title="Invoice berulang"
        sub="Draft dibuat otomatis dari invoice yang sudah ada"
      />

      <div className="mb-4 rounded-2xl border border-line bg-surface p-3.5 text-xs leading-relaxed text-muted">
        Pembuatan otomatis berjalan saat aplikasi dibuka — PWA tidak punya penjadwal latar belakang. Draft yang terlewat
        akan dibuat sekaligus, dan nomornya tetap mengikuti aturan penomoran.
      </div>

      {recurrences.length === 0 ? (
        <EmptyState
          title="Belum ada jadwal berulang"
          body="Buka invoice yang ingin diulang (mis. tagihan retainer bulanan), lalu pilih Aksi lain → Jadikan invoice berulang."
          action={
            <Button variant="primary" onClick={() => navigate('/')}>
              <IconRepeat size={18} /> Pilih invoice
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {recurrences.map((rec) => {
            const total = computeTotals({ ...rec.template, payments: [] }).grandTotal;
            return (
              <li key={rec.id}>
                <Card className={rec.active ? '' : 'opacity-70'}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-bold">{rec.name}</h2>
                        {!rec.active && <span className="stamp stamp-void">Dijeda</span>}
                      </div>
                      <p className="mt-0.5 text-sm text-muted">{describeSchedule(rec)}</p>
                      <p className="mt-1 text-xs text-muted">
                        {rec.template.client.name || 'Tanpa klien'} · {formatMoney(total, rec.template.currency)} · {rec.template.items.length} item
                      </p>
                    </div>
                    <Toggle
                      checked={rec.active}
                      onChange={(v) => toggleRecurrence(rec.id, v)}
                      label={<span className="sr-only">Aktifkan {rec.name}</span>}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-sunken px-3 py-2 text-xs sm:grid-cols-3">
                    <div>
                      <p className="text-muted">Berikutnya</p>
                      <p className="font-semibold">{formatDate(rec.nextRun, 'id', 'short')}</p>
                    </div>
                    <div>
                      <p className="text-muted">Terakhir dibuat</p>
                      <p className="font-semibold">{rec.lastRun ? formatDate(rec.lastRun, 'id', 'short') : '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted">Sudah dibuat</p>
                      <p className="font-semibold">{rec.runCount} invoice</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy === rec.id}
                      onClick={async () => {
                        setBusy(rec.id);
                        try {
                          const inv = await runRecurrenceNow(rec);
                          toast('Draft dibuat');
                          navigate(`/invoice/${inv.id}/edit`);
                        } catch (e) {
                          toast(`Gagal membuat draft: ${(e as Error).message}`, 'error');
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      <IconPlus size={16} /> {busy === rec.id ? 'Membuat...' : 'Buat sekarang'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={async () => {
                        await skipNextRecurrence(rec);
                        toast('Jadwal berikutnya dilewati');
                      }}
                    >
                      Lewati berikutnya
                    </Button>
                    <Button size="sm" onClick={() => setEditing(rec)}>
                      <IconEdit size={16} /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Hapus jadwal berulang?',
                          message: 'Invoice yang sudah dibuat tetap ada. Jadwal ini berhenti membuat draft baru.',
                          confirmLabel: 'Hapus jadwal',
                          danger: true,
                        });
                        if (!ok) return;
                        await deleteRecurrence(rec.id);
                        toast('Jadwal dihapus');
                      }}
                    >
                      <IconTrash size={16} /> Hapus
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <RecurrenceSheet open={!!editing} onClose={() => setEditing(null)} existing={editing ?? undefined} />
    </>
  );
}

export function RecurrenceSheet({
  open,
  onClose,
  invoice,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  invoice?: Invoice;
  existing?: Recurrence;
  onSaved?: (rec: Recurrence) => void;
}) {
  const { toast } = useUI();
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [interval, setInterval] = useState(1);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState('');
  const [dueDays, setDueDays] = useState(14);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setName(existing.name);
      setFrequency(existing.frequency);
      setInterval(existing.interval);
      setStartDate(existing.startDate);
      setEndDate(existing.endDate ?? '');
      setDueDays(existing.dueDays);
    } else if (invoice) {
      setName(invoice.client.name ? `Berulang ${invoice.client.name}` : `Berulang ${invoice.number}`);
      setFrequency('monthly');
      setInterval(1);
      setStartDate(todayISO());
      setEndDate('');
      setDueDays(14);
    }
    setSaving(false);
  }, [open, existing, invoice]);

  const valid = !!(existing || invoice) && !!startDate && !saving;
  const preview = startDate ? previewDates(startDate, frequency, interval, 3) : [];

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (existing) {
        const next: Recurrence = {
          ...existing,
          name: name.trim() || existing.name,
          frequency,
          interval: Math.max(1, interval),
          startDate,
          endDate: endDate || undefined,
          dueDays: Math.max(0, dueDays),
          nextRun: startDate,
          updatedAt: Date.now(),
        };
        await db.recurrences.put(next);
        onSaved?.(next);
        toast('Jadwal diperbarui');
      } else if (invoice) {
        if (invoice.items.length === 0) throw new Error('Invoice ini belum punya item.');
        const rec = await createRecurrence(invoice, {
          name,
          frequency,
          interval,
          startDate,
          endDate: endDate || undefined,
          dueDays,
        });
        onSaved?.(rec);
        toast('Jadwal berulang dibuat');
      }
      onClose();
    } catch (e) {
      toast(`Gagal menyimpan jadwal: ${(e as Error).message}`, 'error');
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Edit jadwal berulang' : 'Jadikan invoice berulang'}
      footer={
        <Button variant="primary" size="lg" block onClick={save} disabled={!valid}>
          {saving ? 'Menyimpan...' : existing ? 'Simpan perubahan' : 'Buat jadwal'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Nama jadwal" htmlFor="rec-name">
          <TextInput id="rec-name" value={name} placeholder="Retainer PT Contoh" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Frekuensi">
          <Select aria-label="Frekuensi" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ulangi setiap" hint="1 = setiap periode, 2 = setiap dua periode">
          <NumberInput aria-label="Interval" decimals={0} value={interval} onChange={(v) => setInterval(Math.max(1, Math.round(v)))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mulai" htmlFor="rec-start">
            <TextInput id="rec-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Berakhir" hint="Opsional" htmlFor="rec-end">
            <TextInput id="rec-end" type="date" min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Jatuh tempo (hari)" htmlFor="rec-due">
          <NumberInput id="rec-due" decimals={0} value={dueDays} onChange={(v) => setDueDays(Math.max(0, Math.round(v)))} />
        </Field>

        <div className="rounded-xl bg-sunken px-3 py-2.5 text-sm">
          <p className="text-xs font-semibold text-muted">3 jadwal berikutnya</p>
          <p className="mt-1 font-medium">
            {preview.length > 0 ? preview.map((d) => formatDate(d, 'id', 'short')).join(' · ') : '—'}
          </p>
          {startDate < todayISO() && (
            <p className="mt-2 text-xs text-warn">
              Tanggal mulai sudah lewat. Semua periode yang terlewat akan dibuat sebagai draft saat aplikasi dibuka.
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { createRevision, db, deleteInvoice, deriveStatus, getTemplate, isBlank, renumberForDate, saveEditedInvoice } from '../db';
import { useAllTemplates, useInvoicePdf, useSettings, useWide } from '../hooks';
import { CURRENCIES, computeTotals, displayDecimals, formatMoney, lineTotals } from '../lib/money';
import { addDays, daysBetween, uid } from '../lib/id';
import { formatDate } from '../lib/labels';
import { clientCode, formatNumberPattern } from '../lib/numbering';
import type { Adjustment, Client, Invoice, LineItem, TemplateConfig } from '../types';

type KnownItem = Pick<LineItem, 'detail' | 'unit' | 'price'>;
import { PageHeader } from '../components/layout';
import { Button, Card, Field, IconButton, Loading, NumberInput, Segmented, Select, Sheet, TextArea, TextInput, Toggle, useUI, EmptyState } from '../components/ui';
import { IconChevronDown, IconCopy, IconPlus, IconSearch, IconTrash, IconUp } from '../components/icons';
import { PdfPreview } from '../components/PdfPreview';

const emptyItem = (): LineItem => ({ id: uid(), description: '', detail: '', qty: 1, unit: '', price: 0, discount: { type: 'percent', value: 0 } });

export function InvoiceEditor() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, confirm } = useUI();
  const settings = useSettings();
  const templates = useAllTemplates();
  const wide = useWide();
  const [inv, setInv] = useState<Invoice | null | undefined>(undefined);
  const [saved, setSaved] = useState<SaveStatus>('saved');
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'form' | 'preview'>('form');
  const [tpl, setTpl] = useState<TemplateConfig>();
  const touched = useRef(false);
  const dirty = useRef(false);
  const latest = useRef<Invoice | null>(null);
  const fresh = (location.state as { fresh?: boolean } | null)?.fresh;

  useEffect(() => {
    db.invoices.get(id!).then((r) => {
      setInv(r ?? null);
      latest.current = r ?? null;
    });
  }, [id]);

  useEffect(() => {
    if (inv) getTemplate(inv.templateId).then(setTpl);
  }, [inv?.templateId, templates]);

  const persist = (cur: Invoice) =>
    saveEditedInvoice(cur)
      .then((ok) => {
        if (latest.current === cur) dirty.current = false;
        setSaved(ok ? 'saved' : 'gone');
      })
      .catch(() => setSaved('error'));

  // Autosave: mobile browsers kill background tabs, so every edit is persisted shortly after typing stops.
  useEffect(() => {
    if (!inv || !touched.current) return;
    setSaved('saving');
    const t = setTimeout(() => persist(inv), 400);
    return () => clearTimeout(t);
  }, [inv]);

  // The debounce above is cancelled on unmount, so whatever is still pending is written here.
  // A fresh invoice that was never filled in is discarded instead so it doesn't burn a number.
  useEffect(() => {
    const flush = () => {
      const cur = latest.current;
      if (cur && dirty.current) persist(cur);
    };
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      const cur = latest.current;
      if (!cur) return;
      if (fresh && isBlank(cur)) deleteInvoice(cur.id);
      else flush();
    };
  }, [fresh]);

  const update = (patch: Partial<Invoice> | ((i: Invoice) => Partial<Invoice>)) => {
    touched.current = true;
    dirty.current = true;
    setInv((cur) => {
      if (!cur) return cur;
      const p = typeof patch === 'function' ? patch(cur) : patch;
      const next = { ...cur, ...p, updatedAt: Date.now() };
      latest.current = next;
      return next;
    });
  };

  useEffect(() => {
    if (!inv?.numberAuto || !touched.current) return;
    const t = setTimeout(async () => {
      const cur = latest.current;
      if (!cur) return;
      const patch = await renumberForDate(cur).catch(() => null);
      if (patch && latest.current?.id === cur.id) {
        update(patch);
        toast(`Nomor disesuaikan dengan tanggal: ${patch.number}`);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [inv?.issueDate]);

  const duplicateNumber = useLiveQuery(async () => {
    if (!inv?.number) return false;
    const n = await db.invoices.where('number').equals(inv.number).count();
    return n > 1 || (n === 1 && !(await db.invoices.get(inv.id)));
  }, [inv?.number, inv?.id]);

  const knownItems = useLiveQuery(async () => {
    const map = new Map<string, KnownItem>();
    const recent = await db.invoices.orderBy('updatedAt').reverse().limit(150).toArray();
    for (const i of recent.reverse()) for (const it of i.items) if (it.description.trim()) map.set(it.description.trim(), it);
    for (const p of await db.products.toArray()) if (p.name.trim()) map.set(p.name.trim(), p);
    return map;
  }, []);

  const status = inv ? deriveStatus(inv) : 'draft';
  const showPreview = wide || tab === 'preview';
  const pdf = useInvoicePdf(showPreview && inv ? inv : undefined, tpl, settings, status, 600);

  if (inv === undefined || !settings) return <Loading />;
  if (inv === null)
    return (
      <EmptyState
        title="Invoice tidak ditemukan"
        body="Mungkin sudah dihapus atau data di perangkat ini sudah dibersihkan."
        action={
          <Link to="/" className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-bg">
            Ke daftar invoice
          </Link>
        }
      />
    );

  const setClientName = (name: string) => {
    update((cur) => {
      const patch: Partial<Invoice> = { client: { ...cur.client, name } };
      if (cur.numberAuto && cur.numberSeq && settings.numbering.format.includes('{CLIENT}')) {
        patch.number = formatNumberPattern(settings.numbering.format, cur.issueDate, cur.numberSeq, clientCode(name));
      }
      return patch;
    });
  };

  const totals = computeTotals(inv);
  const dec = displayDecimals(inv.currency);
  const lang = inv.lang;

  const locked = inv.status !== 'draft';
  const readOnly = locked && !unlocked;

  const finish = async () => {
    if (readOnly) {
      navigate(`/invoice/${inv.id}`, { replace: true });
      return;
    }
    setBusy(true);
    try {
      let cur = latest.current!;
      const t = computeTotals(cur);
      const filled = cur.items.filter((i) => i.description.trim() || i.price);
      const issues: string[] = [];
      if (!cur.number.trim()) issues.push('Nomor invoice masih kosong.');
      else if (duplicateNumber) issues.push(`Nomor ${cur.number} sudah dipakai invoice lain.`);
      if (!cur.client.name.trim()) issues.push('Nama klien belum diisi.');
      if (filled.length === 0) issues.push('Belum ada item yang diisi.');
      else if (t.grandTotal <= 0) issues.push('Total tagihan 0 atau minus.');
      const noName = filled.filter((i) => !i.description.trim()).length;
      if (noName) issues.push(`${noName} item punya harga tapi belum ada deskripsi.`);
      if (cur.dueDate && cur.dueDate < cur.issueDate) issues.push('Jatuh tempo lebih awal dari tanggal invoice.');
      if (issues.length) {
        const ok = await confirm({
          title: 'Cek dulu sebelum disimpan',
          message: (
            <ul className="list-disc space-y-1 pl-5">
              {issues.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ),
          confirmLabel: 'Tetap simpan',
        });
        if (!ok) return;
      }
      const renumbered = await renumberForDate(cur).catch(() => null);
      cur = { ...cur, ...renumbered, items: filled };
      let clientId = cur.clientId;
      if (cur.client.name.trim()) {
        const now = Date.now();
        if (clientId && (await db.clients.get(clientId))) {
          await db.clients.update(clientId, { ...cur.client, updatedAt: now });
        } else {
          const existing = await db.clients.where('name').equalsIgnoreCase(cur.client.name.trim()).first();
          clientId = existing?.id ?? uid();
          await db.clients.put({ ...(existing ?? { createdAt: now }), ...cur.client, id: clientId, updatedAt: now } as Client);
        }
      }
      const next = { ...cur, clientId, updatedAt: Date.now() };
      if (!(await saveEditedInvoice(next))) throw new Error('invoice ini sudah dihapus.');
      latest.current = next;
      dirty.current = false;
      navigate(`/invoice/${cur.id}`, { replace: true });
    } catch (e) {
      toast(`Gagal menyimpan: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Hapus invoice ini?',
      message: `${inv.number} akan dihapus permanen dari perangkat ini.`,
      confirmLabel: 'Hapus',
      danger: true,
    });
    if (!ok) return;
    latest.current = null;
    await deleteInvoice(inv.id);
    toast('Invoice dihapus');
    navigate('/', { replace: true });
  };

  const makeRevision = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const rev = await createRevision(latest.current!);
      latest.current = null;
      navigate(`/invoice/${rev.id}/edit`, { replace: true });
    } catch (e) {
      toast(`Revisi gagal dibuat: ${(e as Error).message}`, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,480px)] xl:grid-cols-[minmax(0,1.25fr)_minmax(0,540px)] lg:gap-8">
      <div className="min-w-0">
        <PageHeader
          back="/"
          title={<span className="font-mono text-lg md:text-xl font-bold">{inv.number || 'Tanpa nomor'}</span>}
          sub={<SaveState state={saved} />}
          actions={
            <IconButton label="Hapus invoice" onClick={remove}>
              <IconTrash />
            </IconButton>
          }
        />

        {!wide && (
          <div className="mb-4">
            <Segmented
              label="Tampilan editor"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'form', label: 'Isi data' },
                { value: 'preview', label: 'Preview PDF' },
              ]}
            />
          </div>
        )}

        {locked && (
          <div className="mb-4 rounded-2xl border border-warn/50 bg-warn/10 p-4 text-sm">
            <p className="font-bold">{inv.status === 'void' ? 'Invoice ini sudah dibatalkan.' : 'Invoice ini sudah dikirim ke klien.'}</p>
            <p className="mt-0.5 text-muted">
              {readOnly
                ? inv.status === 'void'
                  ? 'Isinya dikunci supaya arsip tetap sesuai yang pernah dikirim.'
                  : 'Isinya dikunci. Kalau ada perubahan, sebaiknya buat revisi supaya nomor lama tetap tercatat dan klien tidak bingung.'
                : 'Mode edit langsung aktif. Perubahan menimpa invoice yang sudah diterima klien.'}
            </p>
            {readOnly && (
              <div className="mt-3 flex flex-wrap gap-2">
                {inv.status === 'sent' && (
                  <Button size="sm" variant="primary" disabled={busy} onClick={makeRevision}>
                    Buat revisi {inv.number.replace(/-R\d+$/, '')}-R...
                  </Button>
                )}
                <Button size="sm" onClick={() => setUnlocked(true)}>
                  Tetap edit invoice ini
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === 'preview' && !wide ? (
          <PdfPreview blob={pdf.blob} busy={pdf.busy} error={pdf.error} />
        ) : (
          <div className="flex flex-col gap-4">
            <fieldset disabled={readOnly} className="contents">
              <ClientSection inv={inv} update={update} setClientName={setClientName} />
            </fieldset>

            <Collapsible disabled={readOnly} defaultOpen={true} title="Detail invoice" summary={`${formatDate(inv.issueDate, 'id', 'short')} · ${inv.currency} · ${templates?.find((t) => t.id === inv.templateId)?.name ?? ''}`}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nomor invoice" htmlFor="num" hint={duplicateNumber ? <span className="font-semibold text-danger">Nomor ini sudah dipakai invoice lain.</span> : undefined}>
                  <TextInput id="num" className="font-mono" value={inv.number} onChange={(e) => update({ number: e.target.value, numberAuto: false })} />
                </Field>
                <Field label="Referensi / No. PO" htmlFor="ref" hint="Opsional, kalau klien minta">
                  <TextInput id="ref" value={inv.reference} onChange={(e) => update({ reference: e.target.value })} />
                </Field>
                <Field label="Tanggal invoice" htmlFor="issue">
                  <TextInput
                    id="issue"
                    type="date"
                    value={inv.issueDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const gap = inv.dueDate ? daysBetween(inv.issueDate, inv.dueDate) : settings.defaults.dueDays;
                      update({ issueDate: v, dueDate: addDays(v, gap) });
                    }}
                  />
                </Field>
                <Field
                  label="Jatuh tempo"
                  htmlFor="due"
                  hint={inv.dueDate && inv.dueDate < inv.issueDate ? <span className="font-semibold text-danger">Lebih awal dari tanggal invoice.</span> : undefined}
                >
                  <TextInput id="due" type="date" value={inv.dueDate} min={inv.issueDate} onChange={(e) => update({ dueDate: e.target.value })} />
                  <div className="flex flex-wrap gap-1.5">
                    {[0, 7, 14, 30].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => update({ dueDate: addDays(inv.issueDate, d) })}
                        className={`min-h-8 rounded-lg border px-2.5 text-xs font-semibold ${inv.dueDate === addDays(inv.issueDate, d) ? 'border-ink bg-ink text-bg' : 'border-line text-muted'}`}
                      >
                        {d === 0 ? 'Saat diterima' : `${d} hari`}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Mata uang" htmlFor="cur">
                  <Select id="cur" value={inv.currency} onChange={(e) => update({ currency: e.target.value })}>
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Bahasa dokumen">
                  <Segmented
                    label="Bahasa dokumen"
                    value={inv.lang}
                    onChange={(v) => update({ lang: v })}
                    options={[
                      { value: 'id', label: 'Indonesia' },
                      { value: 'en', label: 'English' },
                    ]}
                  />
                </Field>
                <Field label="Template" htmlFor="tpl">
                  <Select id="tpl" value={inv.templateId} onChange={(e) => update({ templateId: e.target.value })}>
                    {templates?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.builtin ? '' : ' (buatanmu)'}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Judul dokumen" htmlFor="title" hint="Kosongkan untuk pakai judul template. Contoh: PROFORMA INVOICE">
                  <TextInput id="title" value={inv.title} placeholder={tpl?.titles[inv.lang]} onChange={(e) => update({ title: e.target.value })} />
                </Field>
              </div>
            </Collapsible>

            <fieldset disabled={readOnly} className="contents">
              <ItemsSection inv={inv} update={update} knownItems={knownItems} />
            </fieldset>

            <Collapsible
              disabled={readOnly}
              title="Diskon, pajak & potongan"
              summary={[inv.discount.value ? 'Diskon' : '', inv.tax.enabled ? inv.tax.label : '', inv.pph.enabled ? inv.pph.label : '', inv.adjustments.length ? `${inv.adjustments.length} penyesuaian` : ''].filter(Boolean).join(' · ') || 'Tidak ada'}
            >
              <div className="flex flex-col gap-4">
                <Field label="Diskon total">
                  <div className="flex gap-2">
                    <div className="w-28 shrink-0">
                      <Select
                        aria-label="Jenis diskon"
                        value={inv.discount.type}
                        onChange={(e) => update({ discount: { ...inv.discount, type: e.target.value as 'percent' | 'amount' } })}
                      >
                        <option value="percent">Persen</option>
                        <option value="amount">Nominal</option>
                      </Select>
                    </div>
                    <NumberInput
                      aria-label="Nilai diskon"
                      className="flex-1"
                      lang={lang}
                      decimals={inv.discount.type === 'percent' ? 2 : dec}
                      suffix={inv.discount.type === 'percent' ? '%' : undefined}
                      value={inv.discount.value}
                      onChange={(v) => update({ discount: { ...inv.discount, value: v } })}
                    />
                  </div>
                </Field>

                <div className="rounded-xl bg-sunken p-3">
                  <Toggle checked={inv.tax.enabled} onChange={(v) => update({ tax: { ...inv.tax, enabled: v } })} label="Pajak (PPN)" hint="Ditambahkan ke total, atau sudah termasuk di harga" />
                  {inv.tax.enabled && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Field label="Label" htmlFor="taxl">
                        <TextInput id="taxl" value={inv.tax.label} onChange={(e) => update({ tax: { ...inv.tax, label: e.target.value } })} />
                      </Field>
                      <Field label="Tarif" htmlFor="taxr">
                        <NumberInput id="taxr" lang={lang} suffix="%" value={inv.tax.rate} onChange={(v) => update({ tax: { ...inv.tax, rate: v } })} />
                      </Field>
                      <div className="col-span-2">
                        <Segmented
                          label="Cara hitung pajak"
                          value={inv.tax.inclusive ? 'incl' : 'excl'}
                          onChange={(v) => update({ tax: { ...inv.tax, inclusive: v === 'incl' } })}
                          options={[
                            { value: 'excl', label: 'Ditambahkan' },
                            { value: 'incl', label: 'Sudah termasuk' },
                          ]}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl bg-sunken p-3">
                  <Toggle checked={inv.pph.enabled} onChange={(v) => update({ pph: { ...inv.pph, enabled: v } })} label="Potongan PPh" hint="Untuk klien perusahaan yang memotong PPh 23 dari pembayaran" />
                  {inv.pph.enabled && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Field label="Label" htmlFor="pphl">
                        <TextInput id="pphl" value={inv.pph.label} onChange={(e) => update({ pph: { ...inv.pph, label: e.target.value } })} />
                      </Field>
                      <Field label="Tarif" htmlFor="pphr">
                        <NumberInput id="pphr" lang={lang} suffix="%" value={inv.pph.rate} onChange={(v) => update({ pph: { ...inv.pph, rate: v } })} />
                      </Field>
                    </div>
                  )}
                </div>

                <AdjustmentsEditor inv={inv} update={update} />
              </div>
            </Collapsible>

            <Collapsible disabled={readOnly} title="Pembayaran & catatan" summary={`${inv.bankAccountIds.length} rekening${inv.showQris ? ' · QRIS' : ''}`}>
              <div className="flex flex-col gap-4">
                {settings.bankAccounts.length === 0 && !settings.qris ? (
                  <p className="text-sm text-muted">
                    Belum ada rekening atau QRIS.{' '}
                    <Link to="/pengaturan" className="font-semibold text-clay underline">
                      Tambahkan di Pengaturan
                    </Link>
                    .
                  </p>
                ) : (
                  <fieldset className="flex flex-col gap-1">
                    <legend className="mb-1 text-[13px] font-semibold">Tampilkan di invoice</legend>
                    {settings.bankAccounts.map((b) => (
                      <label key={b.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1">
                        <input
                          type="checkbox"
                          className="size-5 accent-[var(--clay)]"
                          checked={inv.bankAccountIds.includes(b.id)}
                          onChange={(e) =>
                            update({ bankAccountIds: e.target.checked ? [...inv.bankAccountIds, b.id] : inv.bankAccountIds.filter((x) => x !== b.id) })
                          }
                        />
                        <span className="text-sm">
                          <span className="font-semibold">{b.bank}</span> {b.number}
                          <span className="block text-xs text-muted">a.n. {b.holder}</span>
                        </span>
                      </label>
                    ))}
                    {settings.qris && (
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1">
                        <input type="checkbox" className="size-5 accent-[var(--clay)]" checked={inv.showQris} onChange={(e) => update({ showQris: e.target.checked })} />
                        <span className="text-sm font-semibold">QRIS</span>
                      </label>
                    )}
                  </fieldset>
                )}
                <Field label="Catatan" htmlFor="notes">
                  <TextArea id="notes" value={inv.notes} placeholder="Contoh: Terima kasih atas kepercayaannya." onChange={(e) => update({ notes: e.target.value })} />
                </Field>
                <Field label="Syarat & ketentuan" htmlFor="terms">
                  <TextArea id="terms" value={inv.terms} placeholder="Contoh: Pembayaran paling lambat sesuai jatuh tempo." onChange={(e) => update({ terms: e.target.value })} />
                </Field>
              </div>
            </Collapsible>
          </div>
        )}

        <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md px-4 py-3 shadow-lg lg:sticky lg:bottom-4 lg:mt-6 lg:rounded-2xl lg:border lg:shadow-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">Total Tagihan Final</p>
              <p className="num truncate text-xl font-mono font-extrabold text-text tracking-tight">
                {formatMoney(totals.grandTotal, inv.currency, lang)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => navigate('/')} title="Perubahan sudah tersimpan otomatis">
                Tutup
              </Button>
              <Button variant="primary" size="lg" onClick={finish} disabled={busy} className="shadow-xs">
                {readOnly ? 'Selesai' : 'Simpan & Selesai'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {wide && (
        <aside className="sticky top-20 hidden self-start pb-6 lg:block" aria-label="Preview PDF">
          <PdfPreview blob={pdf.blob} busy={pdf.busy} error={pdf.error} showControls={true} />
        </aside>
      )}
      <div className="h-20 lg:hidden" />
    </div>

  );
}

type SaveStatus = 'saved' | 'saving' | 'error' | 'gone';

function SaveState({ state }: { state: SaveStatus }) {
  if (state === 'error') return <span className="font-semibold text-danger">Gagal menyimpan, cek ruang penyimpanan</span>;
  if (state === 'gone') return <span className="font-semibold text-danger">Invoice ini sudah dihapus di tab lain</span>;
  return <span>{state === 'saving' ? 'Menyimpan...' : 'Tersimpan otomatis di perangkat'}</span>;
}

function Collapsible({ title, summary, children, defaultOpen = false, disabled = false }: { title: string; summary?: string; children: ReactNode; defaultOpen?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="p-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">{title}</span>
          {!open && summary ? <span className="block truncate text-xs text-muted">{summary}</span> : null}
        </span>
        <IconChevronDown className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <fieldset disabled={disabled} className="min-w-0 border-t border-line px-4 py-4">
          {children}
        </fieldset>
      )}
    </Card>
  );
}

type Update = (patch: Partial<Invoice> | ((i: Invoice) => Partial<Invoice>)) => void;

function ClientSection({ inv, update, setClientName }: { inv: Invoice; update: Update; setClientName: (n: string) => void }) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [more, setMore] = useState(!!(inv.client.address || inv.client.email || inv.client.phone));
  const clients = useLiveQuery(() => db.clients.orderBy('updatedAt').reverse().toArray(), []);
  const c = inv.client;
  const set = (k: keyof Invoice['client'], v: string) => update({ client: { ...c, [k]: v } });
  const filtered = (clients ?? []).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">Klien</h2>
        {(clients?.length ?? 0) > 0 && (
          <Button size="sm" onClick={() => setPicking(true)}>
            Pilih dari daftar
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama klien / perusahaan" htmlFor="cname">
          <TextInput id="cname" value={c.name} placeholder="Nama klien" autoComplete="off" onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <Field label="Up. (kontak)" htmlFor="ccp">
          <TextInput id="ccp" value={c.contactPerson} placeholder="Opsional" onChange={(e) => set('contactPerson', e.target.value)} />
        </Field>
      </div>
      {more ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="No. HP / WhatsApp" htmlFor="cphone">
            <TextInput id="cphone" type="tel" inputMode="tel" value={c.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="cemail">
            <TextInput id="cemail" type="email" inputMode="email" value={c.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Alamat" htmlFor="caddr" className="sm:col-span-2">
            <TextArea id="caddr" rows={2} value={c.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="NPWP klien" htmlFor="ctax" hint="Biasanya diminta klien perusahaan">
            <TextInput id="ctax" value={c.taxId} onChange={(e) => set('taxId', e.target.value)} />
          </Field>
        </div>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="mt-2 min-h-11 text-sm font-semibold text-clay">
          + Alamat, kontak, NPWP
        </button>
      )}

      <Sheet open={picking} onClose={() => setPicking(false)} title="Pilih klien">
        <div className="relative mb-3">
          <IconSearch size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <TextInput type="search" aria-label="Cari klien" placeholder="Cari nama klien" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Tidak ada klien bernama "{q}".</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filtered.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  className="w-full rounded-xl px-3 py-3 text-left hover:bg-sunken"
                  onClick={() => {
                    update({
                      clientId: x.id,
                      client: { name: x.name, contactPerson: x.contactPerson, email: x.email, phone: x.phone, address: x.address, taxId: x.taxId },
                    });
                    setClientName(x.name);
                    setMore(!!(x.address || x.email || x.phone));
                    setPicking(false);
                  }}
                >
                  <span className="block font-semibold">{x.name}</span>
                  <span className="block truncate text-xs text-muted">{[x.contactPerson, x.phone, x.email].filter(Boolean).join(' · ') || 'Tanpa kontak'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </Card>
  );
}

function ItemsSection({ inv, update, knownItems }: { inv: Invoice; update: Update; knownItems?: Map<string, KnownItem> }) {
  const { toast } = useUI();
  const [terminOpen, setTerminOpen] = useState(false);
  const dec = displayDecimals(inv.currency);
  const lang = inv.lang;
  const listId = 'known-items';

  useEffect(() => {
    if (inv.items.length === 0) update({ items: [emptyItem()] });
  }, []);

  const setItem = (id: string, patch: Partial<LineItem>) => update((cur) => ({ items: cur.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const move = (idx: number) =>
    update((cur) => {
      const items = [...cur.items];
      [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
      return { items };
    });

  const setDescription = (item: LineItem, v: string) => {
    const known = knownItems?.get(v.trim());
    if (known && !item.price) setItem(item.id, { description: v, price: known.price, unit: known.unit, detail: item.detail || known.detail });
    else setItem(item.id, { description: v });
  };

  const duplicate = (idx: number) =>
    update((cur) => ({ items: [...cur.items.slice(0, idx + 1), { ...cur.items[idx], id: uid() }, ...cur.items.slice(idx + 1)] }));

  const remove = (idx: number) => {
    const removed = inv.items[idx];
    update((cur) => ({ items: cur.items.filter((i) => i.id !== removed.id) }));
    toast(`Item ${idx + 1} dihapus`, 'ok', {
      label: 'Urungkan',
      onClick: () =>
        update((cur) => {
          const items = [...cur.items];
          items.splice(Math.min(idx, items.length), 0, removed);
          return { items };
        }),
    });
  };

  const suggestions = useMemo(() => [...(knownItems?.keys() ?? [])].slice(-200), [knownItems]);
  const subtotal = useMemo(() => computeTotals(inv).subtotal, [inv]);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">Daftar Item & Jasa</h2>
        <span className="flex items-center gap-3 text-xs text-muted">
          <Link to="/produk" className="font-semibold text-clay hover:underline">
            Katalog
          </Link>
          {inv.items.length} item
        </span>
      </div>
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* The field grid follows this container's width, not the viewport: the
          editor shares the screen with the PDF preview, so the form column is
          much narrower than the screen on desktop. */}
      <div className="@container">
        <ol className="flex flex-col gap-4">
          {inv.items.map((item, idx) => {
            const lt = lineTotals(item, inv.currency);
            return (
              <li key={item.id} className="rounded-xl border border-line p-4">
                <div className="flex items-start gap-2">
                  <span className="mt-3 w-5 shrink-0 text-xs font-bold text-muted">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <TextInput
                      aria-label={`Deskripsi item ${idx + 1}`}
                      placeholder="Nama pekerjaan / produk"
                      list={listId}
                      value={item.description}
                      onChange={(e) => setDescription(item, e.target.value)}
                    />
                    <TextArea
                      aria-label={`Keterangan item ${idx + 1}`}
                      rows={1}
                      className="mt-2 min-h-11 text-sm"
                      placeholder="Keterangan (opsional)"
                      value={item.detail}
                      onChange={(e) => setItem(item.id, { detail: e.target.value })}
                    />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_1fr] gap-3 pl-7 @md:grid-cols-[90px_90px_1fr]">
                  <Field label="Qty">
                    <NumberInput aria-label={`Qty item ${idx + 1}`} lang={lang} value={item.qty} onChange={(v) => setItem(item.id, { qty: v })} />
                  </Field>
                  <Field label="Satuan">
                    <TextInput aria-label={`Satuan item ${idx + 1}`} placeholder="jam, pcs" value={item.unit} onChange={(e) => setItem(item.id, { unit: e.target.value })} />
                  </Field>
                  <Field label="Harga satuan" className="col-span-2 @md:col-span-1">
                    <NumberInput aria-label={`Harga item ${idx + 1}`} lang={lang} decimals={dec} value={item.price} onChange={(v) => setItem(item.id, { price: v })} />
                  </Field>
                </div>
                <details className="mt-2 pl-7" open={item.discount.value > 0}>
                  <summary className="min-h-9 cursor-pointer py-2 text-xs font-semibold text-muted">Diskon item</summary>
                  <div className="flex gap-2">
                    <div className="w-28 shrink-0">
                      <Select
                        aria-label="Jenis diskon item"
                        value={item.discount.type}
                        onChange={(e) => setItem(item.id, { discount: { ...item.discount, type: e.target.value as 'percent' | 'amount' } })}
                      >
                        <option value="percent">Persen</option>
                        <option value="amount">Nominal</option>
                      </Select>
                    </div>
                    <NumberInput
                      aria-label="Nilai diskon item"
                      className="flex-1"
                      lang={lang}
                      decimals={item.discount.type === 'percent' ? 2 : dec}
                      suffix={item.discount.type === 'percent' ? '%' : undefined}
                      value={item.discount.value}
                      onChange={(v) => setItem(item.id, { discount: { ...item.discount, value: v } })}
                    />
                  </div>
                </details>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 pl-7">
                  <div className="flex">
                    <IconButton label="Naikkan urutan" disabled={idx === 0} onClick={() => move(idx)}>
                      <IconUp size={18} />
                    </IconButton>
                    <IconButton label="Duplikat item" onClick={() => duplicate(idx)}>
                      <IconCopy size={18} />
                    </IconButton>
                    <IconButton label="Hapus item" disabled={inv.items.length <= 1} onClick={() => remove(idx)}>
                      <IconTrash size={18} />
                    </IconButton>
                  </div>
                  <p className="num text-right font-bold">{formatMoney(lt.net, inv.currency, lang)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => update((cur) => ({ items: [...cur.items, emptyItem()] }))}>
            <IconPlus size={16} /> Tambah Item
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTerminOpen(true)}>
            + Termin / Uang Muka (DP)
          </Button>
        </div>
        <p className="text-xs text-muted">
          Subtotal Item: <span className="font-mono font-bold text-text">{formatMoney(subtotal, inv.currency, lang)}</span>
        </p>

      </div>
      <TerminSheet open={terminOpen} onClose={() => setTerminOpen(false)} inv={inv} onAdd={(item) => update((cur) => ({ items: [...cur.items.filter((i) => i.description || i.price), item] }))} />
    </Card>
  );
}

function TerminSheet({ open, onClose, inv, onAdd }: { open: boolean; onClose: () => void; inv: Invoice; onAdd: (i: LineItem) => void }) {
  const [project, setProject] = useState('');
  const [value, setValue] = useState(0);
  const [pct, setPct] = useState(50);
  const [kind, setKind] = useState('DP');
  const amount = Math.round(((value * pct) / 100) * 10 ** displayDecimals(inv.currency)) / 10 ** displayDecimals(inv.currency);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Tambah DP / termin"
      footer={
        <Button
          variant="primary"
          block
          size="lg"
          disabled={!value || !pct}
          onClick={() => {
            onAdd({
              id: uid(),
              description: `${kind} ${pct}%${project ? ` ${project}` : ''}`,
              detail: `${pct}% dari nilai proyek ${formatMoney(value, inv.currency, inv.lang)}`,
              qty: 1,
              unit: '',
              price: amount,
              discount: { type: 'percent', value: 0 },
            });
            onClose();
          }}
        >
          Tambahkan {formatMoney(amount, inv.currency, inv.lang)}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Jenis" htmlFor="tkind">
          <Select id="tkind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option>DP</option>
            <option>Termin 1</option>
            <option>Termin 2</option>
            <option>Termin 3</option>
            <option>Pelunasan</option>
          </Select>
        </Field>
        <Field label="Nama proyek" htmlFor="tproj">
          <TextInput id="tproj" value={project} placeholder="Contoh: Pembuatan website" onChange={(e) => setProject(e.target.value)} />
        </Field>
        <Field label="Nilai proyek total">
          <NumberInput aria-label="Nilai proyek total" lang={inv.lang} decimals={displayDecimals(inv.currency)} value={value} onChange={setValue} />
        </Field>
        <Field label="Persentase">
          <NumberInput aria-label="Persentase" lang={inv.lang} suffix="%" value={pct} onChange={setPct} />
          <div className="flex gap-1.5">
            {[30, 50, 70, 100].map((p) => (
              <button key={p} type="button" onClick={() => setPct(p)} className={`min-h-8 rounded-lg border px-2.5 text-xs font-semibold ${pct === p ? 'border-ink bg-ink text-bg' : 'border-line text-muted'}`}>
                {p}%
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Sheet>
  );
}

function AdjustmentsEditor({ inv, update }: { inv: Invoice; update: Update }) {
  const set = (id: string, patch: Partial<Adjustment>) => update((cur) => ({ adjustments: cur.adjustments.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const add = (kind: Adjustment['kind'], label: string) => update((cur) => ({ adjustments: [...cur.adjustments, { id: uid(), label, kind, amount: 0 }] }));
  return (
    <div>
      <p className="text-[13px] font-semibold">Penyesuaian lain</p>
      <p className="mb-2 text-xs text-muted">Biaya tambahan seperti ongkir, atau pengurang seperti DP yang sudah dibayar.</p>
      <div className="flex flex-col gap-3">
        {inv.adjustments.map((a) => (
          <div key={a.id} className="rounded-xl border border-line p-2">
            <div className="flex items-center gap-2">
              <TextInput aria-label="Keterangan penyesuaian" className="flex-1" placeholder="Keterangan" value={a.label} onChange={(e) => set(a.id, { label: e.target.value })} />
              <IconButton label="Hapus penyesuaian" onClick={() => update((cur) => ({ adjustments: cur.adjustments.filter((x) => x.id !== a.id) }))}>
                <IconTrash size={18} />
              </IconButton>
            </div>
            <div className="mt-2 flex gap-2">
              <div className="w-32 shrink-0">
                <Select aria-label="Jenis penyesuaian" value={a.kind} onChange={(e) => set(a.id, { kind: e.target.value as Adjustment['kind'] })}>
                  <option value="add">Tambah (+)</option>
                  <option value="less">Kurangi (−)</option>
                </Select>
              </div>
              <NumberInput aria-label="Jumlah penyesuaian" className="flex-1" lang={inv.lang} decimals={displayDecimals(inv.currency)} value={a.amount} onChange={(v) => set(a.id, { amount: Math.abs(v) })} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => add('add', inv.lang === 'id' ? 'Ongkos kirim' : 'Shipping')}>
          <IconPlus size={16} /> Biaya tambahan
        </Button>
        <Button size="sm" onClick={() => add('less', inv.lang === 'id' ? 'Dikurangi DP' : 'Less down payment')}>
          <IconPlus size={16} /> Potongan / DP
        </Button>
      </div>
    </div>
  );
}

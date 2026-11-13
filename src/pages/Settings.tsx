import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, requestPersistentStorage, updateSettings } from '../db';
import { useAllTemplates, useSettings, useStorageHealth } from '../hooks';
import { exportBackup, importBackup, markBackedUp, readBackup, type ImportMode } from '../lib/backup';
import { imageToDataURL, shareOrDownload } from '../lib/files';
import { CURRENCIES } from '../lib/money';
import { NUMBER_TOKENS, formatNumberPattern, periodKey } from '../lib/numbering';
import { todayISO, uid } from '../lib/id';
import { formatDate } from '../lib/labels';
import type { NumberingRule, Settings } from '../types';
import { PageHeader } from '../components/layout';
import { InstallApp } from '../components/InstallApp';
import { SignaturePad } from '../components/SignaturePad';
import { Button, Card, Field, IconButton, ImagePicker, Loading, NumberInput, Segmented, Select, Sheet, TextArea, TextInput, Toggle, useUI } from '../components/ui';
import { IconDownload, IconPlus, IconTrash, IconUpload } from '../components/icons';

type Editable = Omit<Settings, 'numbering' | 'receiptNumbering' | 'quoteNumbering'> & {
  numbering: Omit<NumberingRule, 'counters'>;
  receiptNumbering: Omit<NumberingRule, 'counters'>;
  quoteNumbering: Omit<NumberingRule, 'counters'>;
};

function Section({ id, title, desc, children }: { id?: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <Card className="scroll-mt-20">
      <div id={id} className="mb-4">
        <h2 className="text-base font-bold">{title}</h2>
        {desc && <p className="mt-0.5 text-sm text-muted">{desc}</p>}
      </div>
      {children}
    </Card>
  );
}

type SettingsTab = 'profil' | 'pembayaran' | 'default' | 'backup';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'profil', label: 'Profil Usaha' },
  { id: 'pembayaran', label: 'Rekening & QRIS' },
  { id: 'default', label: 'Default & Penomoran' },
  { id: 'backup', label: 'Backup & Tampilan' },
];

export function SettingsPage() {
  const settings = useSettings();
  const [s, setS] = useState<Editable | null>(null);
  const dirty = useRef(false);
  const location = useLocation();

  const [tab, setTab] = useState<SettingsTab>(() => {
    if (location.hash === '#backup') return 'backup';
    if (location.hash === '#numbering') return 'default';
    return 'profil';
  });
  const [sigMode, setSigMode] = useState<'upload' | 'draw'>('upload');

  useEffect(() => {
    if (location.hash === '#backup') setTab('backup');
    if (location.hash === '#numbering') setTab('default');
  }, [location.hash]);

  useEffect(() => {
    if (settings && !s) setS(settings);
  }, [settings, s]);

  useEffect(() => {
    if (s && location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }, [!!s, location.hash]);

  // Counters are left out on purpose: they change from other screens and must never be overwritten by this form.
  useEffect(() => {
    if (!s || !dirty.current) return;
    const t = setTimeout(() => {
      updateSettings((cur) => ({
        ...cur,
        ...s,
        numbering: { ...cur.numbering, format: s.numbering.format, reset: s.numbering.reset },
        receiptNumbering: { ...cur.receiptNumbering, format: s.receiptNumbering.format, reset: s.receiptNumbering.reset },
        quoteNumbering: { ...cur.quoteNumbering, format: s.quoteNumbering.format, reset: s.quoteNumbering.reset },
        lastBackupAt: cur.lastBackupAt,
      }));
    }, 400);
    return () => clearTimeout(t);
  }, [s]);

  if (!s || !settings) return <Loading />;

  const patch = (p: Partial<Editable>) => {
    dirty.current = true;
    setS((cur) => (cur ? { ...cur, ...p } : cur));
  };
  const biz = (k: keyof Settings['business'], v: string | undefined) => patch({ business: { ...s.business, [k]: v } });
  const def = <K extends keyof Settings['defaults']>(k: K, v: Settings['defaults'][K]) => patch({ defaults: { ...s.defaults, [k]: v } });

  return (
    <>
      <PageHeader title="Pengaturan" sub="Tersimpan otomatis di perangkat ini" />

      {/* Settings Tab Navigation */}
      <div className="no-scrollbar -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 pb-px md:mx-0 md:px-0" role="tablist">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold whitespace-nowrap transition-all ${
              tab === t.id
                ? 'border-clay text-clay'
                : 'border-transparent text-muted hover:border-line hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-5">
        {tab === 'profil' && (
          <>
            <Section title="Profil usaha" desc="Tampil di kepala setiap invoice dan kwitansi.">
              <div className="flex flex-col gap-4">
                <ImageField label="Logo" hint="PNG transparan paling rapi" value={s.business.logo} onChange={(v) => biz('logo', v)} maxSize={600} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nama usaha / nama kamu" htmlFor="b-name">
                    <TextInput id="b-name" value={s.business.name} onChange={(e) => biz('name', e.target.value)} />
                  </Field>
                  <Field label="NPWP" htmlFor="b-tax" hint="Opsional">
                    <TextInput id="b-tax" value={s.business.taxId} onChange={(e) => biz('taxId', e.target.value)} />
                  </Field>
                  <Field label="No. HP / WhatsApp" htmlFor="b-phone">
                    <TextInput id="b-phone" type="tel" inputMode="tel" value={s.business.phone} onChange={(e) => biz('phone', e.target.value)} />
                  </Field>
                  <Field label="Email" htmlFor="b-email">
                    <TextInput id="b-email" type="email" inputMode="email" value={s.business.email} onChange={(e) => biz('email', e.target.value)} />
                  </Field>
                  <Field label="Website" htmlFor="b-web">
                    <TextInput id="b-web" inputMode="url" value={s.business.website} onChange={(e) => biz('website', e.target.value)} />
                  </Field>
                  <Field label="Alamat" htmlFor="b-addr" className="sm:col-span-2">
                    <TextArea id="b-addr" rows={2} value={s.business.address} onChange={(e) => biz('address', e.target.value)} />
                  </Field>
                </div>
              </div>
            </Section>

            <Section title="Tanda tangan & stempel" desc="Unggah foto tanda tangan di kertas putih, atau gambar langsung di layar. Latar putih foto dihapus otomatis.">
              <div className="flex flex-col gap-4">
                <Segmented
                  label="Cara mengisi tanda tangan"
                  value={sigMode}
                  onChange={setSigMode}
                  options={[
                    { value: 'upload', label: 'Unggah foto' },
                    { value: 'draw', label: 'Gambar di layar' },
                  ]}
                />
                {sigMode === 'upload' ? (
                  <ImageField label="Tanda tangan" value={s.signature.image} onChange={(v) => patch({ signature: { ...s.signature, image: v } })} removeWhite checkered />
                ) : (
                  <div className="flex flex-col gap-2">
                    <SignaturePad onChange={(v) => patch({ signature: { ...s.signature, image: v } })} />
                    {s.signature.image && (
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <img src={s.signature.image} alt="Tanda tangan tersimpan" className="h-12 rounded-lg border border-line bg-white object-contain px-2" />
                        <span>Tersimpan. Gambar ulang untuk mengganti.</span>
                      </div>
                    )}
                  </div>
                )}
                <ImageField label="Stempel" hint="Opsional" value={s.stamp} onChange={(v) => patch({ stamp: v })} removeWhite checkered />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nama penanda tangan" htmlFor="sig-name">
                    <TextInput id="sig-name" value={s.signature.name} onChange={(e) => patch({ signature: { ...s.signature, name: e.target.value } })} />
                  </Field>
                  <Field label="Jabatan" htmlFor="sig-title" hint="Opsional">
                    <TextInput id="sig-title" value={s.signature.title} onChange={(e) => patch({ signature: { ...s.signature, title: e.target.value } })} />
                  </Field>
                </div>
              </div>
            </Section>
          </>
        )}

        {tab === 'pembayaran' && (
          <>
            <Section title="Rekening & QRIS" desc="Pilih per invoice rekening mana yang ditampilkan.">
              <div className="flex flex-col gap-3">
                {s.bankAccounts.map((b, i) => (
                  <div key={b.id} className="rounded-xl border border-line p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Bank / e-wallet" htmlFor={`bank-${b.id}`}>
                        <TextInput
                          id={`bank-${b.id}`}
                          value={b.bank}
                          placeholder="BCA"
                          onChange={(e) => patch({ bankAccounts: s.bankAccounts.map((x, j) => (j === i ? { ...x, bank: e.target.value } : x)) })}
                        />
                      </Field>
                      <Field label="No. rekening" htmlFor={`acc-${b.id}`}>
                        <TextInput
                          id={`acc-${b.id}`}
                          inputMode="numeric"
                          value={b.number}
                          onChange={(e) => patch({ bankAccounts: s.bankAccounts.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)) })}
                        />
                      </Field>
                    </div>
                    <div className="mt-2 flex items-end gap-2">
                      <Field label="Atas nama" htmlFor={`holder-${b.id}`} className="flex-1">
                        <TextInput
                          id={`holder-${b.id}`}
                          value={b.holder}
                          onChange={(e) => patch({ bankAccounts: s.bankAccounts.map((x, j) => (j === i ? { ...x, holder: e.target.value } : x)) })}
                        />
                      </Field>
                      <IconButton label="Hapus rekening" onClick={() => patch({ bankAccounts: s.bankAccounts.filter((x) => x.id !== b.id) })}>
                        <IconTrash size={18} />
                      </IconButton>
                    </div>
                  </div>
                ))}
                <Button onClick={() => patch({ bankAccounts: [...s.bankAccounts, { id: uid(), bank: '', number: '', holder: s.business.name }] })}>
                  <IconPlus size={18} /> Tambah rekening
                </Button>
                <div className="mt-2">
                  <ImageField label="Gambar QRIS" hint="Screenshot QRIS statis dari aplikasi bank" value={s.qris} onChange={(v) => patch({ qris: v })} maxSize={900} />
                </div>
              </div>
            </Section>

            <Section title="Pesan saat membagikan" desc="Ikut terkirim bersama PDF di WhatsApp atau email.">
              <TextArea aria-label="Template pesan" rows={3} value={s.shareMessage} onChange={(e) => patch({ shareMessage: e.target.value })} />
              <p className="mt-2 text-xs text-muted">
                Bisa pakai: <code className="font-mono">{'{klien}'}</code> <code className="font-mono">{'{nomor}'}</code> <code className="font-mono">{'{total}'}</code>{' '}
                <code className="font-mono">{'{jatuh_tempo}'}</code> <code className="font-mono">{'{usaha}'}</code>
              </p>
              <p className="mt-4 mb-1.5 text-[13px] font-semibold">Pesan pengingat</p>
              <p className="mb-2 text-xs text-muted">Dipakai otomatis untuk invoice yang lewat tempo atau jatuh tempo dalam 3 hari.</p>
              <TextArea aria-label="Template pesan pengingat" rows={3} value={s.reminderMessage} onChange={(e) => patch({ reminderMessage: e.target.value })} />
            </Section>
          </>
        )}

        {tab === 'default' && (
          <>
            <DefaultsSection s={s} def={def} />

            <Section title="Katalog produk & jasa" desc="Item yang sering ditagih, lengkap dengan harga dan satuan. Muncul sebagai saran saat mengetik deskripsi item.">
              <Link to="/produk" className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken">
                Kelola katalog →
              </Link>
            </Section>

            <Section title="Invoice berulang" desc="Buat draft otomatis tiap bulan, 3 bulan, atau tahun dari invoice yang sudah ada.">
              <Link to="/berulang" className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken">
                Kelola jadwal berulang →
              </Link>
            </Section>

            <Section id="numbering" title="Penomoran" desc="Nomor diberikan saat invoice dibuat dan tetap bisa diubah manual.">
              <NumberingEditor kind="numbering" s={s} settings={settings} onChange={(r) => patch({ numbering: r })} />
              <div className="my-5 border-t border-line" />
              <p className="mb-3 text-sm font-bold">Nomor kwitansi</p>
              <NumberingEditor kind="receiptNumbering" s={s} settings={settings} onChange={(r) => patch({ receiptNumbering: r })} />
              <div className="my-5 border-t border-line" />
              <p className="mb-3 text-sm font-bold">Nomor penawaran</p>
              <NumberingEditor kind="quoteNumbering" s={s} settings={settings} onChange={(r) => patch({ quoteNumbering: r })} />
            </Section>
          </>
        )}

        {tab === 'backup' && (
          <>
            <Section title="Tampilan aplikasi">
              <Segmented
                label="Tema"
                value={s.theme}
                onChange={(v) => patch({ theme: v })}
                options={[
                  { value: 'system', label: 'Ikuti HP' },
                  { value: 'light', label: 'Terang' },
                  { value: 'dark', label: 'Gelap' },
                ]}
              />
              <div className="mt-4">
                <InstallApp />
              </div>
            </Section>

            <BackupSection />
          </>
        )}
      </div>
    </>
  );
}

function DefaultsSection({ s, def }: { s: Editable; def: <K extends keyof Settings['defaults']>(k: K, v: Settings['defaults'][K]) => void }) {
  const templates = useAllTemplates();
  return (
    <Section title="Default invoice baru" desc="Tetap bisa diubah per invoice.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mata uang" htmlFor="d-cur">
          <Select id="d-cur" value={s.defaults.currency} onChange={(e) => def('currency', e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Jatuh tempo (hari)" htmlFor="d-due">
          <NumberInput id="d-due" decimals={0} value={s.defaults.dueDays} onChange={(v) => def('dueDays', Math.max(0, Math.round(v)))} />
        </Field>
        <Field label="Bahasa dokumen">
          <Segmented
            label="Bahasa dokumen"
            value={s.defaults.lang}
            onChange={(v) => def('lang', v)}
            options={[
              { value: 'id', label: 'Indonesia' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Field>
        <Field label="Template" htmlFor="d-tpl">
          <Select id="d-tpl" value={s.defaults.templateId} onChange={(e) => def('templateId', e.target.value)}>
            {templates?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-4 rounded-xl bg-sunken p-3">
        <Toggle checked={s.defaults.taxEnabled} onChange={(v) => def('taxEnabled', v)} label="Pakai PPN secara default" hint="Matikan kalau kamu bukan PKP" />
        {s.defaults.taxEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Label" htmlFor="d-taxl">
              <TextInput id="d-taxl" value={s.defaults.taxLabel} onChange={(e) => def('taxLabel', e.target.value)} />
            </Field>
            <Field label="Tarif" htmlFor="d-taxr">
              <NumberInput id="d-taxr" suffix="%" value={s.defaults.taxRate} onChange={(v) => def('taxRate', v)} />
            </Field>
            <div className="col-span-2">
              <Segmented
                label="Cara hitung"
                value={s.defaults.taxInclusive ? 'incl' : 'excl'}
                onChange={(v) => def('taxInclusive', v === 'incl')}
                options={[
                  { value: 'excl', label: 'Ditambahkan' },
                  { value: 'incl', label: 'Sudah termasuk' },
                ]}
              />
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 rounded-xl bg-sunken p-3">
        <Toggle checked={s.defaults.pphEnabled} onChange={(v) => def('pphEnabled', v)} label="Potongan PPh secara default" />
        {s.defaults.pphEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Label" htmlFor="d-pphl">
              <TextInput id="d-pphl" value={s.defaults.pphLabel} onChange={(e) => def('pphLabel', e.target.value)} />
            </Field>
            <Field label="Tarif" htmlFor="d-pphr">
              <NumberInput id="d-pphr" suffix="%" value={s.defaults.pphRate} onChange={(v) => def('pphRate', v)} />
            </Field>
          </div>
        )}
      </div>
      <div className="mt-4 grid gap-3">
        <Toggle checked={s.defaults.showQris} onChange={(v) => def('showQris', v)} label="Tampilkan QRIS secara default" />
        <Field label="Catatan default" htmlFor="d-notes">
          <TextArea id="d-notes" rows={2} value={s.defaults.notes} onChange={(e) => def('notes', e.target.value)} />
        </Field>
        <Field label="Syarat & ketentuan default" htmlFor="d-terms">
          <TextArea id="d-terms" rows={3} value={s.defaults.terms} onChange={(e) => def('terms', e.target.value)} />
        </Field>
      </div>
    </Section>
  );
}

function NumberingEditor({ kind, s, settings, onChange }: { kind: 'numbering' | 'receiptNumbering' | 'quoteNumbering'; s: Editable; settings: Settings; onChange: (r: Omit<NumberingRule, 'counters'>) => void }) {
  const { toast } = useUI();
  const rule = s[kind];
  const today = todayISO();
  const live = settings[kind];
  const key = periodKey({ ...rule, counters: {} }, today);
  const nextSeq = (live.counters[key] ?? 0) + 1;
  const [nextInput, setNextInput] = useState(nextSeq);
  useEffect(() => setNextInput(nextSeq), [nextSeq]);
  const inputId = useId();

  return (
    <div className="flex flex-col gap-3">
      <Field label="Format" htmlFor={inputId}>
        <TextInput id={inputId} className="font-mono" value={rule.format} onChange={(e) => onChange({ ...rule, format: e.target.value })} />
        <div className="flex flex-wrap gap-1.5">
          {NUMBER_TOKENS.filter((t) => kind === 'numbering' || t.token !== '{CLIENT}').map((t) => (
            <button key={t.token} type="button" title={t.label} onClick={() => onChange({ ...rule, format: rule.format + t.token })} className="min-h-8 rounded-lg border border-line px-2 font-mono text-xs">
              {t.token}
            </button>
          ))}
        </div>
      </Field>
      <p className="rounded-xl bg-sunken px-3 py-2 text-sm">
        Berikutnya: <span className="font-mono font-medium text-clay">{formatNumberPattern(rule.format, today, nextSeq, 'ABC')}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Urutan diulang dari 1">
          <Select aria-label="Reset urutan" value={rule.reset} onChange={(e) => onChange({ ...rule, reset: e.target.value as NumberingRule['reset'] })}>
            <option value="yearly">Setiap tahun</option>
            <option value="monthly">Setiap bulan</option>
            <option value="never">Tidak pernah</option>
          </Select>
        </Field>
        <Field label="Urutan berikutnya" hint="Ubah kalau pindah dari aplikasi lain">
          <div className="flex gap-2">
            <NumberInput aria-label="Urutan berikutnya" decimals={0} value={nextInput} onChange={(v) => setNextInput(Math.max(1, Math.round(v)))} />
            <Button
              disabled={nextInput === nextSeq}
              onClick={async () => {
                await updateSettings((cur) => ({ ...cur, [kind]: { ...cur[kind], counters: { ...cur[kind].counters, [key]: nextInput - 1 } } }));
                toast('Urutan diperbarui');
              }}
            >
              Terapkan
            </Button>
          </div>
        </Field>
      </div>
    </div>
  );
}

function ImageField({ label, hint, value, onChange, maxSize = 700, removeWhite, checkered }: { label: string; hint?: string; value?: string; onChange: (v: string | undefined) => void; maxSize?: number; removeWhite?: boolean; checkered?: boolean }) {
  const { toast } = useUI();
  return (
    <ImagePicker
      label={label}
      hint={hint}
      value={value}
      checkered={checkered}
      onClear={() => onChange(undefined)}
      onPick={async (f) => {
        try {
          let url = await imageToDataURL(f, maxSize);
          if (removeWhite) url = await whiteToTransparent(url);
          onChange(url);
        } catch (e) {
          toast((e as Error).message, 'error');
        }
      }}
    />
  );
}

// Phone photos of a signature on paper are never pure white, so near-white pixels are faded out with a soft edge.
async function whiteToTransparent(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new Image();
    el.onload = () => res(el);
    el.onerror = rej;
    el.src = dataUrl;
  });
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (lum > 215) px[i + 3] = 0;
    else if (lum > 170) px[i + 3] = Math.round(px[i + 3] * ((215 - lum) / 45));
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

function BackupSection() {
  const { toast, confirm } = useUI();
  const settings = useSettings();
  const counts = useLiveQuery(async () => ({ invoices: await db.invoices.count(), clients: await db.clients.count(), templates: await db.templates.count() }), []);
  const storage = useStorageHealth();
  const [pending, setPending] = useState<Awaited<ReturnType<typeof readBackup>> | null>(null);
  const fileId = useId();

  const doImport = async (mode: ImportMode) => {
    if (!pending) return;
    if (mode === 'replace') {
      const ok = await confirm({ title: 'Ganti semua data?', message: 'Semua invoice, klien, template, dan pengaturan di perangkat ini akan diganti isi backup. Tidak bisa dibatalkan.', confirmLabel: 'Ganti semua', danger: true });
      if (!ok) return;
    }
    try {
      await importBackup(pending, mode);
      storage.refresh();
      toast(`Backup dipulihkan: ${pending.invoices.length} invoice, ${pending.clients.length} klien`);
      setPending(null);
      if (mode === 'replace') setTimeout(() => location.reload(), 600);
    } catch (e) {
      toast(`Gagal memulihkan: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <Section id="backup" title="Backup & pindah perangkat" desc="Semua data hanya tersimpan di browser ini. Simpan file backup ke Google Drive atau kirim ke diri sendiri, lalu pulihkan di HP atau laptop lain.">
      {counts && (
        <p className="mb-3 text-sm text-muted">
          Di perangkat ini: {counts.invoices} invoice, {counts.clients} klien, {counts.templates} template buatan sendiri.
          {settings?.lastBackupAt ? ` Backup terakhir ${formatDate(new Date(settings.lastBackupAt).toISOString().slice(0, 10), 'id')}.` : ' Belum pernah backup.'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={async () => {
            try {
              const f = await exportBackup();
              const res = await shareOrDownload(f);
              if (res === 'cancelled') return;
              await markBackedUp();
              storage.refresh();
              toast(res === 'shared' ? 'File backup dibagikan' : 'File backup diunduh');
            } catch (e) {
              toast(`Backup gagal: ${(e as Error).message}`, 'error');
            }
          }}
        >
          <IconDownload size={18} /> Buat backup
        </Button>
        <label htmlFor={fileId} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken focus-within:outline-2 focus-within:outline-[var(--focus)]">
          <IconUpload size={18} /> Pulihkan dari file
          <input
            id={fileId}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                setPending(await readBackup(f));
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            }}
          />
        </label>
      </div>
      <div className="mt-3 rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold">Penyimpanan perangkat</span>
          <span className="num text-muted">
            {storage.loading ? 'Memeriksa...' : storage.quota > 0 ? `${formatBytes(storage.usage)} dari ${formatBytes(storage.quota)}` : 'Tidak tersedia'}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
          <div
            className={`h-full rounded-full ${storage.percent > 75 ? 'bg-danger' : storage.percent > 50 ? 'bg-warn' : 'bg-ok'}`}
            style={{ width: `${Math.min(100, Math.max(2, storage.percent))}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            {storage.persisted === true
              ? 'Data dilindungi dari pembersihan otomatis browser.'
              : storage.persisted === false
                ? 'Browser belum menjamin data ini tidak dihapus saat penyimpanan penuh.'
                : 'Status perlindungan data tidak tersedia di browser ini.'}
          </span>
          {storage.persisted !== true && (
            <Button
              size="sm"
              onClick={async () => {
                const ok = await requestPersistentStorage();
                toast(ok ? 'Penyimpanan permanen aktif' : 'Browser menolak permintaan penyimpanan permanen', ok ? 'ok' : 'error');
                storage.refresh();
              }}
            >
              Minta penyimpanan permanen
            </Button>
          )}
        </div>
        {storage.percent > 75 && (
          <p className="mt-2 text-xs font-semibold text-warn">Penyimpanan hampir penuh. Unduh backup lalu hapus invoice lama atau gambar yang tidak dipakai.</p>
        )}
      </div>
      <Sheet open={!!pending} onClose={() => setPending(null)} title="Pulihkan backup">
        {pending && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Backup tanggal <b>{formatDate(pending.exportedAt.slice(0, 10), 'id')}</b> berisi {pending.invoices.length} invoice, {pending.clients.length} klien, {pending.templates.length} template.
            </p>
            <Button variant="primary" size="lg" onClick={() => doImport('merge')}>
              Gabungkan dengan data sekarang
            </Button>
            <p className="-mt-1 text-xs text-muted">
              Data yang sama dipilih versi yang terakhir diubah.{' '}
              {settings?.business.name.trim() ? 'Pengaturan di perangkat ini tetap.' : 'Profil usaha, rekening, dan tanda tangan diambil dari backup karena perangkat ini belum diatur.'}
            </p>
            <Button variant="danger" onClick={() => doImport('replace')}>
              Ganti semua data dengan backup
            </Button>
          </div>
        )}
      </Sheet>
    </Section>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

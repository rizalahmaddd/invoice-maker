import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { convertQuoteToInvoice, createRevision, createSettlement, db, decideQuote, deleteInvoice, deriveStatus, duplicateInvoice, getTemplate, reserveReceiptNumber } from '../db';
import { useInvoicePdf, useSettings } from '../hooks';
import { computeTotals, displayDecimals, formatMoney } from '../lib/money';
import { addDays } from '../lib/id';
import { formatDate } from '../lib/labels';
import { copyText, downloadFile, printPdf, safeFileName, shareOrDownload } from '../lib/files';
import { buildMessage, waNumber } from '../lib/share';
import { todayISO, uid } from '../lib/id';
import type { Invoice, Payment, Settings, TemplateConfig } from '../types';
import { PageHeader, StatusStamp } from '../components/layout';
import { Button, Card, EmptyState, Field, IconButton, Loading, NumberInput, Sheet, TextInput, useUI } from '../components/ui';
import { IconCheck, IconCopy, IconDownload, IconEdit, IconMore, IconPrinter, IconReceipt, IconShare, IconTrash, IconWallet } from '../components/icons';
import { PdfPreview } from '../components/PdfPreview';
import { RecurrenceSheet } from './Recurring';

export function InvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, confirm } = useUI();
  const settings = useSettings();
  const inv = useLiveQuery(() => db.invoices.get(id!).then((r) => r ?? null), [id]);
  const [tpl, setTpl] = useState<TemplateConfig>();
  const [payOpen, setPayOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [recurOpen, setRecurOpen] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (inv) getTemplate(inv.templateId).then(setTpl);
  }, [inv?.templateId]);

  const status = inv ? deriveStatus(inv) : 'draft';
  const pdf = useInvoicePdf(inv ?? undefined, tpl, settings, status, 0);

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

  const t = computeTotals(inv);
  const isQuote = inv.kind === 'quote';
  const fileName = `${safeFileName(inv.number)}${inv.client.name ? '_' + safeFileName(inv.client.name) : ''}.pdf`;
  const reminder = !isQuote && (status === 'overdue' || ((status === 'sent' || status === 'partial') && !!inv.dueDate && inv.dueDate <= addDays(todayISO(), 3)));
  const message = buildMessage(reminder ? settings.reminderMessage : settings.shareMessage, inv, settings);
  const waLabel = reminder ? 'Kirim pengingat WA' : 'Kirim Chat WA';

  const copyMessage = async () => {
    const ok = await copyText(message);
    toast(ok ? 'Pesan disalin' : 'Gagal menyalin pesan', ok ? 'ok' : 'error');
  };

  const markSent = async () => {
    if (inv.status === 'draft') await db.invoices.update(inv.id, { status: 'sent', sentAt: Date.now(), updatedAt: Date.now() });
  };

  const offerMarkSent = (msg: string) => {
    if (inv.status !== 'draft') return toast(msg);
    toast(msg, 'ok', { label: 'Tandai terkirim', onClick: () => markSent().then(() => toast('Ditandai terkirim')) });
  };

  const download = () => {
    if (!pdf.blob) return;
    downloadFile(new File([pdf.blob], fileName, { type: 'application/pdf' }));
    offerMarkSent('PDF diunduh');
  };

  const print = async () => {
    if (!pdf.blob) return;
    try {
      await printPdf(pdf.blob);
      offerMarkSent('Dokumen siap dicetak');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const share = async () => {
    if (!pdf.blob) return;
    setWorking(true);
    try {
      const res = await shareOrDownload(new File([pdf.blob], fileName, { type: 'application/pdf' }), message);
      if (res === 'shared') {
        await markSent();
        toast(inv.status === 'draft' ? 'Terkirim. Status diubah jadi Terkirim.' : 'PDF dibagikan');
      } else if (res === 'downloaded') {
        offerMarkSent('Perangkat ini tidak mendukung bagikan file, PDF diunduh.');
      }
    } finally {
      setWorking(false);
    }
  };

  const doAction = async (fn: () => Promise<void>) => {
    if (working) return;
    setMoreOpen(false);
    setWorking(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setWorking(false);
    }
  };

  const convert = async () => {
    const invoice = await convertQuoteToInvoice(inv);
    toast('Invoice dibuat dari penawaran');
    navigate(`/invoice/${invoice.id}/edit`, { state: { fresh: true } });
  };

  const decide = async (state: 'accepted' | 'rejected') => {
    await decideQuote(inv.id, state);
    toast(state === 'accepted' ? 'Penawaran ditandai diterima' : 'Penawaran ditandai ditolak');
  };

  const voided = inv.status === 'void';

  return (
    <div>

      <PageHeader
        back="/"
        title={<span className="font-mono text-xl md:text-2xl font-bold">{inv.number}</span>}
        sub={
          <div className="flex items-center gap-2">
            <span>{inv.client.name || 'Klien belum diisi'}</span>
            <span>·</span>
            <StatusStamp status={status} />
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            {!voided && (
              <>
                {isQuote && !inv.convertedTo && (
                  <Button variant="clay" onClick={() => doAction(convert)} disabled={working} className="shadow-xs">
                    <IconCheck size={16} /> Jadikan Invoice
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={share}
                  disabled={!pdf.blob || working}
                  className="hidden sm:inline-flex shadow-xs"
                >
                  <IconShare size={16} /> Bagikan PDF
                </Button>

                <Button
                  onClick={download}
                  disabled={!pdf.blob}
                  className="hidden sm:inline-flex"
                >
                  <IconDownload size={16} /> Unduh
                </Button>

                <Button onClick={print} disabled={!pdf.blob} className="hidden sm:inline-flex">
                  <IconPrinter size={16} /> Cetak
                </Button>

                <Button onClick={() => navigate(`/invoice/${inv.id}/edit`)} className="hidden sm:inline-flex">
                  <IconEdit size={16} /> Edit
                </Button>

                {!isQuote && t.balance > 0 && (
                  <Button variant="clay" onClick={() => setPayOpen(true)} className="shadow-xs">
                    <IconWallet size={16} /> Catat Bayar
                  </Button>
                )}
              </>
            )}

            <IconButton label="Aksi lain" onClick={() => setMoreOpen(true)}>
              <IconMore />
            </IconButton>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,440px)] xl:grid-cols-[minmax(0,1.3fr)_minmax(0,480px)] gap-6 lg:gap-8 items-start">
        {/* Left: Document PDF Preview */}
        <div className="min-w-0">
          <div className="sticky top-20">
            <PdfPreview blob={pdf.blob} busy={pdf.busy} error={pdf.error} showControls={true} />
          </div>
        </div>

        {/* Right: Summary, Client, Actions & Payments */}
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                {isQuote ? 'Total Penawaran' : t.paid > 0 && t.balance > 0 ? 'Sisa Tagihan' : 'Total Tagihan'}
              </p>
              <StatusStamp status={status} />
            </div>

            <p className="num mt-1 text-3xl font-mono font-extrabold tracking-tight text-text">
              {formatMoney(t.paid > 0 && t.balance > 0 ? t.balance : t.grandTotal, inv.currency, inv.lang)}
            </p>

            {t.paid > 0 && t.balance > 0 && (
              <p className="mt-1 text-xs text-muted">
                Total awal {formatMoney(t.grandTotal, inv.currency, inv.lang)} · Terbayar {formatMoney(t.paid, inv.currency, inv.lang)}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3 text-xs text-muted">
              <span>Terbit: <strong className="text-text">{formatDate(inv.issueDate, 'id', 'short')}</strong></span>
              {inv.dueDate && (
                <>
                  <span>·</span>
                  <span>{isQuote ? 'Berlaku sampai' : 'Tempo'}: <strong className="text-text">{formatDate(inv.dueDate, 'id', 'short')}</strong></span>
                </>
              )}
            </div>

            {inv.convertedTo && (
              <Link to={`/invoice/${inv.convertedTo}`} className="mt-3 block text-sm font-semibold text-ok hover:underline">
                Invoice dari penawaran ini →
              </Link>
            )}
            {inv.supersededBy && (
              <Link to={`/invoice/${inv.supersededBy}`} className="mt-3 block text-sm font-semibold text-clay hover:underline">
                Invoice ini sudah direvisi. Buka versi terbaru →
              </Link>
            )}
            {inv.revisionOf && (
              <Link to={`/invoice/${inv.revisionOf}`} className="mt-3 block text-sm text-muted hover:underline">
                ← Revisi dari invoice sebelumnya
              </Link>
            )}

            {/* Mobile Actions Grid */}
            {!voided && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:hidden">
                {isQuote && !inv.convertedTo && (
                  <Button variant="clay" size="lg" className="col-span-2" onClick={() => doAction(convert)} disabled={working}>
                    <IconCheck size={18} /> Jadikan Invoice
                  </Button>
                )}
                <Button variant="primary" size="lg" className="col-span-2" onClick={share} disabled={!pdf.blob || working}>
                  <IconShare size={18} /> Bagikan PDF
                </Button>
                <Button onClick={download} disabled={!pdf.blob}>
                  <IconDownload size={18} /> Unduh
                </Button>
                <Button onClick={() => navigate(`/invoice/${inv.id}/edit`)}>
                  <IconEdit size={18} /> Edit
                </Button>
                <Button onClick={print} disabled={!pdf.blob} className="col-span-2">
                  <IconPrinter size={18} /> Cetak
                </Button>
                {inv.client.phone ? (
                  <a
                    href={`https://wa.me/${waNumber(inv.client.phone)}?text=${encodeURIComponent(message)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken col-span-2"
                  >
                    {reminder ? 'Kirim pengingat WA' : 'Chat WA Klien'}
                  </a>
                ) : (
                  <Button onClick={copyMessage} className="col-span-2">
                    <IconCopy size={18} /> Salin Pesan
                  </Button>
                )}
              </div>
            )}

            {/* Desktop Quick WhatsApp & Message */}
            {!voided && (
              <div className="mt-4 hidden sm:flex sm:items-center sm:gap-2">
                {inv.client.phone ? (
                  <a
                    href={`https://wa.me/${waNumber(inv.client.phone)}?text=${encodeURIComponent(message)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken transition-colors"
                  >
                    {waLabel}
                  </a>
                ) : null}
                <Button onClick={copyMessage} className={inv.client.phone ? '' : 'w-full'}>
                  <IconCopy size={16} /> {reminder ? 'Salin pesan pengingat' : 'Salin Format Pesan'}
                </Button>
              </div>
            )}

            {inv.status === 'draft' && !voided && (
              <button
                type="button"
                onClick={() => markSent().then(() => toast('Ditandai terkirim'))}
                className="mt-3 min-h-9 w-full text-center text-xs font-semibold text-muted hover:text-text hover:underline"
              >
                Sudah kirim lewat cara lain? Tandai terkirim
              </button>
            )}
          </Card>

          {/* Client Details Card */}
          {inv.client.name && (
            <Card>
              <h2 className="mb-2 text-xs font-semibold text-muted uppercase tracking-wider">Informasi Klien</h2>
              <p className="font-bold text-base text-text">{inv.client.name}</p>
              {inv.client.contactPerson && (
                <p className="text-xs text-muted mt-0.5">Up. {inv.client.contactPerson}</p>
              )}
              <div className="mt-2.5 flex flex-col gap-1 text-xs text-muted">
                {inv.client.phone && <p>Telp/WA: <span className="text-text font-medium">{inv.client.phone}</span></p>}
                {inv.client.email && <p>Email: <span className="text-text font-medium">{inv.client.email}</span></p>}
                {inv.client.address && <p>Alamat: <span className="text-text font-medium">{inv.client.address}</span></p>}
                {inv.client.taxId && <p>NPWP: <span className="font-mono text-text font-medium">{inv.client.taxId}</span></p>}
              </div>
            </Card>
          )}

          {!isQuote && <PaymentsCard inv={inv} settings={settings} tpl={tpl} />}
        </div>
      </div>

      {!isQuote && <RecordPaymentSheet open={payOpen} onClose={() => setPayOpen(false)} inv={inv} />}
      <RecurrenceSheet open={recurOpen} onClose={() => setRecurOpen(false)} invoice={inv} />

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Aksi lain">

        <div className="flex flex-col gap-1">
          {isQuote && !voided && (
            <>
              {!inv.convertedTo && (
                <MenuItem
                  label="Jadikan invoice"
                  hint="Buat invoice baru dari penawaran ini"
                  onClick={() => doAction(convert)}
                />
              )}
              <MenuItem
                label="Tandai diterima"
                hint="Penawaran disetujui klien"
                onClick={() => doAction(() => decide('accepted'))}
              />
              <MenuItem
                label="Tandai ditolak"
                hint="Penawaran tidak dilanjutkan"
                onClick={() => doAction(() => decide('rejected'))}
              />
            </>
          )}
          {!voided && !isQuote && (
            <MenuItem
              label="Jadikan invoice berulang"
              hint="Buat draft otomatis tiap bulan dari invoice ini"
              onClick={() => {
                setMoreOpen(false);
                setRecurOpen(true);
              }}
            />
          )}
          <MenuItem
            label={isQuote ? 'Duplikat penawaran' : 'Duplikat jadi invoice baru'}
            hint="Untuk klien langganan atau tagihan bulanan"
            onClick={() =>
              doAction(async () => {
                const d = await duplicateInvoice(inv);
                navigate(`/invoice/${d.id}/edit`);
              })
            }
          />
          {!voided && inv.status !== 'draft' && (
            <MenuItem
              label="Buat revisi"
              hint="Invoice ini ditandai batal, nomor baru berakhiran -R"
              onClick={() =>
                doAction(async () => {
                  const r = await createRevision(inv);
                  navigate(`/invoice/${r.id}/edit`);
                })
              }
            />
          )}
          {!voided && !isQuote && (
            <MenuItem
              label="Buat invoice pelunasan"
              hint={t.paid > 0 ? `Otomatis dikurangi ${formatMoney(t.paid, inv.currency)} yang sudah dibayar` : 'Otomatis dikurangi nilai invoice ini sebagai DP'}
              onClick={() =>
                doAction(async () => {
                  const label = inv.lang === 'id' ? `Dikurangi pembayaran ${inv.number}` : `Less payment ${inv.number}`;
                  const n = await createSettlement(inv, label);
                  navigate(`/invoice/${n.id}/edit`);
                })
              }
            />
          )}
          {!voided && (
            <MenuItem
              label={isQuote ? 'Batalkan penawaran' : 'Batalkan invoice'}
              hint="Tetap tersimpan dengan cap BATAL"
              onClick={() =>
                doAction(async () => {
                  const ok = await confirm({ title: 'Batalkan invoice?', message: 'Invoice tetap tersimpan, tapi tidak dihitung sebagai piutang.', confirmLabel: 'Batalkan', danger: true });
                  if (ok) await db.invoices.update(inv.id, { status: 'void', updatedAt: Date.now() });
                })
              }
            />
          )}
          <MenuItem
            danger
            label="Hapus permanen"
            onClick={() =>
              doAction(async () => {
                const ok = await confirm({ title: 'Hapus invoice ini?', message: `${inv.number} dan riwayat pembayarannya akan dihapus dari perangkat ini.`, confirmLabel: 'Hapus', danger: true });
                if (!ok) return;
                await deleteInvoice(inv.id);
                toast('Invoice dihapus');
                navigate('/', { replace: true });
              })
            }
            icon={<IconTrash size={18} />}
          />
        </div>
      </Sheet>
    </div>
  );
}

function MenuItem({ label, hint, onClick, danger, icon }: { label: string; hint?: string; onClick: () => void; danger?: boolean; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-sunken ${danger ? 'text-danger' : ''}`}>
      {icon}
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </button>
  );
}

function PaymentsCard({ inv, settings, tpl }: { inv: Invoice; settings: Settings; tpl?: TemplateConfig }) {
  const { toast, confirm } = useUI();
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState<File | null>(null);
  if (inv.payments.length === 0) return null;

  const receipt = async (p: Payment) => {
    if (!tpl) return;
    setBusy(p.id);
    try {
      let payment = p;
      if (!p.receiptNumber) {
        payment = { ...p, receiptNumber: await reserveReceiptNumber(p.date) };
        await db.invoices.update(inv.id, { payments: inv.payments.map((x) => (x.id === p.id ? payment : x)), updatedAt: Date.now() });
      }
      const { renderReceiptPdf } = await import('../pdf/document');
      const blob = await renderReceiptPdf(inv, payment, tpl, settings);
      // Sharing needs a fresh tap: iOS rejects navigator.share once the original gesture has expired during rendering.
      setReady(new File([blob], `${safeFileName(payment.receiptNumber!)}.pdf`, { type: 'application/pdf' }));
    } catch (e) {
      toast(`Kwitansi gagal dibuat: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mb-3">
      <h2 className="mb-2 text-[15px] font-bold">Pembayaran</h2>
      <ul className="divide-y divide-line">
        {inv.payments.map((p) => (
          <li key={p.id} className="flex items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="num font-bold">{formatMoney(p.amount, inv.currency, inv.lang)}</p>
              <p className="truncate text-xs text-muted">
                {formatDate(p.date, 'id', 'short')}
                {p.method ? ` · ${p.method}` : ''}
                {p.receiptNumber ? ` · ${p.receiptNumber}` : ''}
              </p>
              {p.note && <p className="truncate text-xs text-muted italic">{p.note}</p>}
            </div>
            <Button size="sm" onClick={() => receipt(p)} disabled={busy === p.id || !tpl}>
              <IconReceipt size={16} /> {busy === p.id ? 'Membuat...' : 'Kwitansi'}
            </Button>
            <IconButton
              label="Hapus pembayaran"
              onClick={async () => {
                const ok = await confirm({ title: 'Hapus catatan pembayaran?', message: `${formatMoney(p.amount, inv.currency)} pada ${formatDate(p.date, 'id')}.`, confirmLabel: 'Hapus', danger: true });
                if (ok) await db.invoices.update(inv.id, { payments: inv.payments.filter((x) => x.id !== p.id), updatedAt: Date.now() });
              }}
            >
              <IconTrash size={18} />
            </IconButton>
          </li>
        ))}
      </ul>
      <Sheet open={!!ready} onClose={() => setReady(null)} title="Kwitansi siap">
        <p className="mb-4 font-mono text-sm text-clay">{ready?.name}</p>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            onClick={async () => {
              if (ready && (await shareOrDownload(ready)) !== 'cancelled') setReady(null);
            }}
          >
            <IconShare size={18} /> Bagikan kwitansi
          </Button>
          <Button
            onClick={() => {
              if (!ready) return;
              printPdf(ready).catch((e) => toast((e as Error).message, 'error'));
            }}
          >
            <IconPrinter size={18} /> Cetak
          </Button>
          <Button
            onClick={() => {
              if (ready) downloadFile(ready);
              setReady(null);
            }}
          >
            <IconDownload size={18} /> Unduh
          </Button>
        </div>
      </Sheet>
    </Card>
  );
}

function RecordPaymentSheet({ open, onClose, inv }: { open: boolean; onClose: () => void; inv: Invoice }) {
  const { toast } = useUI();
  const t = computeTotals(inv);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState('Transfer bank');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const dec = displayDecimals(inv.currency);
  const today = todayISO();
  const over = t.balance > 0 && amount > t.balance;

  useEffect(() => {
    if (open) {
      setAmount(Math.max(t.balance, 0));
      setDate(todayISO());
      setNote('');
      setSaving(false);
    }
  }, [open]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const p: Payment = { id: uid(), date, amount, method, note: note.trim() };
      await db.transaction('rw', db.invoices, async () => {
        const cur = await db.invoices.get(inv.id);
        if (!cur) throw new Error('Invoice sudah dihapus.');
        await db.invoices.update(inv.id, {
          payments: [...cur.payments, p],
          status: cur.status === 'draft' ? 'sent' : cur.status,
          updatedAt: Date.now(),
        });
      });
      toast(amount >= t.balance ? 'Lunas. Kwitansi bisa dibuat dari daftar pembayaran.' : 'Pembayaran dicatat');
      onClose();
    } catch (e) {
      toast(`Gagal mencatat pembayaran: ${(e as Error).message}`, 'error');
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Catat pembayaran"
      footer={
        <Button variant="primary" size="lg" block disabled={amount <= 0 || !date || saving} onClick={save}>
          {saving ? 'Menyimpan...' : over ? 'Simpan (lebih bayar)' : 'Simpan pembayaran'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Jumlah diterima" hint={`Sisa tagihan ${formatMoney(t.balance, inv.currency, inv.lang)}`}>
          <NumberInput aria-label="Jumlah diterima" lang={inv.lang} decimals={displayDecimals(inv.currency)} value={amount} onChange={setAmount} />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setAmount(t.balance)} className="min-h-8 rounded-lg border border-line px-2.5 text-xs font-semibold">
              Lunas
            </button>
            <button type="button" onClick={() => setAmount(Math.round((t.balance / 2) * 10 ** dec) / 10 ** dec)} className="min-h-8 rounded-lg border border-line px-2.5 text-xs font-semibold">
              50%
            </button>
          </div>
        </Field>
        {over && <p className="text-sm font-semibold text-warn">Jumlah melebihi sisa tagihan sebesar {formatMoney(amount - t.balance, inv.currency)}. Pastikan nominalnya benar.</p>}
        <Field
          label="Tanggal"
          htmlFor="pdate"
          hint={
            date > today ? (
              <span className="font-semibold text-warn">Tanggal ini belum terjadi.</span>
            ) : date && date < inv.issueDate ? (
              <span className="font-semibold text-warn">Lebih awal dari tanggal invoice ({formatDate(inv.issueDate, 'id', 'short')}).</span>
            ) : undefined
          }
        >
          <TextInput id="pdate" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Metode" htmlFor="pmethod">
          <TextInput id="pmethod" list="pay-methods" value={method} onChange={(e) => setMethod(e.target.value)} />
          <datalist id="pay-methods">
            <option value="Transfer bank" />
            <option value="QRIS" />
            <option value="Tunai" />
            <option value="E-wallet" />
          </datalist>
        </Field>
        <Field label="Catatan" htmlFor="pnote" hint="Opsional, ikut tercetak di kwitansi">
          <TextInput id="pnote" value={note} placeholder="Mis. pembayaran termin 1" onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

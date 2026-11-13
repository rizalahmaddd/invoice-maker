import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { createInvoice, db, deriveStatus, duplicateInvoice } from '../db';
import { computeTotals, formatMoney } from '../lib/money';
import { uid } from '../lib/id';
import type { Client, Invoice } from '../types';
import { PageHeader } from '../components/layout';
import { Button, EmptyState, Field, Loading, Sheet, TextArea, TextInput, useUI } from '../components/ui';
import { IconPlus, IconSearch } from '../components/icons';

const blank = (): Client => ({ id: '', name: '', contactPerson: '', email: '', phone: '', address: '', taxId: '', createdAt: 0, updatedAt: 0 });

export function Clients() {
  const navigate = useNavigate();
  const { toast, confirm } = useUI();
  const clients = useLiveQuery(() => db.clients.orderBy('name').toArray(), []);
  const invoices = useLiveQuery(() => db.invoices.toArray(), []);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);

  const stats = useMemo(() => {
    type Stat = { count: number; due: Map<string, number>; last?: Invoice };
    const m = new Map<string, Stat>();
    for (const inv of invoices ?? []) {
      if (!inv.clientId) continue;
      const s: Stat = m.get(inv.clientId) ?? { count: 0, due: new Map() };
      s.count += 1;
      if (inv.status !== 'void' && (!s.last || inv.issueDate > s.last.issueDate || (inv.issueDate === s.last.issueDate && inv.createdAt > s.last.createdAt))) s.last = inv;
      const st = deriveStatus(inv);
      if (st === 'sent' || st === 'partial' || st === 'overdue') {
        s.due.set(inv.currency, (s.due.get(inv.currency) ?? 0) + computeTotals(inv).balance);
      }
      m.set(inv.clientId, s);
    }
    return m;
  }, [invoices]);

  const visible = (clients ?? []).filter((c) => !q || `${c.name} ${c.contactPerson} ${c.phone} ${c.email}`.toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    const twin = await db.clients.where('name').equalsIgnoreCase(editing.name.trim()).first();
    if (twin && twin.id !== editing.id) {
      const ok = await confirm({
        title: 'Nama klien sudah ada',
        message: `"${twin.name}" sudah ada di daftar. Invoice baru dengan nama ini akan tersambung ke klien yang lama. Tetap simpan sebagai klien terpisah?`,
        confirmLabel: 'Tetap simpan',
      });
      if (!ok) return;
    }
    const now = Date.now();
    const rec = { ...editing, name: editing.name.trim(), id: editing.id || uid(), createdAt: editing.createdAt || now, updatedAt: now };
    await db.clients.put(rec);
    toast(editing.id ? 'Klien diperbarui' : 'Klien ditambahkan');
    setEditing(null);
  };

  const remove = async (c: Client) => {
    const n = stats.get(c.id)?.count ?? 0;
    const ok = await confirm({
      title: `Hapus ${c.name}?`,
      message: n > 0 ? `${n} invoice untuk klien ini tetap tersimpan lengkap dengan data kliennya. Hanya entri di daftar klien yang dihapus.` : 'Klien akan dihapus dari daftar.',
      confirmLabel: 'Hapus',
      danger: true,
    });
    if (!ok) return;
    await db.clients.delete(c.id);
    setEditing(null);
    toast('Klien dihapus');
  };

  const invoiceFor = async (c: Client) => {
    const inv = await createInvoice({
      clientId: c.id,
      client: { name: c.name, contactPerson: c.contactPerson, email: c.email, phone: c.phone, address: c.address, taxId: c.taxId },
    });
    navigate(`/invoice/${inv.id}/edit`, { state: { fresh: true } });
  };

  const quoteFor = async (c: Client) => {
    const inv = await createInvoice({
      kind: 'quote',
      clientId: c.id,
      client: { name: c.name, contactPerson: c.contactPerson, email: c.email, phone: c.phone, address: c.address, taxId: c.taxId },
    });
    navigate(`/invoice/${inv.id}/edit`, { state: { fresh: true } });
  };

  const repeatLast = async (last: Invoice) => {
    const inv = await duplicateInvoice(last);
    toast(`Disalin dari ${last.number}. Cek tanggal dan item sebelum dikirim.`);
    navigate(`/invoice/${inv.id}/edit`);
  };

  const set = (k: keyof Client, v: string) => setEditing((e) => (e ? { ...e, [k]: v } : e));

  return (
    <>
      <PageHeader
        title="Klien"
        actions={
          <Button variant="primary" onClick={() => setEditing(blank())}>
            <IconPlus size={18} /> <span className="hidden sm:inline">Tambah klien</span>
            <span className="sm:hidden">Tambah</span>
          </Button>
        }
      />

      {clients === undefined ? (
        <Loading />
      ) : clients.length === 0 ? (
        <EmptyState
          title="Daftar klien masih kosong"
          body="Klien otomatis tersimpan ke sini setiap kali kamu menyimpan invoice. Bisa juga ditambahkan manual."
          action={
            <Button variant="primary" onClick={() => setEditing(blank())}>
              <IconPlus size={18} /> Tambah klien
            </Button>
          }
        />
      ) : (
        <>
          <div className="relative mb-4">
            <IconSearch size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <TextInput
              type="search"
              aria-label="Cari klien"
              placeholder="Cari nama klien, kontak, email, atau nomor HP..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-10 text-sm"
            />
          </div>
          {visible.length === 0 ? (
            <EmptyState title="Klien tidak ditemukan" body={`Tidak ada klien yang cocok dengan "${q}".`} action={<Button onClick={() => setQ('')}>Hapus pencarian</Button>} />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((c) => {
                const s = stats.get(c.id);
                const due = [...(s?.due.entries() ?? [])].filter(([, v]) => v > 0);
                const initials = c.name
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase())
                  .join('');

                return (
                  <li key={c.id} className="group flex flex-col justify-between rounded-2xl border border-line bg-surface p-4.5 shadow-xs transition-all hover:border-clay/50 hover:shadow-sm">
                    <button type="button" className="block w-full text-left" onClick={() => setEditing(c)}>
                      <div className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sunken font-mono text-sm font-bold text-muted group-hover:bg-clay/10 group-hover:text-clay transition-colors">
                          {initials || 'KL'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold text-base text-text group-hover:text-clay transition-colors">{c.name}</p>
                          <p className="truncate text-xs text-muted mt-0.5">{[c.contactPerson, c.phone, c.email].filter(Boolean).join(' · ') || 'Tanpa kontak'}</p>
                        </div>
                      </div>
                    </button>
                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-line/60 pt-3">
                      <div className="min-w-0 flex-1 text-xs text-muted">
                        {s?.count ? (
                          <Link to={`/?klien=${c.id}`} className="font-semibold text-clay hover:underline">
                            {s.count} invoice →
                          </Link>
                        ) : (
                          <p>Belum ada invoice</p>
                        )}
                        {due.length > 0 && (
                          <p className="num mt-0.5 truncate font-semibold text-danger">
                            Piutang: {due.map(([cur, v]) => formatMoney(v, cur)).join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {s?.last && (
                          <Button size="sm" variant="ghost" onClick={() => repeatLast(s.last!)} title={`Salin ${s.last.number} jadi invoice baru`}>
                            Ulangi terakhir
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => quoteFor(c)}>
                          Penawaran
                        </Button>
                        <Button size="sm" onClick={() => invoiceFor(c)}>
                          <IconPlus size={15} /> Buat Invoice
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

        </>
      )}

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit klien' : 'Klien baru'}
        footer={
          <div className="flex items-center justify-between gap-3 w-full">
            <div>
              {editing?.id && (
                <Button variant="danger" onClick={() => editing && remove(editing)}>
                  Hapus
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Batal
              </Button>
              <Button
                variant="primary"
                onClick={save}
                disabled={!editing?.name.trim()}
                className="min-w-28 shadow-xs"
              >
                Simpan
              </Button>
            </div>
          </div>
        }

      >
        {editing && (
          <div className="flex flex-col gap-3">
            <Field label="Nama klien / perusahaan" htmlFor="k-name">
              <TextInput id="k-name" value={editing.name} onChange={(e) => set('name', e.target.value)} required />
            </Field>
            <Field label="Nama kontak (Up.)" htmlFor="k-cp">
              <TextInput id="k-cp" value={editing.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="No. HP / WhatsApp" htmlFor="k-phone">
                <TextInput id="k-phone" type="tel" inputMode="tel" value={editing.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="k-email">
                <TextInput id="k-email" type="email" inputMode="email" value={editing.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
            </div>
            <Field label="Alamat" htmlFor="k-addr">
              <TextArea id="k-addr" rows={2} value={editing.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <Field label="NPWP" htmlFor="k-tax">
              <TextInput id="k-tax" value={editing.taxId} onChange={(e) => set('taxId', e.target.value)} />
            </Field>
          </div>
        )}
      </Sheet>
    </>
  );
}

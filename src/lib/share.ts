import type { Invoice, Settings } from '../types';
import { computeTotals, formatMoney } from './money';
import { formatDate } from './labels';

export function buildMessage(tpl: string, inv: Invoice, s: Settings) {
  const t = computeTotals(inv);
  return tpl
    .replace(/\{klien\}/g, inv.client.contactPerson || inv.client.name || '')
    .replace(/\{nomor\}/g, inv.number)
    .replace(/\{total\}/g, formatMoney(t.balance > 0 ? t.balance : t.grandTotal, inv.currency, inv.lang))
    .replace(/\{jatuh_tempo\}/g, inv.dueDate ? formatDate(inv.dueDate, inv.lang) : '-')
    .replace(/\{usaha\}/g, s.business.name);
}

export function waNumber(phone: string) {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('8')) return '62' + digits;
  return digits;
}

export function waLink(phone: string, message: string) {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(message)}`;
}

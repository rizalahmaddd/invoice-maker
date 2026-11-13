import type { BankAccount, Invoice, PaperKey, Settings, Status, TemplateConfig } from '../types';
import { normalizeTemplate } from '../templates';
import { computeTotals, formatMoney, formatNumber, type Totals } from '../lib/money';
import { docLabels, formatDate, type DocLabels } from '../lib/labels';
import { family } from './fonts';
import { terbilang } from '../lib/terbilang';

export interface DocCtx {
  inv: Invoice;
  tpl: TemplateConfig;
  s: Settings;
  t: Totals;
  L: DocLabels;
  status: Status;
  isQuote: boolean;
  title: string;
  money: (n: number) => string;
  num: (n: number) => string;
  date: (iso: string) => string;
  words: string;
  banks: BankAccount[];
  hasLineDiscount: boolean;
  fz: { xs: number; sm: number; base: number; lg: number; xl: number; xxl: number };
  pad: number;
  gap: number;
  radius: number;
  size: 'A4' | 'A5' | 'LETTER' | 'LEGAL' | [number, number];
  head: string;
  body: string;
  c: TemplateConfig['colors'];
}

// F4 (215 x 330 mm) is the folio size most Indonesian offices print on; react-pdf has no name for it.
const F4: [number, number] = [609.45, 935.43];

export function pageSize(paper: PaperKey) {
  return paper === 'F4' ? F4 : paper;
}

const MARGIN = { narrow: 28, normal: 42, wide: 56 };
const RADIUS = { none: 0, soft: 4, round: 10 };

export function buildCtx(inv: Invoice, rawTpl: TemplateConfig, s: Settings, status: Status): DocCtx {
  const tpl = normalizeTemplate(rawTpl);
  const t = computeTotals(inv);
  const compact = tpl.density === 'compact';
  const k = Math.min(Math.max(tpl.style.fontScale || 1, 0.8), 1.25);
  const scale = <T extends Record<string, number>>(o: T) => Object.fromEntries(Object.entries(o).map(([key, v]) => [key, Math.round(v * k * 10) / 10])) as T;
  const overrides = Object.fromEntries(Object.entries(tpl.labels[inv.lang] ?? {}).filter(([, v]) => v && v.trim()));
  const L: DocLabels = { ...docLabels(inv.lang), ...overrides };
  const isQuote = inv.kind === 'quote';
  const rawTitle = inv.title || (isQuote ? L.quoteTitle : tpl.titles[inv.lang]);
  const shownAmount = t.paid > 0 && t.balance > 0 ? t.balance : t.grandTotal;
  return {
    inv,
    tpl,
    s,
    t,
    L,
    status,
    isQuote,
    title: tpl.style.titleCase === 'upper' ? rawTitle.toUpperCase() : rawTitle,
    money: (n) => formatMoney(n, inv.currency, inv.lang),
    num: (n) => formatNumber(n, inv.lang),
    date: (iso) => formatDate(iso, inv.lang),
    words: terbilang(shownAmount, inv.currency, inv.lang),
    banks: s.bankAccounts.filter((b) => inv.bankAccountIds.includes(b.id)),
    hasLineDiscount: inv.items.some((i) => i.discount.value > 0),
    fz: scale(compact ? { xs: 6.5, sm: 7.5, base: 8.5, lg: 10.5, xl: 15, xxl: 24 } : { xs: 7.5, sm: 8.5, base: 9.5, lg: 12, xl: 18, xxl: 32 }),
    pad: MARGIN[tpl.style.margin] - (compact ? 12 : 0),
    gap: compact ? 12 : 18,
    radius: RADIUS[tpl.style.radius],
    size: pageSize(tpl.paper),
    head: family(tpl.fonts.heading),
    body: family(tpl.fonts.body),
    c: tpl.colors,
  };
}

export function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (ch: number) => Math.round(ch * alpha + 255 * (1 - alpha));
  return `#${[mix(r), mix(g), mix(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function readableOn(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // 0.19 is roughly where white and near-black text have equal contrast against the background.
  return lum > 0.19 ? '#111111' : '#ffffff';
}

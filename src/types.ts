export type Lang = 'id' | 'en';
export type DiscountType = 'percent' | 'amount';

export interface Discount {
  type: DiscountType;
  value: number;
}

export interface BankAccount {
  id: string;
  bank: string;
  number: string;
  holder: string;
}

export interface BusinessProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  logo?: string;
}

export type ResetPeriod = 'yearly' | 'monthly' | 'never';

export interface NumberingRule {
  format: string;
  reset: ResetPeriod;
  counters: Record<string, number>;
}

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  id: 'app';
  business: BusinessProfile;
  signature: { image?: string; name: string; title: string };
  stamp?: string;
  qris?: string;
  bankAccounts: BankAccount[];
  defaults: {
    currency: string;
    lang: Lang;
    dueDays: number;
    templateId: string;
    taxEnabled: boolean;
    taxLabel: string;
    taxRate: number;
    taxInclusive: boolean;
    pphEnabled: boolean;
    pphLabel: string;
    pphRate: number;
    notes: string;
    terms: string;
    showQris: boolean;
  };
  numbering: NumberingRule;
  receiptNumbering: NumberingRule;
  quoteNumbering: NumberingRule;
  shareMessage: string;
  reminderMessage: string;
  theme: ThemePref;
  lastBackupAt?: number;
  onboarded?: boolean;
}

export interface Client {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  taxId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Product {
  id: string;
  name: string;
  detail: string;
  unit: string;
  price: number;
  createdAt: number;
  updatedAt: number;
}

export type ClientSnapshot = Omit<Client, 'id' | 'createdAt' | 'updatedAt'>;

export interface LineItem {
  id: string;
  description: string;
  detail: string;
  qty: number;
  unit: string;
  price: number;
  discount: Discount;
}

export interface Adjustment {
  id: string;
  label: string;
  kind: 'add' | 'less';
  amount: number;
}

export interface Payment {
  id: string;
  date: string;
  amount: number;
  method: string;
  note: string;
  receiptNumber?: string;
}

export type StoredStatus = 'draft' | 'sent' | 'void';
export type Status = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void' | 'accepted' | 'rejected' | 'expired';
export type DocKind = 'invoice' | 'quote';

export interface Invoice {
  id: string;
  number: string;
  kind?: DocKind;
  numberKey?: string;
  numberSeq?: number;
  numberAuto?: boolean;
  title: string;
  reference: string;
  status: StoredStatus;
  issueDate: string;
  dueDate: string;
  clientId?: string;
  client: ClientSnapshot;
  items: LineItem[];
  discount: Discount;
  tax: { enabled: boolean; label: string; rate: number; inclusive: boolean };
  pph: { enabled: boolean; label: string; rate: number };
  adjustments: Adjustment[];
  currency: string;
  lang: Lang;
  templateId: string;
  notes: string;
  terms: string;
  bankAccountIds: string[];
  showQris: boolean;
  payments: Payment[];
  revisionOf?: string;
  supersededBy?: string;
  sentAt?: number;
  quoteState?: 'open' | 'accepted' | 'rejected';
  quoteDecidedAt?: number;
  convertedTo?: string;
  lastRemindedAt?: number;
  remindCount?: number;
  snoozeUntil?: string;
  createdAt: number;
  updatedAt: number;
}

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringTemplate {
  kind?: DocKind;
  title: string;
  clientId?: string;
  client: ClientSnapshot;
  items: LineItem[];
  discount: Discount;
  tax: { enabled: boolean; label: string; rate: number; inclusive: boolean };
  pph: { enabled: boolean; label: string; rate: number };
  adjustments: Adjustment[];
  currency: string;
  lang: Lang;
  templateId: string;
  notes: string;
  terms: string;
  bankAccountIds: string[];
  showQris: boolean;
}

export interface Recurrence {
  id: string;
  name: string;
  active: boolean;
  frequency: Frequency;
  interval: number;
  startDate: string;
  endDate?: string;
  nextRun: string;
  dueDays: number;
  lastRun?: string;
  runCount: number;
  template: RecurringTemplate;
  createdAt: number;
  updatedAt: number;
}

export type LayoutKey =
  | 'arsip'
  | 'pita'
  | 'garis'
  | 'tegas'
  | 'anggun'
  | 'samping'
  | 'struk'
  | 'kartu'
  | 'korporat'
  | 'kop'
  | 'bingkai'
  | 'studio'
  | 'lengkung'
  | 'geometri';

export type FontKey =
  | 'jakarta'
  | 'inter'
  | 'plex'
  | 'grotesk'
  | 'poppins'
  | 'montserrat'
  | 'outfit'
  | 'lora'
  | 'playfair'
  | 'fraunces'
  | 'dmserif'
  | 'mono'
  | 'spacemono'
  | 'helvetica'
  | 'times';

export type PaperKey = 'A4' | 'LETTER' | 'F4' | 'A5' | 'LEGAL';

export type LabelKey =
  | 'billTo'
  | 'from'
  | 'issueDate'
  | 'dueDate'
  | 'reference'
  | 'description'
  | 'qty'
  | 'price'
  | 'amount'
  | 'subtotal'
  | 'grandTotal'
  | 'balance'
  | 'terbilang'
  | 'payTo'
  | 'notes'
  | 'terms'
  | 'regards';

export interface TemplateStyle {
  table: 'auto' | 'lines' | 'zebra' | 'grid' | 'filled' | 'minimal';
  radius: 'none' | 'soft' | 'round';
  margin: 'narrow' | 'normal' | 'wide';
  fontScale: number;
  accentBar: 'none' | 'top' | 'side';
  watermark: 'none' | 'logo' | 'text';
  watermarkText: string;
  titleCase: 'upper' | 'normal';
}

export interface TemplateConfig {
  id: string;
  name: string;
  builtin?: boolean;
  baseId?: string;
  layout: LayoutKey;
  colors: { primary: string; accent: string; text: string; muted: string; paper: string };
  fonts: { heading: FontKey; body: FontKey };
  logo: { align: 'left' | 'right' | 'center'; size: 's' | 'm' | 'l' | 'xl' };
  show: {
    logo: boolean;
    businessName: boolean;
    businessDetails: boolean;
    clientDetails: boolean;
    reference: boolean;
    dueDate: boolean;
    itemNumber: boolean;
    itemDetail: boolean;
    qtyPrice: boolean;
    unit: boolean;
    terbilang: boolean;
    bankAccounts: boolean;
    qris: boolean;
    signature: boolean;
    stamp: boolean;
    notes: boolean;
    terms: boolean;
    paidStamp: boolean;
    pageNumber: boolean;
  };
  style: TemplateStyle;
  titles: { id: string; en: string };
  tagline: string;
  labels: { id: Partial<Record<LabelKey, string>>; en: Partial<Record<LabelKey, string>> };
  footer: string;
  paper: PaperKey;
  density: 'normal' | 'compact';
  createdAt?: number;
  updatedAt?: number;
}

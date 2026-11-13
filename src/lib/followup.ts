import type { Invoice } from '../types';
import { deriveStatus } from '../db';
import { computeTotals } from './money';
import { daysBetween, toISODate } from './id';

export type FollowUpTier = 'overdue' | 'due_soon' | 'stale' | 'draft';

export interface FollowUpItem {
  inv: Invoice;
  tier: FollowUpTier;
  days: number;
  balance: number;
  lastRemindedAt?: number;
}

export const TIER_META: Record<FollowUpTier, { label: string; cls: string }> = {
  overdue: { label: 'Lewat tempo', cls: 'stamp-overdue' },
  due_soon: { label: 'Jatuh tempo dekat', cls: 'stamp-partial' },
  stale: { label: 'Belum ditagih lama', cls: 'stamp-draft' },
  draft: { label: 'Draft siap kirim', cls: 'stamp-sent' },
};

const STALE_DAYS = 7;
const DUE_SOON_DAYS = 3;
const TIER_ORDER: Record<FollowUpTier, number> = { overdue: 0, due_soon: 1, stale: 2, draft: 3 };

export function buildFollowUps(invoices: Invoice[], today: string): FollowUpItem[] {
  const items: FollowUpItem[] = [];

  for (const inv of invoices) {
    if (inv.kind === 'quote' || inv.status === 'void') continue;
    if (inv.snoozeUntil && inv.snoozeUntil > today) continue;

    const status = deriveStatus(inv, today);
    if (status === 'paid') continue;

    const t = computeTotals(inv);

    if (status === 'draft') {
      if (inv.client.name.trim() && inv.items.length > 0 && t.grandTotal > 0) {
        items.push({ inv, tier: 'draft', days: 0, balance: t.balance, lastRemindedAt: inv.lastRemindedAt });
      }
      continue;
    }

    if (t.balance <= 0) continue;

    if (status === 'overdue') {
      const days = inv.dueDate ? Math.max(0, daysBetween(inv.dueDate, today)) : 0;
      items.push({ inv, tier: 'overdue', days, balance: t.balance, lastRemindedAt: inv.lastRemindedAt });
      continue;
    }

    const daysLeft = inv.dueDate ? daysBetween(today, inv.dueDate) : null;
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= DUE_SOON_DAYS) {
      items.push({ inv, tier: 'due_soon', days: daysLeft, balance: t.balance, lastRemindedAt: inv.lastRemindedAt });
      continue;
    }

    const lastTouch = toISODate(new Date(inv.lastRemindedAt ?? inv.updatedAt));
    if (daysBetween(lastTouch, today) >= STALE_DAYS) {
      items.push({ inv, tier: 'stale', days: 0, balance: t.balance, lastRemindedAt: inv.lastRemindedAt });
    }
  }

  return items.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.days - a.days || b.balance - a.balance);
}

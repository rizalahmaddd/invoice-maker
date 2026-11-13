import type { Frequency, Recurrence } from '../types';
import { addDays } from './id';

const MONTH_STEP: Record<Frequency, number> = { weekly: 0, monthly: 1, quarterly: 3, yearly: 12 };
const UNIT_LABEL: Record<Frequency, string> = { weekly: 'minggu', monthly: 'bulan', quarterly: '3 bulan', yearly: 'tahun' };
const WEEKDAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// Monthly schedules stay anchored to the original day of month, so 31 Jan becomes 28/29 Feb and then 31 Mar again.
export function advance(dateISO: string, frequency: Frequency, interval: number, anchorISO = dateISO): string {
  const step = Math.max(1, interval);
  if (frequency === 'weekly') return addDays(dateISO, 7 * step);

  const [year, month, day] = dateISO.split('-').map(Number);
  const anchorDay = Number(anchorISO.slice(8, 10));
  const target = new Date(Date.UTC(year, month - 1 + MONTH_STEP[frequency] * step, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const clamped = Math.min(anchorDay || day, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

export function previewDates(startISO: string, frequency: Frequency, interval: number, count = 3): string[] {
  const dates: string[] = [];
  let current = startISO;
  for (let i = 0; i < count; i += 1) {
    dates.push(current);
    current = advance(current, frequency, interval, startISO);
  }
  return dates;
}

export function describeSchedule(rec: Pick<Recurrence, 'frequency' | 'interval' | 'startDate'>): string {
  const interval = Math.max(1, rec.interval);
  const day = Number(rec.startDate.slice(8, 10));

  if (rec.frequency === 'weekly') {
    const [year, month, date] = rec.startDate.split('-').map(Number);
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
    return interval === 1 ? `Setiap ${weekday}` : `Setiap ${interval} minggu (${weekday})`;
  }

  const unit = UNIT_LABEL[rec.frequency];
  return interval === 1 ? `Setiap ${unit}, tanggal ${day}` : `Setiap ${interval} ${unit}, tanggal ${day}`;
}

export function isDue(rec: Pick<Recurrence, 'active' | 'nextRun' | 'endDate'>, today: string) {
  if (!rec.active) return false;
  if (rec.endDate && rec.nextRun > rec.endDate) return false;
  return rec.nextRun <= today;
}

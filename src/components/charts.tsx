import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Format = (n: number) => string;

export function Legend({ items }: { items: { label: string; tone: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: item.tone }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function BarPairChart({
  data,
  aLabel,
  bLabel,
  format,
  height = 220,
}: {
  data: { label: string; a: number; b: number }[];
  aLabel: string;
  bLabel: string;
  format: Format;
  height?: number;
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const width = 720;
  const top = 12;
  const bottom = 26;
  const plotHeight = height - top - bottom;
  const slot = width / Math.max(1, data.length);
  const barWidth = Math.min(13, slot * 0.27);
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <div className="mb-2">
        <Legend
          items={[
            { label: aLabel, tone: 'var(--clay)' },
            { label: bLabel, tone: 'var(--ok)' },
          ]}
        />
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`Grafik ${aLabel} dan ${bLabel} per bulan`}>
        {grid.map((t) => (
          <line
            key={t}
            x1={0}
            x2={width}
            y1={top + plotHeight * (1 - t)}
            y2={top + plotHeight * (1 - t)}
            stroke="var(--line)"
            strokeWidth={t === 0 ? 1 : 0.6}
            strokeDasharray={t === 0 ? undefined : '3 5'}
          />
        ))}
        {data.map((d, i) => {
          const cx = slot * i + slot / 2;
          const ah = (d.a / max) * plotHeight;
          const bh = (d.b / max) * plotHeight;
          return (
            <g key={d.label + i}>
              <rect x={cx - barWidth - 1} y={top + plotHeight - ah} width={barWidth} height={ah} rx={2} fill="var(--clay)">
                <title>{`${d.label} · ${aLabel}: ${format(d.a)}`}</title>
              </rect>
              <rect x={cx + 1} y={top + plotHeight - bh} width={barWidth} height={bh} rx={2} fill="var(--ok)">
                <title>{`${d.label} · ${bLabel}: ${format(d.b)}`}</title>
              </rect>
              <text x={cx} y={height - 7} textAnchor="middle" fontSize={10} fill="var(--muted)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function BucketBars({ buckets, format }: { buckets: { label: string; value: number; count: number }[]; format: Format }) {
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const tones = ['var(--clay)', 'var(--warn)', 'var(--warn)', 'var(--danger)'];
  return (
    <ul className="flex flex-col gap-3">
      {buckets.map((bucket, i) => (
        <li key={bucket.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-semibold">{bucket.label}</span>
            <span className="num shrink-0 text-muted">
              {format(bucket.value)} <span className="text-xs">· {bucket.count}</span>
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${(bucket.value / max) * 100}%`, background: tones[i] ?? 'var(--muted)' }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function HBarList({ rows, format }: { rows: { label: string; value: number; href?: string; sub?: string }[]; format: Format }) {
  if (rows.length === 0) return <p className="py-3 text-sm text-muted">Belum ada data pada periode ini.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row, index) => {
        const body: ReactNode = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-semibold">{row.label}</span>
              <span className="num shrink-0 text-muted">{format(row.value)}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-clay" style={{ width: `${(row.value / max) * 100}%` }} />
            </div>
            {row.sub && <p className="mt-0.5 text-xs text-muted">{row.sub}</p>}
          </>
        );
        return (
          <li key={`${row.label}-${index}`}>
            {row.href ? (
              <Link to={row.href} className="block rounded-lg transition-opacity hover:opacity-75">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Donut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: { label: string; value: number; tone: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 140 140" className="size-full -rotate-90" role="img" aria-label={`Komposisi ${centerLabel}`}>
          <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--sunken)" strokeWidth="16" />
          {total > 0 &&
            segments.map((segment) => {
              const length = (segment.value / total) * circumference;
              const circle = (
                <circle
                  key={segment.label}
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke={segment.tone}
                  strokeWidth="16"
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-offset}
                >
                  <title>{`${segment.label}: ${segment.value}`}</title>
                </circle>
              );
              offset += length;
              return circle;
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="num text-lg font-extrabold leading-none">{centerValue}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">{centerLabel}</p>
          </div>
        </div>
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
        {total === 0 ? (
          <li className="text-muted">Belum ada data.</li>
        ) : (
          segments.map((segment) => (
            <li key={segment.label} className="flex items-center justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ background: segment.tone }} />
                <span className="truncate">{segment.label}</span>
              </span>
              <span className="num shrink-0 font-semibold">{segment.value}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

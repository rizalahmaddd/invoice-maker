import { Image, Text, View, type Styles } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { DocCtx } from './context';
import { hexAlpha, readableOn } from './context';
import { lineTotals } from '../lib/money';

type Style = Styles[string];

const LOGO_H: Record<string, number> = { s: 30, m: 44, l: 64, xl: 84 };

export function Logo({ ctx, height }: { ctx: DocCtx; height?: number }) {
  const src = ctx.s.business.logo;
  if (!ctx.tpl.show.logo || !src) return null;
  return <Image src={src} style={{ height: height ?? LOGO_H[ctx.tpl.logo.size], objectFit: 'contain', maxWidth: 220 }} />;
}

export function BusinessName({ ctx, style, taglineColor }: { ctx: DocCtx; style?: Style; taglineColor?: string }) {
  if (!ctx.tpl.show.businessName || !ctx.s.business.name) return null;
  const tagline = ctx.tpl.tagline.trim();
  const name = (
    <Text style={[{ fontFamily: ctx.head, fontWeight: 700, fontSize: ctx.fz.lg, color: ctx.c.text }, style ?? {}]}>
      {ctx.s.business.name}
    </Text>
  );
  if (!tagline) return name;
  const align = (style as { textAlign?: 'left' | 'right' | 'center' } | undefined)?.textAlign ?? 'left';
  return (
    <View>
      {name}
      <Text style={{ fontSize: ctx.fz.sm, color: taglineColor ?? ctx.c.accent, textAlign: align, marginTop: 1, letterSpacing: 0.3 }}>{tagline}</Text>
    </View>
  );
}

export function BusinessDetails({ ctx, color, align = 'left', stacked }: { ctx: DocCtx; color?: string; align?: 'left' | 'right' | 'center'; stacked?: boolean }) {
  const b = ctx.s.business;
  if (!ctx.tpl.show.businessDetails) return null;
  const contact = stacked ? [b.phone, b.email] : [[b.phone, b.email].filter(Boolean).join('  ·  ')];
  const lines = [b.address, ...contact, b.website, b.taxId ? `${ctx.L.taxId} ${b.taxId}` : ''].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <View style={{ marginTop: 3 }}>
      {lines.map((l, i) => (
        <Text key={i} style={{ fontSize: ctx.fz.sm, color: color ?? ctx.c.muted, lineHeight: 1.45, textAlign: align }}>
          {l}
        </Text>
      ))}
    </View>
  );
}

export function Label({ ctx, children, color, style }: { ctx: DocCtx; children: ReactNode; color?: string; style?: Style }) {
  return (
    <Text style={[{ fontSize: ctx.fz.xs, color: color ?? ctx.c.muted, fontWeight: 700, letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 4 }, style ?? {}]}>
      {children}
    </Text>
  );
}

export function ClientBlock({ ctx, labelColor, textColor, align = 'left' }: { ctx: DocCtx; labelColor?: string; textColor?: string; align?: 'left' | 'right' }) {
  const c = ctx.inv.client;
  const color = textColor ?? ctx.c.text;
  const sub = textColor ?? ctx.c.muted;
  return (
    <View>
      <Label ctx={ctx} color={labelColor} style={{ textAlign: align }}>
        {ctx.L.billTo}
      </Label>
      <Text style={{ fontFamily: ctx.head, fontWeight: 700, fontSize: ctx.fz.lg, color, textAlign: align }}>{c.name || '-'}</Text>
      {c.contactPerson ? (
        <Text style={{ fontSize: ctx.fz.sm, color: sub, marginTop: 2, textAlign: align }}>
          {ctx.L.attn} {c.contactPerson}
        </Text>
      ) : null}
      {(ctx.tpl.show.clientDetails ? [c.address, [c.phone, c.email].filter(Boolean).join('  ·  '), c.taxId ? `${ctx.L.taxId} ${c.taxId}` : ''] : [])
        .filter(Boolean)
        .map((l, i) => (
          <Text key={i} style={{ fontSize: ctx.fz.sm, color: sub, lineHeight: 1.45, textAlign: align }}>
            {l}
          </Text>
        ))}
    </View>
  );
}

export function MetaRows({ ctx, labelColor, valueColor, align = 'right', withNumber = true }: { ctx: DocCtx; labelColor?: string; valueColor?: string; align?: 'left' | 'right'; withNumber?: boolean }) {
  const rows: [string, string][] = [];
  if (withNumber) rows.push([ctx.L.number, ctx.inv.number]);
  rows.push([ctx.L.issueDate, ctx.date(ctx.inv.issueDate)]);
  if (ctx.inv.dueDate && ctx.tpl.show.dueDate) rows.push([ctx.isQuote ? ctx.L.validUntil : ctx.L.dueDate, ctx.date(ctx.inv.dueDate)]);
  if (ctx.inv.reference && ctx.tpl.show.reference) rows.push([ctx.L.reference, ctx.inv.reference]);
  return (
    <View>
      {rows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', marginBottom: 2.5 }}>
          <Text style={{ fontSize: ctx.fz.sm, color: labelColor ?? ctx.c.muted, width: 70, textAlign: align === 'right' ? 'right' : 'left', marginRight: 8 }}>{k}</Text>
          <Text style={{ fontSize: ctx.fz.sm, color: valueColor ?? ctx.c.text, fontWeight: 700, minWidth: 90, textAlign: align === 'right' ? 'right' : 'left' }}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

export interface TableStyle {
  headBg?: string;
  headColor?: string;
  headBorder?: string;
  rowBorder?: string;
  zebra?: string;
  grid?: string;
  uppercase?: boolean;
}

// A table style picked in the template editor replaces whatever the layout asked for.
function resolveTable(ctx: DocCtx, layout: TableStyle): TableStyle {
  const p = ctx.c.primary;
  switch (ctx.tpl.style.table) {
    case 'lines':
      return { headBorder: p, uppercase: layout.uppercase };
    case 'zebra':
      return { headBg: hexAlpha(p, 0.1), headColor: p, zebra: hexAlpha(p, 0.045), rowBorder: hexAlpha(p, 0.08) };
    case 'grid':
      return { headBg: hexAlpha(p, 0.08), headColor: ctx.c.text, grid: hexAlpha(ctx.c.text, 0.3), uppercase: layout.uppercase };
    case 'filled':
      return { headBg: p, headColor: readableOn(p), rowBorder: hexAlpha(p, 0.18) };
    case 'minimal':
      return { headColor: ctx.c.muted, rowBorder: hexAlpha(ctx.c.text, 0.07), uppercase: true };
    default:
      return layout;
  }
}

export function ItemsTable({ ctx, style: layoutStyle = {} }: { ctx: DocCtx; style?: TableStyle }) {
  const { inv, L, tpl, fz } = ctx;
  const style = resolveTable(ctx, layoutStyle);
  const showNo = tpl.show.itemNumber;
  const showQtyPrice = tpl.show.qtyPrice;
  const showDisc = ctx.hasLineDiscount && showQtyPrice;
  const headColor = style.headColor ?? ctx.c.muted;
  const rowBorder = style.rowBorder ?? hexAlpha(ctx.c.text, 0.12);
  const grid = style.grid;
  const vPad = tpl.density === 'compact' ? 4 : 7;
  const hPad = style.headBg || grid ? 4 : 0;
  const cellPad = grid ? vPad : 0;
  const cell = (w: number | undefined, align: 'left' | 'right' | 'center' = 'right', last = false): Style => ({
    ...(w ? { width: w } : { flex: 1 }),
    textAlign: align,
    paddingHorizontal: 4,
    paddingVertical: cellPad,
    borderRightWidth: grid && !last ? 0.6 : 0,
    borderRightColor: grid,
  });
  const head = (s: string) => (style.uppercase ? s.toUpperCase() : s);
  const headText: Style = { fontSize: fz.xs, color: headColor, fontWeight: 700, letterSpacing: 0.6 };
  const r = ctx.radius;

  return (
    <View style={grid ? { borderWidth: 0.6, borderColor: grid, borderRadius: r } : {}}>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: style.headBg,
          borderBottomWidth: style.headBorder || grid ? (grid ? 0.6 : 1) : 0,
          borderBottomColor: grid ?? style.headBorder,
          paddingVertical: grid ? 2 : style.headBg ? 6 : 5,
          paddingHorizontal: hPad,
          borderRadius: style.headBg && !grid ? r : 0,
          borderTopLeftRadius: grid ? r : undefined,
          borderTopRightRadius: grid ? r : undefined,
        }}
      >
        {showNo && <Text style={[cell(22, 'left'), headText]}>{head(L.no)}</Text>}
        <Text style={[cell(undefined, 'left'), headText]}>{head(L.description)}</Text>
        {showQtyPrice && <Text style={[cell(52), headText]}>{head(L.qty)}</Text>}
        {showQtyPrice && <Text style={[cell(78), headText]}>{head(L.price)}</Text>}
        {showDisc && <Text style={[cell(58), headText]}>{head(L.discount)}</Text>}
        <Text style={[cell(86, 'right', true), headText]}>{head(L.amount)}</Text>
      </View>
      {inv.items.map((item, i) => {
        const lt = lineTotals(item, inv.currency);
        const disc =
          item.discount.value > 0
            ? item.discount.type === 'percent'
              ? `${ctx.num(item.discount.value)}%`
              : ctx.money(lt.discount)
            : '';
        const lastRow = i === inv.items.length - 1;
        return (
          <View
            key={item.id}
            wrap={false}
            style={{
              flexDirection: 'row',
              paddingVertical: grid ? 0 : vPad,
              paddingHorizontal: hPad,
              borderBottomWidth: grid && lastRow ? 0 : 0.6,
              borderBottomColor: grid ?? rowBorder,
              backgroundColor: style.zebra && i % 2 === 1 ? style.zebra : undefined,
            }}
          >
            {showNo && <Text style={[cell(22, 'left'), { fontSize: fz.base, color: ctx.c.muted }]}>{i + 1}</Text>}
            <View style={cell(undefined, 'left')}>
              <Text style={{ fontSize: fz.base, color: ctx.c.text, fontWeight: 700 }}>{item.description || '-'}</Text>
              {item.detail && tpl.show.itemDetail ? <Text style={{ fontSize: fz.sm, color: ctx.c.muted, marginTop: 2, lineHeight: 1.4 }}>{item.detail}</Text> : null}
            </View>
            {showQtyPrice && (
              <Text style={[cell(52), { fontSize: fz.base, color: ctx.c.text }]}>
                {ctx.num(item.qty)}
                {tpl.show.unit && item.unit ? ` ${item.unit}` : ''}
              </Text>
            )}
            {showQtyPrice && <Text style={[cell(78), { fontSize: fz.base, color: ctx.c.text }]}>{ctx.money(item.price)}</Text>}
            {showDisc && <Text style={[cell(58), { fontSize: fz.base, color: ctx.c.muted }]}>{disc}</Text>}
            <Text style={[cell(86, 'right', true), { fontSize: fz.base, color: ctx.c.text, fontWeight: 700 }]}>{ctx.money(lt.net)}</Text>
          </View>
        );
      })}
      {inv.items.length === 0 && (
        <Text style={{ fontSize: fz.sm, color: ctx.c.muted, paddingVertical: 10, paddingHorizontal: hPad }}>{inv.lang === 'id' ? 'Belum ada item.' : 'No items yet.'}</Text>
      )}
    </View>
  );
}

export function totalRows(ctx: DocCtx): [string, string, boolean?][] {
  const { t, inv, L } = ctx;
  const rows: [string, string, boolean?][] = [];
  const hasExtras = t.discount > 0 || inv.tax.enabled || inv.pph.enabled || inv.adjustments.length > 0;
  if (hasExtras) rows.push([L.subtotal, ctx.money(t.subtotal)]);
  if (t.discount > 0) {
    const label = inv.discount.type === 'percent' ? `${L.discount} ${ctx.num(inv.discount.value)}%` : L.discount;
    rows.push([label, `-${ctx.money(t.discount)}`]);
  }
  if (inv.tax.enabled && inv.tax.rate > 0) {
    if (inv.tax.inclusive) rows.push([L.taxBase, ctx.money(t.taxBase)]);
    const incl = inv.tax.inclusive ? (inv.lang === 'id' ? ' (termasuk)' : ' (incl.)') : '';
    rows.push([`${inv.tax.label} ${ctx.num(inv.tax.rate)}%${incl}`, ctx.money(t.tax)]);
  }
  if (inv.pph.enabled && inv.pph.rate > 0) rows.push([`${inv.pph.label} ${ctx.num(inv.pph.rate)}%`, `-${ctx.money(t.pph)}`]);
  for (const a of inv.adjustments) {
    rows.push([a.label || '-', `${a.kind === 'less' ? '-' : ''}${ctx.money(Math.abs(a.amount))}`]);
  }
  return rows;
}

export function TotalsBlock({ ctx, width = 250, highlight }: { ctx: DocCtx; width?: number; highlight?: { bg: string; color?: string } }) {
  const { t, L, fz } = ctx;
  const rows = totalRows(ctx);
  const showBalance = t.paid > 0;
  const hlColor = highlight ? highlight.color ?? readableOn(highlight.bg) : ctx.c.text;
  return (
    <View wrap={false} style={{ width }}>
      {rows.map(([k, v], i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
          <Text style={{ fontSize: fz.base, color: ctx.c.muted, flex: 1, paddingRight: 8 }}>{k}</Text>
          <Text style={{ fontSize: fz.base, color: ctx.c.text }}>{v}</Text>
        </View>
      ))}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 5,
          paddingVertical: highlight ? 10 : 8,
          paddingHorizontal: highlight ? 12 : 0,
          backgroundColor: highlight?.bg,
          borderRadius: highlight ? ctx.radius : 0,
          borderTopWidth: highlight ? 0 : 1.2,
          borderTopColor: ctx.c.text,
        }}
      >
        <Text style={{ fontSize: fz.sm, fontWeight: 700, color: hlColor, letterSpacing: 0.6, textTransform: 'uppercase' }}>{L.grandTotal}</Text>
        <Text style={{ fontSize: fz.xl - 2, fontWeight: 700, color: hlColor, fontFamily: ctx.head }}>{ctx.money(t.grandTotal)}</Text>
      </View>
      {showBalance && (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, marginTop: 4 }}>
            <Text style={{ fontSize: fz.base, color: ctx.c.muted }}>{L.paid}</Text>
            <Text style={{ fontSize: fz.base, color: ctx.c.text }}>-{ctx.money(t.paid)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
            <Text style={{ fontSize: fz.base, color: ctx.c.text, fontWeight: 700 }}>{L.balance}</Text>
            <Text style={{ fontSize: fz.base, color: ctx.c.text, fontWeight: 700 }}>{ctx.money(Math.max(t.balance, 0))}</Text>
          </View>
        </>
      )}
    </View>
  );
}

export function Terbilang({ ctx, color }: { ctx: DocCtx; color?: string }) {
  if (!ctx.tpl.show.terbilang) return null;
  return (
    <View wrap={false} style={{ marginTop: ctx.gap / 2 }}>
      <Label ctx={ctx} color={color}>
        {ctx.L.terbilang}
      </Label>
      <Text style={{ fontSize: ctx.fz.sm, color: ctx.c.text, fontStyle: 'normal', lineHeight: 1.4 }}>{ctx.words}</Text>
    </View>
  );
}

export function PaymentInfo({ ctx, color, labelColor, stacked }: { ctx: DocCtx; color?: string; labelColor?: string; stacked?: boolean }) {
  if (ctx.isQuote) return null;
  const banks = ctx.tpl.show.bankAccounts ? ctx.banks : [];
  const qris = ctx.tpl.show.qris && ctx.inv.showQris ? ctx.s.qris : undefined;
  if (banks.length === 0 && !qris) return null;
  const text = color ?? ctx.c.text;
  return (
    <View wrap={false} style={{ flexDirection: stacked ? 'column' : 'row', gap: 14 }}>
      {banks.length > 0 && (
        <View style={stacked ? {} : { flex: 1 }}>
          <Label ctx={ctx} color={labelColor}>
            {ctx.L.payTo}
          </Label>
          {banks.map((b) => (
            <View key={b.id} style={{ marginBottom: 5 }}>
              <Text style={{ fontSize: ctx.fz.base, color: text, fontWeight: 700 }}>
                {b.bank} {b.number}
              </Text>
              {b.holder ? (
                <Text style={{ fontSize: ctx.fz.sm, color: color ?? ctx.c.muted }}>
                  {ctx.L.accountHolder} {b.holder}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
      {qris && (
        <View style={{ alignItems: stacked ? 'flex-start' : 'center' }}>
          <Image src={qris} style={{ width: 78, height: 78, objectFit: 'contain' }} />
          <Text style={{ fontSize: ctx.fz.xs, color: color ?? ctx.c.muted, marginTop: 2 }}>{ctx.L.scanQris}</Text>
        </View>
      )}
    </View>
  );
}

export function NotesTerms({ ctx, labelColor }: { ctx: DocCtx; labelColor?: string }) {
  const notes = ctx.tpl.show.notes && ctx.inv.notes.trim();
  const terms = ctx.tpl.show.terms && ctx.inv.terms.trim();
  if (!notes && !terms) return null;
  return (
    <View style={{ gap: 8 }}>
      {notes ? (
        <View wrap={false}>
          <Label ctx={ctx} color={labelColor}>
            {ctx.L.notes}
          </Label>
          <Text style={{ fontSize: ctx.fz.sm, color: ctx.c.text, lineHeight: 1.45 }}>{ctx.inv.notes}</Text>
        </View>
      ) : null}
      {terms ? (
        <View>
          <Label ctx={ctx} color={labelColor}>
            {ctx.L.terms}
          </Label>
          <Text style={{ fontSize: ctx.fz.sm, color: ctx.c.muted, lineHeight: 1.45 }}>{ctx.inv.terms}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function Signature({ ctx, align = 'center', width = 150 }: { ctx: DocCtx; align?: 'center' | 'left' | 'right'; width?: number }) {
  const sig = ctx.s.signature;
  const showSig = ctx.tpl.show.signature && (sig.image || sig.name);
  const stamp = ctx.tpl.show.stamp ? ctx.s.stamp : undefined;
  if (!showSig && !stamp) return null;
  const textAlign = align;
  return (
    <View wrap={false} style={{ width, alignItems: align === 'center' ? 'center' : align === 'left' ? 'flex-start' : 'flex-end' }}>
      <Text style={{ fontSize: ctx.fz.sm, color: ctx.c.muted, textAlign }}>{ctx.L.regards}</Text>
      <View style={{ height: 52, width, position: 'relative', alignItems: align === 'center' ? 'center' : align === 'left' ? 'flex-start' : 'flex-end', justifyContent: 'center' }}>
        {stamp && <Image src={stamp} style={{ position: 'absolute', height: 62, width: 62, objectFit: 'contain', opacity: 0.85, left: align === 'right' ? undefined : width / 2 - 50, right: align === 'right' ? 40 : undefined }} />}
        {ctx.tpl.show.signature && sig.image && <Image src={sig.image} style={{ height: 52, maxWidth: width, objectFit: 'contain' }} />}
      </View>
      {ctx.tpl.show.signature && sig.name ? (
        <Text style={{ fontSize: ctx.fz.base, color: ctx.c.text, fontWeight: 700, textAlign, borderTopWidth: 0.6, borderTopColor: hexAlpha(ctx.c.text, 0.4), paddingTop: 3, width }}>
          {sig.name}
        </Text>
      ) : null}
      {ctx.tpl.show.signature && sig.title ? <Text style={{ fontSize: ctx.fz.sm, color: ctx.c.muted, textAlign, width }}>{sig.title}</Text> : null}
    </View>
  );
}

// "float" takes no height: it hangs in the empty space beside the totals so a paid invoice never spills
// onto a second page. "page" pins it to a fixed spot for layouts whose margins are empty (Struk).
export function StatusStamp({ ctx, mode = 'float', align = 'left' }: { ctx: DocCtx; mode?: 'float' | 'flow' | 'page'; align?: 'left' | 'center' | 'right' }) {
  if (ctx.isQuote) return null;
  const paid = ctx.status === 'paid' && ctx.tpl.show.paidStamp;
  const voided = ctx.status === 'void';
  if (!paid && !voided) return null;
  const color = paid ? '#1f7a4d' : '#b42318';
  const stamp = (
    <View style={{ transform: 'rotate(-10deg)', borderWidth: 2.5, borderColor: color, borderRadius: 6, paddingVertical: 5, paddingHorizontal: 14, opacity: 0.8 }}>
      <Text style={{ color, fontSize: 22, fontWeight: 700, fontFamily: 'helvetica', letterSpacing: 3 }}>{paid ? ctx.L.paidStamp : ctx.L.voidStamp}</Text>
    </View>
  );
  if (mode === 'page') return <View style={{ position: 'absolute', top: ctx.pad + 40, right: 18 }}>{stamp}</View>;
  if (mode === 'flow') {
    return (
      <View wrap={false} style={{ alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', marginTop: ctx.gap * 0.8 }}>
        {stamp}
      </View>
    );
  }
  return (
    <View style={{ height: 0 }}>
      <View style={{ position: 'absolute', top: ctx.gap * 0.7, left: 10 }}>{stamp}</View>
    </View>
  );
}

export function PageFooter({ ctx, color, left }: { ctx: DocCtx; color?: string; left?: number }) {
  const text = ctx.tpl.footer.trim();
  if (!text && !ctx.tpl.show.pageNumber) return null;
  return (
    <View
      fixed
      style={{
        position: 'absolute',
        bottom: 18,
        left: left ?? ctx.pad,
        right: ctx.pad,
        flexDirection: 'row',
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ fontSize: ctx.fz.xs, color: color ?? ctx.c.muted, flex: 1, paddingRight: 10 }}>{text}</Text>
      {ctx.tpl.show.pageNumber && (
        <Text
          style={{ fontSize: ctx.fz.xs, color: color ?? ctx.c.muted }}
          render={({ pageNumber, totalPages }) => (totalPages > 1 ? `${ctx.L.page} ${pageNumber} ${ctx.L.of} ${totalPages}` : '')}
        />
      )}
    </View>
  );
}

export function PaymentBox({ ctx, labelColor }: { ctx: DocCtx; labelColor?: string }) {
  if (ctx.isQuote) return null;
  const hasBanks = ctx.tpl.show.bankAccounts && ctx.banks.length > 0;
  const hasQris = ctx.tpl.show.qris && ctx.inv.showQris && !!ctx.s.qris;
  if (!hasBanks && !hasQris) return null;
  return (
    <View wrap={false} style={{ backgroundColor: hexAlpha(labelColor ?? ctx.c.primary, 0.06), borderRadius: ctx.radius, padding: 10, borderLeftWidth: 3, borderLeftColor: labelColor ?? ctx.c.primary }}>
      <PaymentInfo ctx={ctx} labelColor={labelColor} />
    </View>
  );
}

export function BottomSection({ ctx, labelColor }: { ctx: DocCtx; labelColor?: string }) {
  return (
    <View style={{ marginTop: ctx.gap, gap: ctx.gap }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20 }}>
        <View style={{ flex: 1, maxWidth: 300 }}>
          <PaymentBox ctx={ctx} labelColor={labelColor} />
        </View>
        <Signature ctx={ctx} />
      </View>
      <NotesTerms ctx={ctx} labelColor={labelColor} />
    </View>
  );
}

export function PageDecor({ ctx }: { ctx: DocCtx }) {
  const { style } = ctx.tpl;
  const logo = ctx.s.business.logo;
  const text = style.watermarkText.trim() || ctx.s.business.name;
  return (
    <>
      {style.accentBar === 'top' && <View fixed style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: ctx.c.accent }} />}
      {style.accentBar === 'side' && <View fixed style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 6, backgroundColor: ctx.c.accent }} />}
      {style.watermark === 'logo' && logo && (
        <View fixed style={{ position: 'absolute', top: '32%', left: 0, right: 0, alignItems: 'center' }}>
          <Image src={logo} style={{ width: 300, height: 300, objectFit: 'contain', opacity: 0.06 }} />
        </View>
      )}
      {style.watermark === 'text' && text && (
        <View fixed style={{ position: 'absolute', top: '42%', left: -60, right: -60, alignItems: 'center', transform: 'rotate(-30deg)' }}>
          <Text style={{ fontFamily: ctx.head, fontWeight: 700, fontSize: 64, color: hexAlpha(ctx.c.primary, 0.07), letterSpacing: 4 }}>{text}</Text>
        </View>
      )}
    </>
  );
}

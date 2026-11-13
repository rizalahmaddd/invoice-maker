export async function imageToDataURL(file: File, maxSize = 800): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Gambar tidak bisa dibaca.'));
      el.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    // PNG keeps transparency for logos, signatures and stamps; react-pdf only reads PNG and JPEG.
    return file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadFile(file: File | Blob, name?: string) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name ?? (file instanceof File ? file.name : 'download');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

export async function shareOrDownload(file: File, text?: string): Promise<ShareResult> {
  const data: ShareData = { files: [file], title: file.name, text };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  downloadFile(file);
  return 'downloaded';
}

// iOS Safari refuses to print a PDF inside an iframe, so there we hand the file to the system viewer instead.
export async function printPdf(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (ios) {
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    const cleanup = () => {
      frame.remove();
      URL.revokeObjectURL(url);
    };
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (e) {
        cleanup();
        reject(e as Error);
        return;
      }
      // The print dialog blocks some browsers, so the frame can only be removed once the user is done.
      setTimeout(cleanup, 60_000);
    };
    frame.onerror = () => {
      cleanup();
      reject(new Error('PDF tidak bisa dibuka untuk dicetak.'));
    };
    frame.src = url;
    document.body.appendChild(frame);
  });
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 120);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function hsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    const [rr, gg, bb] = [r / 255, g / 255, b / 255];
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: sat, l };
}

const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// Picks the brand colours out of a logo: near-white, near-black and grey pixels are background or text, not brand.
export async function logoColors(dataUrl: string): Promise<string[]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Logo tidak bisa dibaca.'));
    el.src = dataUrl;
  });
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const c = hsl(r, g, b);
    if (c.s < 0.22 || c.l > 0.9 || c.l < 0.08) continue;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
  }
  const ranked = [...buckets.values()]
    .filter((e) => e.n >= 6)
    .map((e) => ({ n: e.n, r: Math.round(e.r / e.n), g: Math.round(e.g / e.n), b: Math.round(e.b / e.n) }))
    .sort((a, b) => b.n - a.n);
  const picked: { r: number; g: number; b: number }[] = [];
  for (const c of ranked) {
    const h = hsl(c.r, c.g, c.b).h;
    if (picked.every((p) => Math.min(Math.abs(hsl(p.r, p.g, p.b).h - h), 360 - Math.abs(hsl(p.r, p.g, p.b).h - h)) > 35)) picked.push(c);
    if (picked.length === 2) break;
  }
  return picked.map((c) => toHex(c.r, c.g, c.b));
}

export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

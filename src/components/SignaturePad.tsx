import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from './ui';

const WIDTH = 600;
const HEIGHT = 200;
const SCALE = 2;

type Point = { x: number; y: number };

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | undefined) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const active = useRef<Point[] | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i += 1) ctx.lineTo(stroke[i].x, stroke[i].y);
      if (stroke.length === 1) ctx.lineTo(stroke[0].x + 0.1, stroke[0].y + 0.1);
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = WIDTH * SCALE;
    canvas.height = HEIGHT * SCALE;
    redraw();
  }, [redraw]);

  const emit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(strokes.current.length === 0 ? undefined : canvas.toDataURL('image/png'));
    setStrokeCount(strokes.current.length);
  }, [onChange]);

  const pointAt = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * HEIGHT,
    };
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        aria-label="Area gambar tanda tangan"
        role="application"
        className="w-full touch-none rounded-xl border border-line bg-white"
        style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          active.current = [pointAt(e)];
          strokes.current = [...strokes.current, active.current];
          redraw();
        }}
        onPointerMove={(e) => {
          if (!active.current) return;
          active.current.push(pointAt(e));
          redraw();
        }}
        onPointerUp={() => {
          active.current = null;
          emit();
        }}
        onPointerCancel={() => {
          active.current = null;
          emit();
        }}
      >
        Gambar tanda tangan di sini.
      </canvas>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={strokeCount === 0}
          onClick={() => {
            strokes.current = strokes.current.slice(0, -1);
            redraw();
            emit();
          }}
        >
          Urungkan
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={strokeCount === 0}
          onClick={() => {
            strokes.current = [];
            redraw();
            emit();
          }}
        >
          Hapus
        </Button>
        <span className="text-xs text-muted">Gambar dengan jari atau mouse. Latar otomatis transparan.</span>
      </div>
    </div>
  );
}

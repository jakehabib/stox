'use client';

import clsx from 'clsx';
import { FlipHorizontal, Minus, Pause, Play, Plus, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDuration, readSeconds } from '@/lib/calculations/marketingFilters';

/**
 * Full-screen auto-scrolling teleprompter. Space = play/pause, ↑/↓ = speed, Esc = close.
 * Prototype: the camera is never accessed — this is the reading experience only.
 */
export function Teleprompter({ open, onClose, title, text }: { open: boolean; onClose: () => void; title: string; text: string }) {
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [speed, setSpeed] = useState(40); // px per second
  const [size, setSize] = useState(44);
  const [mirror, setMirror] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const raf = useRef<number>();
  const last = useRef<number>();
  const pos = useRef(0);

  const reset = useCallback(() => {
    setPlaying(false);
    setCountdown(null);
    setElapsed(0);
    pos.current = 0;
    if (scroller.current) scroller.current.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  // countdown 3-2-1 before scrolling starts
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      setPlaying(true);
      return;
    }
    const id = setTimeout(() => setCountdown(countdown - 1), 700);
    return () => clearTimeout(id);
  }, [countdown]);

  useEffect(() => {
    if (!playing) {
      last.current = undefined;
      return;
    }
    const step = (ts: number) => {
      const el = scroller.current;
      if (el) {
        const dt = last.current ? (ts - last.current) / 1000 : 0;
        last.current = ts;
        pos.current = Math.min(el.scrollHeight - el.clientHeight, pos.current + speed * dt);
        el.scrollTop = pos.current;
        setElapsed((e) => e + dt);
        if (pos.current >= el.scrollHeight - el.clientHeight - 1) {
          setPlaying(false);
          return;
        }
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, speed]);

  const togglePlay = useCallback(() => {
    if (playing) setPlaying(false);
    else if (countdown === null) {
      if (scroller.current) pos.current = scroller.current.scrollTop;
      setCountdown(3);
    }
  }, [playing, countdown]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowUp') setSpeed((s) => Math.min(160, s + 10));
      else if (e.key === 'ArrowDown') setSpeed((s) => Math.max(10, s - 10));
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, togglePlay]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={`Teleprompter: ${title}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3 text-sm">
        <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', playing ? 'bg-red-600' : 'bg-white/10')}>
          <span className={clsx('h-2 w-2 rounded-full', playing ? 'animate-pulse bg-white' : 'bg-white/60')} />
          {playing ? 'ROLLING' : 'READY'} · {formatDuration(elapsed)} / ~{formatDuration(readSeconds(text))}
        </span>
        <span className="hidden truncate font-semibold text-white/80 sm:inline">{title}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={togglePlay} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 font-semibold hover:bg-brand-500">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? 'Pause' : 'Start'}
          </button>
          <button type="button" onClick={reset} aria-label="Restart" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
            <RotateCcw className="h-4 w-4" />
          </button>
          <span className="ml-1 hidden text-xs text-white/60 sm:inline">Speed</span>
          <button type="button" aria-label="Slower" onClick={() => setSpeed((s) => Math.max(10, s - 10))} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-8 text-center text-xs tabular-nums">{speed}</span>
          <button type="button" aria-label="Faster" onClick={() => setSpeed((s) => Math.min(160, s + 10))} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Text size" onClick={() => setSize((s) => (s >= 64 ? 32 : s + 8))} className="inline-flex h-9 items-center rounded-lg bg-white/10 px-2.5 text-xs font-semibold hover:bg-white/20">
            Aa {size}
          </button>
          <button type="button" aria-label="Mirror text" aria-pressed={mirror} onClick={() => setMirror(!mirror)} className={clsx('inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/20', mirror ? 'bg-brand-600' : 'bg-white/10')}>
            <FlipHorizontal className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Close teleprompter" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-[38%] z-10 h-[1.6em] border-y border-brand-400/50 bg-brand-500/10" style={{ fontSize: size }} />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-black to-transparent" />
        <div ref={scroller} className="h-full overflow-y-auto px-6 sm:px-16" onWheel={() => scroller.current && (pos.current = scroller.current.scrollTop)}>
          <div className="mx-auto max-w-4xl whitespace-pre-line pb-[60vh] pt-[38vh] font-semibold leading-[1.5]" style={{ fontSize: size, transform: mirror ? 'scaleX(-1)' : undefined }}>
            {text}
          </div>
        </div>
        {countdown !== null && countdown > 0 && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 text-[120px] font-bold tabular-nums">{countdown}</div>
        )}
      </div>
      <div className="border-t border-white/10 px-4 py-2 text-center text-[11px] text-white/50">Space start/pause · ↑ ↓ speed · Esc close · Prototype — your camera is not accessed and nothing is recorded or posted.</div>
    </div>,
    document.body,
  );
}

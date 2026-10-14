'use client';

import clsx from 'clsx';
import { Captions, Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clock } from '@/lib/calculations/markets';

/**
 * Simulated video player. The prototype ships no media: pressing play advances a
 * progress bar in real time and shows a "Demo video — playback not included" notice.
 * Swap the poster/progress for a real <video> element when content is wired up.
 */
export function VideoPlayer({
  title,
  eyebrow = 'MBS Highway',
  presenter = 'Barry Habib',
  durationSec,
  seed = 0,
  className,
  compact,
  autoStart,
  seek,
}: {
  title: string;
  eyebrow?: string;
  presenter?: string;
  durationSec: number;
  seed?: number;
  className?: string;
  compact?: boolean;
  autoStart?: boolean;
  /** Jump to a chapter: change `n` to trigger a seek to `at` seconds. */
  seek?: { at: number; n: number };
}) {
  const [started, setStarted] = useState(!!autoStart);
  const [playing, setPlaying] = useState(!!autoStart);
  const [pos, setPos] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cc, setCc] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dur = Math.max(1, durationSec || 1);

  // Reset when the video changes.
  useEffect(() => {
    setPos(0);
    setStarted(!!autoStart);
    setPlaying(!!autoStart);
  }, [title, durationSec, autoStart]);

  useEffect(() => {
    if (!seek || seek.n === 0) return;
    setPos(Math.max(0, Math.min(dur, seek.at)));
    setStarted(true);
    setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek?.n]);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setPos((p) => {
        if (p + 0.25 >= dur) {
          setPlaying(false);
          return dur;
        }
        return p + 0.25;
      });
    }, 250);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, dur]);

  const ended = pos >= dur;
  const toggle = () => {
    if (ended) {
      setPos(0);
      setPlaying(true);
      return;
    }
    setStarted(true);
    setPlaying((p) => !p);
  };
  const pctDone = (pos / dur) * 100;
  const hue = [262, 250, 275, 240, 285][Math.abs(seed) % 5];

  return (
    <div className={clsx('group relative overflow-hidden rounded-xl bg-ink-950 text-white shadow-card', className)}>
      <div className="relative aspect-video w-full select-none">
        {/* Poster frame */}
        <div className="absolute inset-0" style={{ background: `radial-gradient(120% 90% at 85% 15%, hsl(${hue} 85% 55% / .55), transparent 55%), radial-gradient(90% 80% at 0% 100%, hsl(${hue + 30} 80% 45% / .35), transparent 60%), linear-gradient(135deg, #0b1020, #1a2347)` }} />
        <svg className="absolute inset-x-0 bottom-0 h-1/2 w-full opacity-30" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden>
          <path d={`M0 ${70 - (seed % 7)} C 60 ${40 + (seed % 11)}, 110 80, 170 55 S 280 ${20 + (seed % 13)}, 330 40 S 380 30, 400 ${25 + (seed % 9)}`} fill="none" stroke="white" strokeWidth="1.5" />
        </svg>
        <div className={clsx('absolute inset-0 flex flex-col justify-between', compact ? 'p-3 sm:p-4' : 'p-4 sm:p-6')}>
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-200 backdrop-blur">{eyebrow}</span>
            <span className="rounded-md bg-black/40 px-1.5 py-0.5 text-[11px] font-medium tabular-nums">{clock(dur)}</span>
          </div>
          <div className={clsx('max-w-[85%]', started && 'opacity-0 transition-opacity')}>
            <div className={clsx('font-bold leading-tight tracking-tight', compact ? 'text-base sm:text-lg' : 'text-lg sm:text-2xl')}>{title}</div>
            <div className="mt-1 text-xs text-slate-300">with {presenter}</div>
          </div>
        </div>

        {/* Big play button */}
        {(!started || ended) && (
          <button
            type="button"
            onClick={toggle}
            aria-label={ended ? `Replay ${title}` : `Play ${title}`}
            className="absolute inset-0 flex items-center justify-center focus-visible:outline-none"
          >
            <span className={clsx('flex items-center justify-center rounded-full bg-white/95 text-brand-700 shadow-lift ring-8 ring-white/15 transition group-hover:scale-105', compact ? 'h-14 w-14' : 'h-16 w-16 sm:h-20 sm:w-20')}>
              {ended ? <RotateCcw className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7 fill-current sm:h-8 sm:w-8" />}
            </span>
          </button>
        )}

        {/* Demo notice while "playing" */}
        {started && !ended && (
          <div className="absolute inset-0 flex items-center justify-center p-4" onClick={toggle}>
            <div className="rounded-lg bg-black/55 px-4 py-2.5 text-center text-sm backdrop-blur">
              <div className="font-semibold">Demo video — playback not included</div>
              <div className="mt-0.5 text-xs text-slate-300">{playing ? 'Simulating playback…' : 'Paused'}</div>
            </div>
          </div>
        )}
        {cc && started && !ended && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center px-6">
            <span className="rounded bg-black/70 px-2 py-1 text-xs">[Captions available with live video]</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 bg-ink-900 px-3 py-2">
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="rounded p-1 text-slate-200 hover:bg-white/10 hover:text-white">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <span className="w-[86px] shrink-0 text-[11px] tabular-nums text-slate-300">
          {clock(pos)} / {clock(dur)}
        </span>
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={dur}
          step={1}
          value={Math.floor(pos)}
          onChange={(e) => {
            setStarted(true);
            setPos(Number(e.target.value));
          }}
          className="range-brand h-1.5 min-w-0 flex-1"
          style={{ background: `linear-gradient(to right, #9b7eff ${pctDone}%, rgba(255,255,255,.18) ${pctDone}%)` }}
        />
        <button type="button" onClick={() => setCc(!cc)} aria-pressed={cc} aria-label="Captions" className={clsx('hidden rounded p-1 hover:bg-white/10 sm:block', cc ? 'text-brand-300' : 'text-slate-300')}>
          <Captions className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'} className="rounded p-1 text-slate-300 hover:bg-white/10">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button type="button" disabled title="Full screen is not available for demo video" aria-label="Full screen (not available in demo)" className="hidden rounded p-1 text-slate-500 sm:block">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

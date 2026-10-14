'use client';

/**
 * Small helpers shared by the marketing tools (Social Studio, Newsletter, Social Share,
 * Prequalified Buyer Campaign, Presentation Expressway, Open House Flyers, Seller Contribution).
 */
import clsx from 'clsx';
import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDuration } from '@/lib/calculations/marketingFilters';

/** Copy text to the clipboard; resolves true on success. Works in insecure contexts via a textarea fallback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export const NOTHING_SENT = 'Prototype — nothing was sent';

/** Read/write a JSON value in localStorage (per browser). Safe when storage is unavailable. */
export function useLocalList<T>(key: string, seed: T[] = []): [T[], (next: T[] | ((prev: T[]) => T[])) => void, boolean] {
  const [list, setList] = useState<T[]>(seed);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setList(JSON.parse(raw) as T[]);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, [key]);
  const set = useCallback(
    (next: T[] | ((prev: T[]) => T[])) => {
      setList((prev) => {
        const v = typeof next === 'function' ? (next as (p: T[]) => T[])(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(v));
        } catch {
          /* ignore */
        }
        return v;
      });
    },
    [key],
  );
  return [list, set, ready];
}

/** Initials for avatars. */
export function initials(name: string): string {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Video player UI for demo content (no media file in the prototype). Play/pause, seek,
 * mute, fullscreen; optional captions advance with the playhead.
 */
export function DemoVideoPlayer({
  title,
  subtitle,
  durationSec,
  from = '#3e1a8f',
  to = '#6a2ff2',
  captions,
  autoPlay = false,
  className,
}: {
  title: string;
  subtitle?: string;
  durationSec: number;
  from?: string;
  to?: string;
  captions?: string[];
  autoPlay?: boolean;
  className?: string;
}) {
  const dur = Math.max(1, durationSec || 1);
  const [playing, setPlaying] = useState(autoPlay);
  const [t, setT] = useState(0);
  const [muted, setMuted] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((x) => {
        const n = x + 0.25;
        if (n >= dur) {
          setPlaying(false);
          return dur;
        }
        return n;
      });
    }, 250);
    return () => clearInterval(id);
  }, [playing, dur]);

  const toggle = () => {
    if (!playing && t >= dur) setT(0);
    setPlaying(!playing);
  };
  const caption = captions?.length ? captions[Math.min(captions.length - 1, Math.floor((t / dur) * captions.length))] : null;
  const pctDone = (t / dur) * 100;

  return (
    <div ref={wrap} className={clsx('group relative aspect-video w-full overflow-hidden rounded-xl bg-black text-white', className)}>
      <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }} />
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #fff 0, transparent 40%), radial-gradient(circle at 80% 70%, #fff 0, transparent 35%)' }} />
      <div className="absolute left-4 right-4 top-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold drop-shadow sm:text-base">{title}</div>
          {subtitle && <div className="truncate text-xs text-white/75">{subtitle}</div>}
        </div>
        <span className="shrink-0 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">Demo player</span>
      </div>
      {!playing && (
        <button type="button" aria-label={`Play ${title}`} onClick={toggle} className="absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-brand-700 shadow-lift transition-transform hover:scale-105 sm:h-16 sm:w-16">
          <Play className="ml-1 h-7 w-7" fill="currentColor" />
        </button>
      )}
      {caption && playing && (
        <div className="absolute inset-x-6 bottom-14 text-center">
          <span className="rounded bg-black/60 px-2 py-1 text-xs leading-relaxed sm:text-sm">{caption}</span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(t)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setT((x) => Math.min(dur, x + 5));
            if (e.key === 'ArrowLeft') setT((x) => Math.max(0, x - 5));
          }}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setT(Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)));
          }}
          className="mb-1.5 h-1.5 w-full cursor-pointer rounded-full bg-white/30"
        >
          <div className="h-full rounded-full bg-brand-400" style={{ width: `${pctDone}%` }} />
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} className="hover:text-brand-200">
            {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4" fill="currentColor" />}
          </button>
          <span className="tabular-nums text-white/90">
            {formatDuration(t)} / {formatDuration(dur)}
          </span>
          <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(!muted)} className="ml-auto hover:text-brand-200">
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label="Fullscreen"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
              else wrap.current?.requestFullscreen?.().catch(() => {});
            }}
            className="hover:text-brand-200"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small pill noting a prototype limitation. */
export function PrototypeNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600', className)}>{children}</span>;
}

/** Escape text for SVG/HTML output. */
export function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Greedy word-wrap for SVG text (approximate glyph width = 0.55em). */
export function wrapLines(text: string, maxChars: number, maxLines = 4): string[] {
  const words = (text ?? '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, '') + '…';
    return kept;
  }
  return lines;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Local copy of the shared Switch with the knob anchored at left-0.
 * (components/ui.tsx Switch's knob has no `left`, so inside a <button> it renders off the track.)
 */
export function Toggle({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean; id?: string }) {
  return (
    <label className={clsx('inline-flex items-center gap-2 text-sm text-slate-700', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={clsx('absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
      {label}
    </label>
  );
}

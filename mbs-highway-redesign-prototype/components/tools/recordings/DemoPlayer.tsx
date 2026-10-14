'use client';

import { Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '@/components/ui';
import { formatDuration } from '@/lib/calculations/recordings';

/**
 * Demo video player for the prototype: no media file is loaded — the timeline simulates
 * playback so the play / pause / scrub / chapters interactions can be demoed.
 * Swap the stage for a <video src> when real recordings are wired up.
 */
export function DemoPlayer({
  title,
  subtitle,
  durationSec,
  chapters,
  tone = 'brand',
}: {
  title: string;
  subtitle?: string;
  durationSec: number;
  chapters?: { at: number; label: string }[];
  tone?: 'brand' | 'ink' | 'emerald' | 'sky' | 'amber';
}) {
  const total = Math.max(1, Math.round(durationSec));
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((x) => {
        if (x + 1 >= total) {
          setPlaying(false);
          return total;
        }
        return x + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [playing, total]);

  const pctDone = (t / total) * 100;
  const chapter = chapters?.filter((c) => c.at <= t).slice(-1)[0];

  return (
    <div>
      <div
        className={cx(
          'relative aspect-video w-full overflow-hidden rounded-xl text-white',
          tone === 'brand' && 'bg-gradient-to-br from-brand-700 via-brand-900 to-ink-950',
          tone === 'ink' && 'bg-gradient-to-br from-ink-700 via-ink-900 to-ink-950',
          tone === 'emerald' && 'bg-gradient-to-br from-emerald-600 via-emerald-900 to-ink-950',
          tone === 'sky' && 'bg-gradient-to-br from-sky-600 via-sky-900 to-ink-950',
          tone === 'amber' && 'bg-gradient-to-br from-amber-500 via-amber-800 to-ink-950',
        )}
      >
        <div className="absolute left-4 top-3 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">Demo player · no media in prototype</div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => {
              if (t >= total) setT(0);
              setPlaying(!playing);
            }}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur transition hover:bg-white/30"
          >
            {playing ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" />}
          </button>
          <div className="max-w-md">
            <div className="text-base font-semibold sm:text-lg">{title}</div>
            {(chapter || subtitle) && <div className="mt-0.5 text-sm text-white/70">{chapter ? chapter.label : subtitle}</div>}
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 pb-3 pt-8">
          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={total}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
            className="h-1 w-full cursor-pointer accent-white"
            style={{ background: `linear-gradient(to right, #fff ${pctDone}%, rgba(255,255,255,.3) ${pctDone}%)` }}
          />
          <div className="mt-1.5 flex items-center justify-between text-xs tabular-nums text-white/80">
            <div className="flex items-center gap-3">
              <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} className="hover:text-white">
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button type="button" aria-label="Restart" onClick={() => setT(0)} className="hover:text-white">
                <RotateCcw className="h-4 w-4" />
              </button>
              <Volume2 className="h-4 w-4" aria-hidden />
            </div>
            <span>
              {formatDuration(t)} / {formatDuration(total)}
            </span>
          </div>
        </div>
      </div>
      {chapters && chapters.length > 0 && (
        <ol className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {chapters.map((c) => (
            <li key={c.at}>
              <button
                type="button"
                onClick={() => {
                  setT(c.at);
                  setPlaying(true);
                }}
                className={cx('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50', chapter?.at === c.at ? 'font-semibold text-brand-700' : 'text-slate-700')}
              >
                <span>{c.label}</span>
                <span className="tabular-nums text-xs text-slate-500">{formatDuration(c.at)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

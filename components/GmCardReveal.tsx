'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The button, and nothing but the button. The card itself is a server
 * component handed in as `children` — this file exists only because revealing
 * and dismissing it needs state, and it holds no facts of its own so it can
 * never contradict the page it opened from.
 *
 * There is no download, no share sheet, no canvas export, and there should
 * never be one: the artefact is a SCREENSHOT. The job here is to put one
 * self-contained rectangle on a plain dark ground, big enough to catch and
 * small enough to fit, and then get out of the way. The only chrome inside
 * the frame is the close control, because a thing that opens has to shut.
 *
 * Portalled to the body for the same reason the trophy moment is: the app
 * header's backdrop-filter would otherwise become this overlay's containing
 * block and trap it under the nav.
 */
export function GmCardReveal({ children, label = 'Your GM Card ▸' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* PRIMARY WEIGHT, ON PURPOSE. This shipped as a grey btn-secondary in
          the corner of the masthead, sitting over the club watermark, and the
          app owner could not find it — *"how do you get to the card? i dont
          see it on the GM profile"*. It is the only thing on this page that
          leaves the game, so it is the page's action, not a footnote on it. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary whitespace-nowrap"
      >
        {label}
      </button>

      {mounted && open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="GM card"
          className="fixed inset-0 z-[60] overflow-y-auto bg-ink/95 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute top-4 right-5 text-muted hover:text-chalk text-sm"
          >
            ✕
          </button>
          {/* The card must not close the overlay when it is the thing being
              pressed — a long-press to save the image on a phone starts as a
              press on the card. */}
          {/* The card is built at phone size, because that is where it gets
              screenshotted. On a desktop it is simply scaled up rather than
              relaid out, so the thing on screen is the same rectangle in the
              same proportions either way. */}
          {/* Two elements, and they have to stay two: .animate-fadeUp ends on a
              `transform` keyframe with fill-mode both, and an animation's
              transform beats a class's for as long as it is applied — put the
              scale on the same node and it is silently thrown away. */}
          <div
            className="my-auto origin-center sm:scale-110 xl:scale-125"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="animate-fadeUp">{children}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** Long enough that a name is typed rather than spelled at the server. [TUNE] */
const DEBOUNCE_MS = 250;

/**
 * FIND A MAN BY NAME. The app owner: *"we should be able to search by name for
 * prospects in the draft board"*.
 *
 * IT SEARCHES THE CLASS, NOT THE SCREEN, and that is why it is a query
 * parameter rather than a filter over the rows already in the table. During a
 * live draft the board renders the top eighty men left by rating — a
 * client-side filter could only ever find someone inside that slice, so the
 * sixth-round name you actually have to look up, the one you wrote down in
 * September, would return nothing on the one night it matters. The parameter
 * goes to the same query the position and shortlist pills go to; the server
 * lifts the eighty-row cap while a search is running, because a name matches a
 * handful of men and never a page of them.
 *
 * IT COMPOSES, IT DOES NOT COMPETE. `baseHref` arrives carrying every other
 * filter already in play — position, shortlist, sort column and direction — so
 * typing narrows what those left standing rather than replacing it, and
 * clearing the box drops back into exactly the board you were on.
 *
 * TYPING MUST NOT COST THE PAGE. A round trip per keystroke would be a
 * navigation per keystroke, so: one debounced `router.replace` (not push — a
 * search box has no business filling the back button with every prefix of a
 * name), `scroll: false` so the board does not jump to the top under a man's
 * hand, and a soft navigation, which keeps this input mounted and therefore
 * keeps the caret exactly where he left it. The value is local state and is
 * deliberately NOT re-synced from the URL afterwards: this page refreshes
 * itself every few seconds while a draft runs, and re-seeding the box from a
 * prop on each of those would fight whoever is mid-word.
 */
export function ProspectSearch({ initial, baseHref, matches }: {
  /** The `q` the page rendered with, so a reload lands with the box filled. */
  initial: string;
  /** The board's URL with every other filter on it and no `q`. */
  baseHref: string;
  /** How many men the current search left standing, for the live count. */
  matches?: number;
}) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (next: string) => {
    const q = next.trim();
    const url = q ? `${baseHref}${baseHref.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}` : baseHref;
    startTransition(() => router.replace(url, { scroll: false }));
  };

  const edit = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(next), DEBOUNCE_MS);
  };

  const commitNow = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    go(next);
  };

  const searching = value.trim().length > 0;

  return (
    <div className="flex items-center">
      {/* The clear button is positioned against the INPUT, not against the row:
          anchored to the row it landed on top of the match count beside it. */}
      <div className="relative flex items-center">
        <input
          type="search"
          value={value}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitNow(value); }
            if (e.key === 'Escape') { setValue(''); commitNow(''); }
          }}
          placeholder="Search prospects…"
          aria-label="Search prospects by name"
          /* Chrome draws its own clear button inside a type=search box, which
             put two ✕ next to each other. Ours stays — it is the one that is
             styled like the rest of this app and that exists in every
             browser — and the native one is turned off. */
          className="input py-1 w-44 focus:w-56 transition-[width] duration-150
                     [&::-webkit-search-cancel-button]:appearance-none"
        />
        {searching && (
          <button
            type="button"
            onClick={() => { setValue(''); commitNow(''); }}
            aria-label="Clear search"
            className="absolute right-2 text-muted hover:text-chalk text-sm leading-none"
          >
            ✕
          </button>
        )}
      </div>
      {searching && (
        <span className="ml-2 text-[11px] text-muted whitespace-nowrap">
          {pending ? 'searching…' : matches !== undefined ? `${matches} match${matches === 1 ? '' : 'es'}` : ''}
        </span>
      )}
    </div>
  );
}

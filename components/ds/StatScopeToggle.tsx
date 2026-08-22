import Link from 'next/link';
import type { StatScope } from '@/lib/playerSeasons';

/**
 * Regular Season / Playoffs — the one control that says which half of the
 * year a page's numbers are.
 *
 * The two halves are stored in separate buckets (see Player.seasonStats in
 * the schema) precisely so a page never has to add them together, and this
 * toggle is how the reader picks. It is a LINK pair rather than client state:
 * the choice lives in the URL, so a reload keeps it and a shared link carries
 * it — the same reason free agency puts its sort and position filters there.
 *
 * Regular season is the default everywhere, and it is the default by absence:
 * the regular-season href never carries the param at all, so a bare page URL
 * and the "Regular Season" pill are the same address.
 */
export function StatScopeToggle({
  scope,
  regularHref,
  playoffHref,
  regularLabel = 'Regular Season',
  playoffLabel = 'Playoffs',
}: {
  scope: StatScope;
  regularHref: string;
  playoffHref: string;
  regularLabel?: string;
  playoffLabel?: string;
}) {
  const on = 'border-accent text-accent bg-accent/10';
  const off = 'border-line text-muted hover:text-chalk';
  // scroll={false} on BOTH, and it is not a nicety. Only the table under this
  // control changes when the scope flips, so any scrolling at all is the page
  // moving out from under the reader. The player card had it worse: its hrefs
  // carried a `#stat-line` anchor, meant to keep the table in view, and
  // because that section sits near the foot of a long card the effect was to
  // fling you to the bottom on every click — the app owner's report, exactly.
  // The anchor is gone and this stays put.
  return (
    <div className="flex gap-1.5">
      <Link href={regularHref} scroll={false} className={`pill ${scope === 'REGULAR' ? on : off}`}>{regularLabel}</Link>
      <Link href={playoffHref} scroll={false} className={`pill ${scope === 'PLAYOFFS' ? on : off}`}>{playoffLabel}</Link>
    </div>
  );
}

/** The URL param both pages use. One name, so a habit learned on one page works on the other. */
export const STAT_SCOPE_PARAM = 'split';

/** Parse it. Anything unrecognised is the regular season, which is the default everywhere. */
export function parseStatScope(raw: string | undefined): StatScope {
  return raw === 'playoffs' ? 'PLAYOFFS' : 'REGULAR';
}

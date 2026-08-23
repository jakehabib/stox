import type { GmHeadToHead, GmOpponentRecord } from '@/lib/gmTenure';

/**
 * YOUR RECORD AGAINST EVERY CLUB IN THE LEAGUE, over your tenure.
 *
 * A career record of 91-70 says nothing about whether you can beat the club you
 * play twice a year. This is the same games broken out by opponent, which is
 * the read a GM actually has an opinion about, and it costs one query
 * (lib/gmTenure.ts buildGmHeadToHead) because Game rows already carry both
 * clubs and the season.
 *
 * DIVISION RIVALS ARE MARKED, not sorted to the top. Ordering the whole league
 * by how well you have done against it is what makes the panel worth reading —
 * the club you own is at one end and the club that owns you is at the other —
 * and a rival dragged out of that order for being a rival would break the one
 * thing the order is for. The pill says who they are instead.
 *
 * A CLUB YOU HAVE NEVER PLAYED SAYS SO. Interconference opponents come round
 * every few years, so a 0-0 is normally "not yet", not "never won" — and those
 * two must not look the same.
 */
function line(o: GmOpponentRecord): string {
  return `${o.wins}-${o.losses}${o.ties ? `-${o.ties}` : ''}`;
}

export function GmHeadToHeadPanel({ h2h }: { h2h: GmHeadToHead }) {
  const played = h2h.opponents.filter((o) => o.wins + o.losses + o.ties > 0 || o.playoffWins + o.playoffLosses > 0);
  if (played.length === 0) return null;

  const rate = (o: GmOpponentRecord) => {
    const g = o.wins + o.losses + o.ties;
    return g > 0 ? o.wins / g : 0;
  };
  const ordered = [...h2h.opponents].sort((a, b) => {
    const ga = a.wins + a.losses + a.ties, gb = b.wins + b.losses + b.ties;
    if (ga === 0 && gb === 0) return a.abbr.localeCompare(b.abbr);
    if (ga === 0) return 1;
    if (gb === 0) return -1;
    return rate(b) - rate(a) || b.wins - a.wins || a.abbr.localeCompare(b.abbr);
  });

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm">Head to Head</div>
        <div className="text-xs text-muted">
          {h2h.regular.wins}-{h2h.regular.losses}{h2h.regular.ties ? `-${h2h.regular.ties}` : ''} in the regular season
          {h2h.playoffs.wins + h2h.playoffs.losses > 0 && ` · ${h2h.playoffs.wins}-${h2h.playoffs.losses} in the postseason`}
          {' '}since you took the job
        </div>
      </div>

      {(h2h.owned || h2h.nemesis) && (
        <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line/40 border-b border-line/70">
          {h2h.owned && (
            <div className="px-4 py-3">
              <div className="label-sm text-[10px]">You Own Them</div>
              <div className="font-display font-bold text-lg leading-none mt-1 text-accent">{h2h.owned.name}</div>
              <div className="text-xs text-muted mt-1 font-mono">{line(h2h.owned)} against {h2h.owned.abbr}</div>
            </div>
          )}
          {h2h.nemesis && (
            <div className="px-4 py-3">
              <div className="label-sm text-[10px]">They Own You</div>
              <div className="font-display font-bold text-lg leading-none mt-1 text-bad">{h2h.nemesis.name}</div>
              <div className="text-xs text-muted mt-1 font-mono">{line(h2h.nemesis)} against {h2h.nemesis.abbr}</div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 divide-x divide-y divide-line/40">
        {ordered.map((o) => {
          const g = o.wins + o.losses + o.ties;
          const post = o.playoffWins + o.playoffLosses;
          return (
            <div key={o.teamId} className="px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="label-sm text-[10px]">{o.abbr}</span>
                {o.inDivision && <span className="text-[9px] uppercase tracking-wider text-accent2">div</span>}
              </div>
              <div className={`font-mono text-sm mt-0.5 ${g === 0 ? 'text-muted' : o.wins > o.losses ? 'text-accent' : o.wins < o.losses ? 'text-bad' : ''}`}>
                {g === 0 ? 'Not yet played' : line(o)}
              </div>
              {post > 0 && (
                <div className="text-[10px] text-muted mt-0.5">{o.playoffWins}-{o.playoffLosses} in January</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

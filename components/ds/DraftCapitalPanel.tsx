import { TeamLogo } from '../TeamLogo';
import { SectionHeading } from './SectionHeading';
import { positionBadgeClass } from './positionColor';
import { tip } from '@/lib/glossary';

/**
 * A pick the club actually holds. The two number fields are deliberately
 * separate and never merged into one "slot": `overall` is the selection this
 * pick IS, and only exists once that draft's order has been reseeded from
 * final standings; `projectedOverall` is where it would land if the season
 * ended right now, and is the only one a current-year pick has while the
 * season is still being played. A future year has neither, and inventing one
 * for it would be a number the system never used.
 */
export interface DraftCapitalPick {
  id: string;
  year: number;
  round: number;
  /** Real selection number. Present ONLY when the order for that year is settled. */
  overall?: number;
  /** "If the season ended today", from the ORIGINAL club's record. Never set for a future year. */
  projectedOverall?: number;
  /** The slot half of the projection, for the same wording the trade screen uses. */
  projectedSlot?: number;
  /** Set when the pick was acquired in a trade — the club it originally belonged to. */
  from?: { teamId: string; abbr: string };
  /** Live draft only: selections between now and this pick. 0 means on the clock. */
  picksAway?: number;
  /** Live draft only: who this pick was already spent on. */
  spentOn?: { name: string; position: string };
}

/** An original pick of this club's that somebody else now holds. */
export interface DraftCapitalForfeit {
  id: string;
  year: number;
  round: number;
  overall?: number;
  to: { teamId: string; abbr: string };
  /** Set once the club holding it has used it. */
  spentOn?: { name: string; position: string };
}

export interface DraftCapitalYear {
  year: number;
  /** The order for this year is reseeded and final — show real numbers, no projection language. */
  settled: boolean;
  /** A live projection exists for this year (current draft, real standings behind it). */
  projected: boolean;
  /** The season whose standings will set this order, for a year that has neither yet. */
  orderFromSeason?: number;
  picks: DraftCapitalPick[];
  forfeited: DraftCapitalForfeit[];
}

const roundLabel = (round: number) => `R${round}`;

/**
 * WHAT YOU HOLD, WHAT YOU GAVE UP, AND WHEN YOU ARE NEXT UP.
 *
 * The draft page used to answer "how many picks do you own" with a single
 * count, which is not a number a GM can plan from. This is the same question
 * answered properly: every pick by round and selection number, grouped by
 * draft, with the club a traded-in pick came from, the rounds that are gone
 * shown in place rather than silently missing, and — during a live draft —
 * how many selections until the club is on the clock.
 *
 * A projected number is never rendered as a final one. `settled` and
 * `projected` come from the page, which knows whether that year's order has
 * actually been reseeded, and a year with neither shows its round and no
 * number at all.
 */
export function DraftCapitalPanel({ years, nextUp, teamAbbr }: {
  years: DraftCapitalYear[];
  /** Live draft only — the club's next unused pick and how far away it is. */
  nextUp?: { picksAway: number; round: number; overall: number; onTheClock: boolean };
  teamAbbr: string;
}) {
  const total = years.reduce((n, y) => n + y.picks.length, 0);
  const first = years[0];

  return (
    <div className="section">
      <SectionHeading
        title="Your Picks"
        tip={tip('pickValue')}
        action={
          <span className="text-xs text-muted">
            {total} pick{total === 1 ? '' : 's'} across {years.length} draft{years.length === 1 ? '' : 's'}
          </span>
        }
      />

      <div className="panel p-4 space-y-3">
        {nextUp && (
          <div
            className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 ${
              nextUp.onTheClock ? 'border-accent bg-accent/10' : 'border-line bg-raised/60'
            }`}
          >
            <div className="flex items-baseline gap-2.5">
              <span className={`stat-value text-stat-md ${nextUp.onTheClock ? 'text-accent' : 'text-chalk'}`}>
                {nextUp.onTheClock ? teamAbbr : nextUp.picksAway}
              </span>
              <span className="label-sm">
                {nextUp.onTheClock ? 'on the clock' : `selection${nextUp.picksAway === 1 ? '' : 's'} until you are on the clock`}
              </span>
            </div>
            <div className="font-mono text-sm text-muted">
              {roundLabel(nextUp.round)} · #{nextUp.overall} overall
            </div>
          </div>
        )}

        <div className={`grid gap-3 md:grid-cols-2 ${years.length >= 3 ? 'lg:grid-cols-3' : ''}`}>
          {years.map((y) => (
            <div key={y.year} className="rounded-md border border-line/70 bg-raised/30 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-line/60">
                <span className="font-display font-bold uppercase tracking-wide text-sm text-chalk">{y.year} Draft</span>
                <span className={`text-[10px] uppercase tracking-wider ${y.projected ? 'text-accent2' : 'text-muted'}`}>
                  {y.settled
                    ? 'order set'
                    : y.projected
                    ? 'if the season ended today'
                    : y.orderFromSeason
                    ? `order set after ${y.orderFromSeason}`
                    : 'order not set'}
                </span>
              </div>

              <div className="divide-y divide-line/40">
                {mergeRows(y).map((row) =>
                  row.kind === 'held' ? (
                    <HeldRow key={row.pick.id} pick={row.pick} settled={y.settled} />
                  ) : (
                    <ForfeitedRow key={row.forfeit.id} forfeit={row.forfeit} />
                  ),
                )}
                {y.picks.length === 0 && y.forfeited.length === 0 && (
                  <div className="py-2 text-xs text-muted">No picks.</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {total === 0 && !first && <p className="text-sm text-muted">You hold no picks in any scheduled draft.</p>}
      </div>
    </div>
  );
}

/**
 * Held and forfeited rounds interleave by round so the sequence reads
 * continuously — a missing third-rounder shows up as a struck-through R3
 * exactly where it would have been, instead of the list jumping R2 to R4 and
 * looking like a rendering fault.
 */
function mergeRows(y: DraftCapitalYear) {
  const rows: ({ kind: 'held'; pick: DraftCapitalPick; round: number } | { kind: 'forfeit'; forfeit: DraftCapitalForfeit; round: number })[] = [
    ...y.picks.map((pick) => ({ kind: 'held' as const, pick, round: pick.round })),
    ...y.forfeited.map((forfeit) => ({ kind: 'forfeit' as const, forfeit, round: forfeit.round })),
  ];
  return rows.sort((a, b) => a.round - b.round
    || (a.kind === 'held' ? 0 : 1) - (b.kind === 'held' ? 0 : 1));
}

function HeldRow({ pick, settled }: { pick: DraftCapitalPick; settled: boolean }) {
  const spent = !!pick.spentOn;
  return (
    <div className={`flex items-center gap-2 py-1.5 ${spent ? 'opacity-60' : ''}`}>
      <span className="w-8 shrink-0 text-center font-mono text-[11px] font-semibold rounded border border-line bg-ink/50 py-0.5">
        {roundLabel(pick.round)}
      </span>

      <span className="flex-1 min-w-0">
        {pick.overall !== undefined ? (
          <span className="stat-value text-stat-sm text-chalk">#{pick.overall}</span>
        ) : pick.projectedOverall !== undefined ? (
          <span
            className="inline-flex items-baseline gap-1"
            // The trade screen's exact wording for the same idea, so one term
            // never gets explained two ways on two screens.
            title={`Projected pick ${pick.projectedSlot} of 32 if the season ended today`}
          >
            <span className="text-[10px] text-accent2 uppercase tracking-wider">proj.</span>
            <span className="stat-value text-stat-sm text-accent2">#{pick.projectedOverall}</span>
          </span>
        ) : (
          <span className="text-muted font-mono text-sm">—</span>
        )}
      </span>

      {pick.spentOn ? (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[10px] font-semibold ${positionBadgeClass(pick.spentOn.position)}`}>{pick.spentOn.position}</span>
          <span className="text-xs text-chalk truncate max-w-[9rem]">{pick.spentOn.name}</span>
        </span>
      ) : pick.picksAway !== undefined ? (
        <span className={`text-[11px] font-mono ${pick.picksAway === 0 ? 'text-accent' : 'text-muted'}`}>
          {pick.picksAway === 0 ? 'on the clock' : `in ${pick.picksAway}`}
        </span>
      ) : null}

      {pick.from && (
        <span className="flex items-center gap-1 shrink-0" title={`Acquired from ${pick.from.abbr}`}>
          <TeamLogo seed={pick.from.teamId} abbr={pick.from.abbr} size={16} />
          <span className="text-[11px] text-accent2 font-medium">from {pick.from.abbr}</span>
        </span>
      )}
      {settled && pick.overall === undefined && <span className="text-[11px] text-warn">slot pending</span>}
    </div>
  );
}

function ForfeitedRow({ forfeit }: { forfeit: DraftCapitalForfeit }) {
  return (
    <div className="flex items-center gap-2 py-1.5 opacity-55">
      <span className="w-8 shrink-0 text-center font-mono text-[11px] font-semibold rounded border border-line/60 bg-ink/30 py-0.5 line-through text-muted">
        {roundLabel(forfeit.round)}
      </span>
      <span className="flex-1 min-w-0 text-muted">
        {forfeit.spentOn ? (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className={`text-[10px] font-semibold ${positionBadgeClass(forfeit.spentOn.position)}`}>{forfeit.spentOn.position}</span>
            <span className="text-xs truncate max-w-[9rem]">{forfeit.spentOn.name}</span>
          </span>
        ) : (
          <span className="font-mono text-sm line-through">{forfeit.overall !== undefined ? `#${forfeit.overall}` : '—'}</span>
        )}
      </span>
      <span className="flex items-center gap-1 shrink-0" title={`Traded to ${forfeit.to.abbr}`}>
        <TeamLogo seed={forfeit.to.teamId} abbr={forfeit.to.abbr} size={16} />
        <span className="text-[11px] text-muted font-medium">to {forfeit.to.abbr}</span>
      </span>
    </div>
  );
}
